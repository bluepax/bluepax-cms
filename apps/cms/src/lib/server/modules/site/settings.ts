// Site settings (docs/spec/README.md chapter 3, `site`; docs/adr/0007).
// Two kinds of data: sections of the instance configuration (`site`, `languages`), which the
// config file holds too and the export writes back, and site data that is entered in the
// admin only (contact, social links, footer, branding, SMTP), stored as `site.*` settings rows.
import { schema, type Database, type Executor, type Localized } from '@bluepax/db';
import { canonicalLocale, httpUrl, serviceKey, type InstanceConfig } from '@bluepax/presets';
import { eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { audit } from '../../audit.ts';
import { exportInstanceConfig, updateInstanceConfig, type ConfigSection } from '../../instance.ts';
import { decrypt, encrypt } from '../../security/crypto.ts';
import { MediaError } from '../media/errors.ts';
import { pagesUsingSlugs } from '../pages/slugs.ts';
import { postsUsingSlugs } from '../posts/slugs.ts';
import {
  prepareMediaUse,
  setMediaUsages,
  type MediaContext,
  type UsageRef,
} from '../media/library.ts';
import {
  configInputError,
  InvalidInputError,
  localized,
  mergeLocalized,
  optionalEmail,
  parseInput,
  phone,
} from './values.ts';

export interface Actor {
  id: string;
  ip: string | null;
}

/** Names of the top-level fields that differ, for the audit log (never the values). */
function changedFields(before: object | null, after: object | null): string[] {
  const a = (before ?? {}) as Record<string, unknown>;
  const b = (after ?? {}) as Record<string, unknown>;
  return [...new Set([...Object.keys(a), ...Object.keys(b)])]
    .filter((key) => JSON.stringify(a[key]) !== JSON.stringify(b[key]))
    .sort();
}

// ---------------------------------------------------------------------------------------------
// Configuration sections

/** Content languages and the primary language, from the configuration. */
export async function contentLanguages(
  db: Executor,
): Promise<{ codes: string[]; primary: string }> {
  const { languages } = await exportInstanceConfig(db);
  return { codes: languages.content.map((l) => l.code), primary: languages.primary };
}

async function saveConfig(
  db: Database,
  section: ConfigSection,
  actor: Actor,
  change: (current: InstanceConfig) => unknown,
  /** Further writes in the same transaction. */
  extra?: (tx: Executor) => Promise<unknown>,
): Promise<InstanceConfig> {
  return db.transaction(async (tx) => {
    let result: Awaited<ReturnType<typeof updateInstanceConfig>>;
    try {
      result = await updateInstanceConfig(tx, change);
    } catch (error) {
      configInputError(error, section);
    }
    if (result.changed.length > 0) {
      await audit(tx, {
        action: 'site.update',
        actorId: actor.id,
        targetType: 'settings',
        targetId: section,
        details: Object.fromEntries(
          result.changed.map((key) => [key, changedFields(result.before[key], result.after[key])]),
        ),
        ip: actor.ip,
      });
    }
    await extra?.(tx);
    return result.after;
  });
}

export interface GeneralInput {
  type: string;
  name: string;
  timezone: string;
  publisher: { type: string; name: string; sameAs: string[] };
  brandTerms: string[];
}

/**
 * Site type, name, time zone, publisher and brand terms. Changing the type switches nothing.
 * With `publisher`, the site data of the publisher is saved in the same transaction: the logo
 * or avatar (a media ID or null, docs/adr/0008) and the main author, who is the Person
 * publisher (an author ID or null, docs/adr/0010).
 */
export async function saveGeneral(
  db: Database,
  input: GeneralInput,
  actor: Actor,
  publisher?: { media: MediaContext; image: string | null; authorId?: string | null },
) {
  let save: ((tx: Executor) => Promise<unknown>) | undefined;
  if (publisher) {
    const value = parseInput(siteData['site.publisher'], {
      image: publisher.image,
      authorId: publisher.authorId ?? null,
    });
    const refs = await prepareRefs(publisher.media, 'site.publisher', value);
    save = async (tx) => {
      // Serialise with deleting authors, which refuses to delete the main author.
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext('bluepax:site:publisher'))`);
      if (value.authorId) {
        const [author] = await tx
          .select({ id: schema.authors.id })
          .from(schema.authors)
          .where(eq(schema.authors.id, value.authorId));
        if (!author) throw new InvalidInputError(['publisher.authorId']);
      }
      return writeSiteData(tx, 'site.publisher', value, actor, refs);
    };
  }
  return saveConfig(db, 'site', actor, (c) => ({ ...c, site: { ...c.site, ...input } }), save);
}

export interface InstantMessagingInput {
  channel: string;
  number: string;
  text: Localized;
}

/** The instant messaging channel, or null to remove it. */
export function saveInstantMessaging(
  db: Database,
  input: InstantMessagingInput | null,
  actor: Actor,
) {
  return saveConfig(db, 'site', actor, (c) => ({ ...c, site: { ...c.site, im: input } }));
}

export interface LanguagesInput {
  /** `dir` left out means the language's own direction. */
  content: { code: string; dir?: 'ltr' | 'rtl' }[];
  primary: string;
  admin: string;
}

/**
 * Content languages, primary language and the default admin language. Instant messaging
 * texts of removed languages are dropped with it, since the configuration only allows texts
 * for content languages; site data keeps them (see mergeLocalized).
 */
export function saveLanguages(db: Database, input: LanguagesInput, actor: Actor) {
  return saveConfig(db, 'languages', actor, (c) => {
    const codes = input.content.map((l) => canonicalLocale(l.code));
    const keep = <T>(values: Record<string, T>) =>
      Object.fromEntries(Object.entries(values).filter(([code]) => codes.includes(code)));
    const im = c.site.im && { ...c.site.im, text: keep(c.site.im.text) };
    // The posts section lists the categories per language; its translations stay in the
    // database and come back when the language is added again (docs/adr/0010).
    const categories = c.posts.categories
      .map((category) => ({ name: keep(category.name), slug: keep(category.slug) }))
      .filter((category) => Object.keys(category.name).length > 0);
    return {
      ...c,
      languages: input,
      site: { ...c.site, im },
      posts: { ...c.posts, categories },
    };
  });
}

export interface FrontendInput {
  reservedSlugs: string[];
}

/**
 * Reserved slugs of the frontend section (chapter 2, "前台"). A slug that a page or post already
 * uses cannot become reserved (`slug_in_use`, with the pages and posts); rename them first.
 */
export function saveFrontend(db: Database, input: FrontendInput, actor: Actor) {
  return saveConfig(
    db,
    'frontend',
    actor,
    (c) => ({ ...c, frontend: { ...c.frontend, reservedSlugs: input.reservedSlugs } }),
    async (tx) => {
      const { frontend } = await exportInstanceConfig(tx);
      const used = await pagesUsingSlugs(tx, frontend.reservedSlugs);
      const posts = await postsUsingSlugs(tx, frontend.reservedSlugs);
      if (used.length > 0 || posts.length > 0) {
        throw new InvalidInputError(
          ['reservedSlugs'],
          `reserved slugs in use: ${[...used, ...posts].map((u) => u.slug).join(', ')}`,
          'slug_in_use',
          {
            pages: used.map((u) => ({
              pageId: u.pageId,
              locale: u.locale,
              slug: u.slug,
              title: u.title,
            })),
            posts,
          },
        );
      }
    },
  );
}

// ---------------------------------------------------------------------------------------------
// Site data, entered in the admin only

/** A media item (its ID) or none; the form sends an empty string for none. */
const mediaRef = z.preprocess((v) => (v === '' ? null : v), z.uuid().nullable());

const siteData = {
  'site.contact': z.strictObject({ email: optionalEmail, phone }),
  'site.social': z.strictObject({
    links: z.array(z.strictObject({ network: serviceKey, url: httpUrl })).max(50),
  }),
  /** Footer text such as the copyright line; footer links are the `footer` menu. */
  'site.footer': z.strictObject({ text: localized(1000) }),
  /**
   * Logo, site icon (a square PNG; favicon, Apple Touch and PWA icons are derived from it) and
   * theme-color. Images are media IDs, recorded as media usages (docs/adr/0008).
   */
  'site.branding': z.strictObject({
    themeColor: z.union([
      z.literal(''),
      z
        .string()
        .regex(/^#[0-9a-fA-F]{6}$/)
        .transform((v) => v.toLowerCase()),
    ]),
    logo: mediaRef,
    icon: mediaRef,
  }),
  /**
   * The publisher's logo (Organization) or avatar (Person), and the main author: for a Person
   * publisher, the JSON-LD publisher is built from this author (name, avatar, sameAs, author
   * page) when one is chosen. The rest is configuration.
   */
  'site.publisher': z.strictObject({
    image: mediaRef,
    authorId: z.preprocess((v) => (v === '' ? null : v), z.uuid().nullable()),
  }),
} as const;

/** Media fields of the site data: what each needs from the file. */
type MediaField = Omit<UsageRef, 'mediaId' | 'field'>;
const MEDIA_FIELDS: Partial<Record<SiteDataKey, Record<string, MediaField>>> = {
  'site.branding': { logo: { kind: 'image' }, icon: { purpose: 'site_icon' } },
  'site.publisher': { image: { kind: 'image' } },
};

/** Media usages of a site data value. */
function mediaRefs<K extends SiteDataKey>(key: K, value: SiteData<K>): UsageRef[] {
  const fields: Record<string, MediaField> = MEDIA_FIELDS[key] ?? {};
  return Object.entries(fields).flatMap(([field, ref]) => {
    const mediaId = (value as Record<string, unknown>)[field];
    return typeof mediaId === 'string' ? [{ mediaId, field, ...ref }] : [];
  });
}

/**
 * Checks the media of a value and derives the files they need (before the transaction).
 * A media item that does not fit fails the field, with the reason (e.g. `not_square_png`).
 */
async function prepareRefs<K extends SiteDataKey>(
  media: MediaContext,
  key: K,
  value: SiteData<K>,
): Promise<UsageRef[]> {
  const refs = mediaRefs(key, value);
  for (const ref of refs) {
    try {
      await prepareMediaUse(media, [ref]);
    } catch (error) {
      if (!(error instanceof MediaError)) throw error;
      throw new InvalidInputError([ref.field], `invalid ${ref.field}: ${error.code}`, error.code);
    }
  }
  return refs;
}

export type SiteDataKey = keyof typeof siteData;
export type SiteData<K extends SiteDataKey> = z.output<(typeof siteData)[K]>;

export const SITE_DATA_DEFAULTS: { readonly [K in SiteDataKey]: SiteData<K> } = {
  'site.contact': { email: '', phone: '' },
  'site.social': { links: [] },
  'site.footer': { text: {} },
  'site.branding': { themeColor: '', logo: null, icon: null },
  'site.publisher': { image: null, authorId: null },
};

async function settingsValue(db: Executor, key: string): Promise<unknown> {
  const [row] = await db
    .select({ value: schema.settings.value })
    .from(schema.settings)
    .where(eq(schema.settings.key, key));
  return row?.value;
}

async function writeSetting(db: Executor, key: string, value: unknown): Promise<void> {
  await db
    .insert(schema.settings)
    .values({ key, value })
    .onConflictDoUpdate({ target: schema.settings.key, set: { value, updatedAt: sql`now()` } });
}

export async function readSiteData<K extends SiteDataKey>(
  db: Executor,
  key: K,
): Promise<SiteData<K>> {
  const stored = await settingsValue(db, key);
  const defaults = SITE_DATA_DEFAULTS[key];
  if (stored === undefined) return structuredClone(defaults);
  return siteData[key].parse({ ...defaults, ...(stored as object) }) as SiteData<K>;
}

/** Writes a site data value with its audit entry and, for media fields, its media usages. */
async function writeSiteData<K extends SiteDataKey>(
  tx: Executor,
  key: K,
  value: SiteData<K>,
  actor: Actor,
  refs?: UsageRef[],
): Promise<SiteData<K>> {
  const before = await readSiteData(tx, key);
  const fields = changedFields(before, value);
  if (fields.length > 0) {
    await writeSetting(tx, key, value);
    await audit(tx, {
      action: 'site.update',
      actorId: actor.id,
      targetType: 'settings',
      targetId: key,
      details: { [key]: fields },
      ip: actor.ip,
    });
  }
  if (refs) {
    try {
      await setMediaUsages(tx, { module: 'site', targetType: 'settings', targetId: key }, refs);
    } catch (error) {
      // Deleted between the check and the save.
      if (error instanceof MediaError) throw new InvalidInputError(refs.map((r) => r.field));
      throw error;
    }
  }
  return value;
}

async function saveSiteData<K extends SiteDataKey>(
  db: Database,
  key: K,
  input: unknown,
  actor: Actor,
  options: {
    merge?: (before: SiteData<K>, value: SiteData<K>, languages: string[]) => SiteData<K>;
    media?: MediaContext;
  } = {},
): Promise<SiteData<K>> {
  const parsed = parseInput(siteData[key], input) as SiteData<K>;
  const refs = options.media ? await prepareRefs(options.media, key, parsed) : undefined;
  return db.transaction(async (tx) => {
    const before = await readSiteData(tx, key);
    const value = options.merge
      ? options.merge(before, parsed, (await contentLanguages(tx)).codes)
      : parsed;
    return writeSiteData(tx, key, value, actor, refs);
  });
}

export const saveContact = (db: Database, input: unknown, actor: Actor) =>
  saveSiteData(db, 'site.contact', input, actor);

export const saveSocial = (db: Database, input: unknown, actor: Actor) =>
  saveSiteData(db, 'site.social', input, actor);

export const saveFooter = (db: Database, input: unknown, actor: Actor) =>
  saveSiteData(db, 'site.footer', input, actor, {
    merge: (before, value, languages) => ({
      text: mergeLocalized(before.text, value.text, languages),
    }),
  });

/** Logo, site icon and theme-color; the icons are derived from the site icon right away. */
export const saveBranding = (media: MediaContext, input: unknown, actor: Actor) =>
  saveSiteData(media.db, 'site.branding', input, actor, { media });

// ---------------------------------------------------------------------------------------------
// SMTP (chapter 8: notification mail is sent with these settings; the sender name is always
// "BluePax CMS", chapter 1). The password is encrypted with ENCRYPTION_KEY and never shown.

const SMTP_KEY = 'site.smtp';
export const SMTP_SECURITY = ['starttls', 'tls', 'none'] as const;

const smtpSchema = z.strictObject({
  host: z
    .string()
    .trim()
    .min(1)
    .max(253)
    .regex(/^[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?$/),
  port: z.int().min(1).max(65535),
  security: z.enum(SMTP_SECURITY),
  username: z.string().trim().max(256),
  fromAddress: z.email(),
});

export type SmtpSettings = z.output<typeof smtpSchema>;
interface StoredSmtp extends SmtpSettings {
  /** AES-256-GCM ciphertext, see security/crypto.ts. */
  password: string | null;
}
/** What the admin UI sees: whether a password is set, never the password. */
export interface SmtpView extends SmtpSettings {
  hasPassword: boolean;
}

async function storedSmtp(db: Executor): Promise<StoredSmtp | null> {
  const value = await settingsValue(db, SMTP_KEY);
  return value ? (value as StoredSmtp) : null;
}

export async function readSmtp(db: Executor): Promise<SmtpView | null> {
  const stored = await storedSmtp(db);
  if (!stored) return null;
  const { password, ...rest } = stored;
  return { ...rest, hasPassword: password !== null };
}

/** For the mailer: the settings with the password decrypted, or null when SMTP is not set up. */
export async function smtpCredentials(
  db: Executor,
  encryptionKey: Buffer,
): Promise<(SmtpSettings & { password: string | null }) | null> {
  const stored = await storedSmtp(db);
  if (!stored) return null;
  return { ...stored, password: stored.password ? decrypt(stored.password, encryptionKey) : null };
}

export interface SmtpPasswordChange {
  /** A new password; empty or absent keeps the stored one. */
  set?: string;
  clear?: boolean;
}

export async function saveSmtp(
  db: Database,
  input: unknown,
  password: SmtpPasswordChange,
  encryptionKey: Buffer,
  actor: Actor,
): Promise<SmtpView> {
  const settings = parseInput(smtpSchema, input);
  return db.transaction(async (tx) => {
    const before = await storedSmtp(tx);
    const change = password.set ? 'set' : password.clear ? 'cleared' : 'kept';
    const value: StoredSmtp = {
      ...settings,
      password:
        change === 'set'
          ? encrypt(password.set!, encryptionKey)
          : change === 'cleared'
            ? null
            : (before?.password ?? null),
    };
    await writeSetting(tx, SMTP_KEY, value);
    await audit(tx, {
      action: 'site.update',
      actorId: actor.id,
      targetType: 'settings',
      targetId: SMTP_KEY,
      details: {
        [SMTP_KEY]: changedFields(before && { ...before, password: undefined }, settings),
        password: change,
      },
      ip: actor.ip,
    });
    return { ...settings, hasPassword: value.password !== null };
  });
}

/** Removes the SMTP settings; mail is then not sent and passwords are reset by an admin. */
export async function clearSmtp(db: Database, actor: Actor): Promise<void> {
  await db.transaction(async (tx) => {
    const removed = await tx
      .delete(schema.settings)
      .where(eq(schema.settings.key, SMTP_KEY))
      .returning({ key: schema.settings.key });
    if (removed.length === 0) return;
    await audit(tx, {
      action: 'site.smtp_clear',
      actorId: actor.id,
      targetType: 'settings',
      targetId: SMTP_KEY,
      ip: actor.ip,
    });
  });
}
