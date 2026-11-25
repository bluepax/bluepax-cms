// Block pages (docs/spec/README.md chapters 3, 4 and 6; docs/adr/0009). Pages are flat. Each
// content language is a translation row with its own slug, title, SEO fields, status and
// blocks; the status is managed per language. In M1 edits change the content directly; the
// working copies of M2 will hold the same `PageContent` and publish it through `writeContent`.
import { randomUUID } from 'node:crypto';
import type { Block } from '@bluepax/cms-blocks';
import { isSlug, type ModuleId, type ModuleRegistry } from '@bluepax/core';
import {
  schema,
  type ContentStatus,
  type Database,
  type Executor,
  type Localized,
  type SeoFields,
} from '@bluepax/db';
import { routeFixedSegments } from '@bluepax/presets';
import {
  and,
  asc,
  count,
  desc,
  eq,
  exists,
  ilike,
  inArray,
  ne,
  notExists,
  or,
  sql,
} from 'drizzle-orm';
import { z } from 'zod';
import { audit } from '../../audit.ts';
import { emptySeo, seoSchema } from '../../content/seo.ts';
import { exportInstanceConfig } from '../../instance.ts';
import { MediaError } from '../media/errors.ts';
import {
  clearMediaUsages,
  prepareMediaUse,
  setMediaUsages,
  type MediaContext,
  type UsageRef,
} from '../media/library.ts';
import {
  blockOffer,
  blocksMediaUses,
  parseBlocks,
  readBlockData,
  type BlockMediaUse,
  type BlockOffer,
} from './blocks.ts';
import { PageError } from './errors.ts';
import { checkSlug } from './slugs.ts';

export interface Actor {
  id: string;
  ip: string | null;
}

export const TITLE_MAX_LENGTH = 200;

/** Status changes (chapter 3, "状态"): who may do them is checked by the caller. */
export const STATUS_ACTIONS = ['submit', 'withdraw', 'publish', 'unpublish'] as const;
export type StatusAction = (typeof STATUS_ACTIONS)[number];

const TRANSITIONS: Record<StatusAction, { from: readonly ContentStatus[]; to: ContentStatus }> = {
  submit: { from: ['draft', 'unpublished'], to: 'in_review' },
  withdraw: { from: ['in_review'], to: 'draft' },
  publish: { from: ['draft', 'in_review', 'unpublished'], to: 'published' },
  unpublish: { from: ['published'], to: 'unpublished' },
};

export function canTransition(status: ContentStatus, action: StatusAction): boolean {
  return TRANSITIONS[action].from.includes(status);
}

/** Columns a status change writes: the status, and the time of publishing or going offline. */
function statusFields(action: StatusAction) {
  return {
    status: TRANSITIONS[action].to,
    ...(action === 'publish' && { publishedAt: sql`now()` }),
    ...(action === 'unpublish' && { unpublishedAt: sql`now()` }),
  };
}

const target = (pageId: string, locale?: string) => ({
  module: 'pages',
  targetType: 'page',
  targetId: pageId,
  ...(locale !== undefined && { locale }),
});

/** The Postgres error behind a Drizzle error, if any. */
function pgError(error: unknown): { code?: string; constraint?: string } {
  let current: unknown = error;
  for (let i = 0; i < 5 && current; i++) {
    const e = current as { code?: unknown; constraint?: unknown; cause?: unknown };
    if (typeof e.code === 'string') {
      return {
        code: e.code,
        ...(typeof e.constraint === 'string' && { constraint: e.constraint }),
      };
    }
    current = e.cause;
  }
  return {};
}

const isUuid = (value: string) => z.uuid().safeParse(value).success;

// ---------------------------------------------------------------------------------------------
// Instance context

export interface PagesSetup {
  /** Content languages with their writing direction. */
  languages: { code: string; dir: 'ltr' | 'rtl' }[];
  primary: string;
  frontendBaseUrl: string;
  offer: BlockOffer;
  /** Reserved slugs: the configured ones and the fixed segments of the route templates. */
  reserved: { configured: string[]; routes: string[] };
}

export async function pagesSetup(
  db: Executor,
  registry: ModuleRegistry,
  active: ReadonlySet<ModuleId>,
): Promise<PagesSetup> {
  const config = await exportInstanceConfig(db);
  return {
    languages: config.languages.content.map((l) => ({ code: l.code, dir: l.dir })),
    primary: config.languages.primary,
    frontendBaseUrl: config.frontend.baseUrl,
    offer: blockOffer(config, registry, active),
    reserved: { configured: config.frontend.reservedSlugs, routes: routeFixedSegments() },
  };
}

async function requireLanguage(db: Executor, locale: string): Promise<void> {
  const config = await exportInstanceConfig(db);
  if (!config.languages.content.some((l) => l.code === locale)) {
    throw new PageError('invalid', { fields: ['locale'] });
  }
}

/** A unique violation on (locale, slug) from a concurrent save. */
function slugRace(error: unknown): never {
  const { code, constraint } = pgError(error);
  if (code === '23505' && constraint === 'pages_translations_locale_slug_unique') {
    throw new PageError('slug_taken', { fields: ['slug'] });
  }
  if (code === '23505' && constraint === 'pages_translations_entity_locale_unique') {
    throw new PageError('translation_exists', { fields: ['locale'] });
  }
  throw error;
}

// ---------------------------------------------------------------------------------------------
// Reading

export interface LanguageStatus {
  locale: string;
  status: ContentStatus;
}

export interface PageListItem {
  id: string;
  isHome: boolean;
  /** The language listed; null when the page has no version in it (`missing`). */
  locale: string | null;
  title: string;
  slug: string | null;
  status: ContentStatus | null;
  publishedAt: Date | null;
  updatedAt: Date;
  /** Status of every language version, for the list's language column. */
  languages: LanguageStatus[];
}

export interface PageFilter {
  locale: string;
  /** A status, `missing` (pages without this language) or undefined for all. */
  status?: ContentStatus | 'missing';
  /** Part of the title or slug. */
  query?: string;
  page?: number;
  pageSize?: number;
}

const escapeLike = (value: string) => value.replace(/[\\%_]/g, (c) => `\\${c}`);

async function languageStatuses(db: Executor, ids: string[]) {
  const map = new Map<string, (LanguageStatus & { title: string })[]>();
  if (ids.length === 0) return map;
  const rows = await db
    .select({
      pageId: schema.pagesTranslations.entityId,
      locale: schema.pagesTranslations.locale,
      status: schema.pagesTranslations.status,
      title: schema.pagesTranslations.title,
    })
    .from(schema.pagesTranslations)
    .where(inArray(schema.pagesTranslations.entityId, ids))
    .orderBy(asc(schema.pagesTranslations.locale));
  for (const row of rows) {
    map.set(row.pageId, [...(map.get(row.pageId) ?? []), row]);
  }
  return map;
}

export async function listPages(
  db: Executor,
  filter: PageFilter,
): Promise<{ items: PageListItem[]; total: number; page: number; pageSize: number }> {
  const pageSize = Math.min(Math.max(filter.pageSize ?? 50, 1), 200);
  const page = Math.max(filter.page ?? 1, 1);
  const query = filter.query?.trim();
  const t = schema.pagesTranslations;

  const matches = (q: string) =>
    or(ilike(t.title, `%${escapeLike(q)}%`), ilike(t.slug, `%${escapeLike(q)}%`));

  if (filter.status === 'missing') {
    const where = and(
      notExists(
        db
          .select({ one: sql`1` })
          .from(t)
          .where(and(eq(t.entityId, schema.pages.id), eq(t.locale, filter.locale))),
      ),
      query
        ? exists(
            db
              .select({ one: sql`1` })
              .from(t)
              .where(and(eq(t.entityId, schema.pages.id), matches(query))),
          )
        : undefined,
    );
    const [total] = await db.select({ n: count() }).from(schema.pages).where(where);
    const rows = await db
      .select({
        id: schema.pages.id,
        isHome: schema.pages.isHome,
        updatedAt: schema.pages.updatedAt,
      })
      .from(schema.pages)
      .where(where)
      .orderBy(desc(schema.pages.updatedAt), desc(schema.pages.id))
      .limit(pageSize)
      .offset((page - 1) * pageSize);
    const languages = await languageStatuses(
      db,
      rows.map((r) => r.id),
    );
    const items = rows.map((row) => {
      const versions = languages.get(row.id) ?? [];
      return {
        id: row.id,
        isHome: row.isHome,
        locale: null,
        // Shown in another language, since this one does not exist yet.
        title: versions[0]?.title ?? '',
        slug: null,
        status: null,
        publishedAt: null,
        updatedAt: row.updatedAt,
        languages: versions.map(({ locale, status }) => ({ locale, status })),
      };
    });
    return { items, total: total?.n ?? 0, page, pageSize };
  }

  const where = and(
    eq(t.locale, filter.locale),
    filter.status ? eq(t.status, filter.status) : undefined,
    query ? matches(query) : undefined,
  );
  const [total] = await db.select({ n: count() }).from(t).where(where);
  const rows = await db
    .select({
      id: schema.pages.id,
      isHome: schema.pages.isHome,
      locale: t.locale,
      title: t.title,
      slug: t.slug,
      status: t.status,
      publishedAt: t.publishedAt,
      updatedAt: t.updatedAt,
    })
    .from(t)
    .innerJoin(schema.pages, eq(schema.pages.id, t.entityId))
    .where(where)
    .orderBy(desc(schema.pages.isHome), desc(t.updatedAt), desc(t.id))
    .limit(pageSize)
    .offset((page - 1) * pageSize);
  const languages = await languageStatuses(
    db,
    rows.map((r) => r.id),
  );
  return {
    items: rows.map((row) => ({
      ...row,
      languages: (languages.get(row.id) ?? []).map(({ locale, status }) => ({ locale, status })),
    })),
    total: total?.n ?? 0,
    page,
    pageSize,
  };
}

export interface TranslationSummary extends LanguageStatus {
  title: string;
  slug: string;
}

export interface PageSummary {
  id: string;
  isHome: boolean;
  createdAt: Date;
  updatedAt: Date;
  translations: TranslationSummary[];
}

export async function getPage(db: Executor, id: string): Promise<PageSummary> {
  if (!isUuid(id)) throw new PageError('not_found');
  const [row] = await db.select().from(schema.pages).where(eq(schema.pages.id, id));
  if (!row) throw new PageError('not_found');
  const translations = await db
    .select({
      locale: schema.pagesTranslations.locale,
      status: schema.pagesTranslations.status,
      title: schema.pagesTranslations.title,
      slug: schema.pagesTranslations.slug,
    })
    .from(schema.pagesTranslations)
    .where(eq(schema.pagesTranslations.entityId, id))
    .orderBy(asc(schema.pagesTranslations.locale));
  return {
    id: row.id,
    isHome: row.isHome,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    translations,
  };
}

/** The editable content of one language (shared page fields are on the page itself). */
export interface PageContent {
  title: string;
  slug: string;
  seo: SeoFields;
  blocks: Block[];
}

export interface PageTranslation extends PageContent {
  id: string;
  pageId: string;
  locale: string;
  status: ContentStatus;
  publishedAt: Date | null;
  unpublishedAt: Date | null;
  updatedAt: Date;
  updatedBy: string | null;
}

async function storedBlocks(db: Executor, translationId: string): Promise<Block[]> {
  const rows = await db
    .select({
      id: schema.pageBlocks.id,
      type: schema.pageBlocks.type,
      data: schema.pageBlocks.data,
    })
    .from(schema.pageBlocks)
    .where(eq(schema.pageBlocks.translationId, translationId))
    .orderBy(asc(schema.pageBlocks.sortOrder));
  return rows.map((row) => ({ ...row, data: readBlockData(row.type, row.data) }) as Block);
}

async function findTranslation(db: Executor, pageId: string, locale: string, lock = false) {
  if (!isUuid(pageId)) return undefined;
  const query = db
    .select()
    .from(schema.pagesTranslations)
    .where(
      and(
        eq(schema.pagesTranslations.entityId, pageId),
        eq(schema.pagesTranslations.locale, locale),
      ),
    );
  const [row] = lock ? await query.for('update') : await query;
  return row;
}

export async function getTranslation(
  db: Executor,
  pageId: string,
  locale: string,
): Promise<PageTranslation> {
  const row = await findTranslation(db, pageId, locale);
  if (!row) throw new PageError('not_found');
  const [editor] = row.updatedBy
    ? await db
        .select({ name: schema.users.displayName })
        .from(schema.users)
        .where(eq(schema.users.id, row.updatedBy))
    : [];
  const seo = seoSchema.safeParse(row.seo);
  return {
    id: row.id,
    pageId: row.entityId,
    locale: row.locale,
    title: row.title,
    slug: row.slug,
    status: row.status,
    publishedAt: row.publishedAt,
    unpublishedAt: row.unpublishedAt,
    seo: seo.success ? seo.data : row.seo,
    blocks: await storedBlocks(db, row.id),
    updatedAt: row.updatedAt,
    updatedBy: editor?.name ?? null,
  };
}

/** Pages with their title and slug per language, e.g. for the navigation editor. */
export async function pageOptions(db: Executor) {
  const rows = await db
    .select({
      id: schema.pages.id,
      isHome: schema.pages.isHome,
      locale: schema.pagesTranslations.locale,
      title: schema.pagesTranslations.title,
      slug: schema.pagesTranslations.slug,
      status: schema.pagesTranslations.status,
    })
    .from(schema.pages)
    .innerJoin(schema.pagesTranslations, eq(schema.pagesTranslations.entityId, schema.pages.id))
    .orderBy(asc(schema.pagesTranslations.title));
  const pages = new Map<
    string,
    { id: string; isHome: boolean; titles: Localized; slugs: Localized; published: string[] }
  >();
  for (const row of rows) {
    const page = pages.get(row.id) ?? {
      id: row.id,
      isHome: row.isHome,
      titles: {},
      slugs: {},
      published: [],
    };
    page.titles[row.locale] = row.title;
    page.slugs[row.locale] = row.slug;
    if (row.status === 'published') page.published.push(row.locale);
    pages.set(row.id, page);
  }
  return [...pages.values()];
}

// ---------------------------------------------------------------------------------------------
// Writing

const titleSchema = z.string().trim().min(1).max(TITLE_MAX_LENGTH);

function parseTitle(value: string): string {
  const title = titleSchema.safeParse(value);
  if (!title.success) throw new PageError('invalid', { fields: ['title'] });
  return title.data;
}

function parseSeo(value: unknown): SeoFields {
  const seo = seoSchema.safeParse(value);
  if (!seo.success) {
    throw new PageError('invalid', {
      fields: seo.error.issues.map((i) => ['seo', ...i.path].join('.')),
    });
  }
  return seo.data;
}

interface MediaUse {
  ref: UsageRef;
  formField: string;
}

function contentMediaUses(content: Pick<PageContent, 'seo' | 'blocks'>): MediaUse[] {
  const uses: MediaUse[] = blocksMediaUses(content.blocks);
  if (content.seo.ogImage) {
    uses.push({
      ref: { mediaId: content.seo.ogImage, field: 'seo.ogImage', purpose: 'og', kind: 'image' },
      formField: 'seo.ogImage',
    });
  }
  return uses;
}

/**
 * Checks the media of a language's content and derives what they need (the OG image), before
 * the transaction. A media item that does not fit fails its form field with the reason.
 */
async function prepareMedia(ctx: MediaContext, uses: readonly MediaUse[]): Promise<void> {
  for (const use of uses) {
    try {
      await prepareMediaUse(ctx, [use.ref]);
    } catch (error) {
      if (!(error instanceof MediaError)) throw error;
      throw new PageError('media', { fields: [use.formField], reason: error.code });
    }
  }
}

async function writeUsages(
  tx: Executor,
  pageId: string,
  locale: string,
  uses: readonly (MediaUse | BlockMediaUse)[],
): Promise<void> {
  try {
    await setMediaUsages(
      tx,
      target(pageId, locale),
      uses.map((u) => u.ref),
    );
  } catch (error) {
    // Deleted between the check and the save.
    if (error instanceof MediaError) {
      throw new PageError('media', {
        fields: uses.map((u) => u.formField),
        reason: error.code,
      });
    }
    throw error;
  }
}

/**
 * Writes the content of one language: the translation row and its blocks. Callers hold the
 * row lock and have validated the content. This is the step that publishing a working copy
 * will reuse in M2.
 */
async function writeContent(
  tx: Executor,
  translationId: string,
  content: PageContent,
  actor: Actor,
  statusChange?: StatusAction,
): Promise<void> {
  await tx
    .update(schema.pagesTranslations)
    .set({
      title: content.title,
      slug: content.slug,
      seo: content.seo,
      updatedBy: actor.id,
      updatedAt: sql`now()`,
      ...(statusChange && statusFields(statusChange)),
    })
    .where(eq(schema.pagesTranslations.id, translationId));
  await tx.delete(schema.pageBlocks).where(eq(schema.pageBlocks.translationId, translationId));
  if (content.blocks.length > 0) {
    await tx.insert(schema.pageBlocks).values(
      content.blocks.map((block, sortOrder) => ({
        id: block.id,
        translationId,
        sortOrder,
        type: block.type,
        data: block.data,
      })),
    );
  }
}

async function touchPage(tx: Executor, pageId: string): Promise<void> {
  await tx
    .update(schema.pages)
    .set({ updatedAt: sql`now()` })
    .where(eq(schema.pages.id, pageId));
}

export interface NewTranslation {
  locale: string;
  title: string;
  slug: string;
}

/** Creates a page with its first language version, as a draft. */
export async function createPage(
  ctx: MediaContext,
  input: NewTranslation,
  actor: Actor,
): Promise<string> {
  const title = parseTitle(input.title);
  try {
    return await ctx.db.transaction(async (tx) => {
      await requireLanguage(tx, input.locale);
      await checkSlug(tx, input.locale, input.slug);
      const [page] = await tx
        .insert(schema.pages)
        .values({ createdBy: actor.id })
        .returning({ id: schema.pages.id });
      const id = page!.id;
      await tx.insert(schema.pagesTranslations).values({
        entityId: id,
        locale: input.locale,
        slug: input.slug,
        title,
        seo: emptySeo(),
        createdBy: actor.id,
        updatedBy: actor.id,
      });
      await audit(tx, {
        action: 'pages.create',
        actorId: actor.id,
        targetType: 'page',
        targetId: id,
        details: { locale: input.locale, slug: input.slug },
        ip: actor.ip,
      });
      return id;
    });
  } catch (error) {
    if (error instanceof PageError) throw error;
    return slugRace(error);
  }
}

/**
 * Adds a language version to a page, as a draft. With `copyFrom`, the blocks of that language
 * are copied (with new IDs) to start the translation from.
 */
export async function createTranslation(
  ctx: MediaContext,
  pageId: string,
  input: NewTranslation & { copyFrom?: string | undefined },
  actor: Actor,
): Promise<void> {
  const title = parseTitle(input.title);
  await getPage(ctx.db, pageId);
  let blocks: Block[] = [];
  if (input.copyFrom) {
    const source = await findTranslation(ctx.db, pageId, input.copyFrom);
    if (!source) throw new PageError('invalid', { fields: ['copyFrom'] });
    blocks = (await storedBlocks(ctx.db, source.id)).map(
      (block) => ({ ...block, id: randomUUID() }) as Block,
    );
  }
  const uses = blocksMediaUses(blocks);
  await prepareMedia(ctx, uses);
  try {
    await ctx.db.transaction(async (tx) => {
      await requireLanguage(tx, input.locale);
      const [page] = await tx
        .select({ id: schema.pages.id })
        .from(schema.pages)
        .where(eq(schema.pages.id, pageId))
        .for('update');
      if (!page) throw new PageError('not_found');
      if (await findTranslation(tx, pageId, input.locale)) {
        throw new PageError('translation_exists', { fields: ['locale'] });
      }
      await checkSlug(tx, input.locale, input.slug, pageId);
      const [row] = await tx
        .insert(schema.pagesTranslations)
        .values({
          entityId: pageId,
          locale: input.locale,
          slug: input.slug,
          title,
          seo: emptySeo(),
          createdBy: actor.id,
          updatedBy: actor.id,
        })
        .returning({ id: schema.pagesTranslations.id });
      await writeContent(tx, row!.id, { title, slug: input.slug, seo: emptySeo(), blocks }, actor);
      await writeUsages(tx, pageId, input.locale, uses);
      await touchPage(tx, pageId);
      await audit(tx, {
        action: 'pages.translation_create',
        actorId: actor.id,
        targetType: 'page',
        targetId: pageId,
        details: {
          locale: input.locale,
          slug: input.slug,
          ...(input.copyFrom && { copyFrom: input.copyFrom }),
        },
        ip: actor.ip,
      });
    });
  } catch (error) {
    if (error instanceof PageError) throw error;
    slugRace(error);
  }
}

export interface ContentInput {
  title: string;
  slug: string;
  /** SEO fields as submitted; see seoSchema. */
  seo: unknown;
  /** Blocks as submitted: `{ id?, type, data }[]`. */
  blocks: unknown;
}

export interface SaveOptions {
  /**
   * `updatedAt` of the language when the editor opened it (ISO 8601). If someone saved since,
   * the save is refused with `edit_conflict` (409) instead of overwriting their changes.
   */
  version?: string | undefined;
  /** A status change in the same transaction, e.g. save and publish. */
  status?: StatusAction | undefined;
  /** The blocks and features this instance offers, see pagesSetup. */
  offer: BlockOffer;
}

/** Fields whose values differ, for the audit log (names only). */
function changedFields(before: PageContent, after: PageContent): string[] {
  const fields: string[] = [];
  if (before.title !== after.title) fields.push('title');
  if (before.slug !== after.slug) fields.push('slug');
  if (JSON.stringify(before.seo) !== JSON.stringify(after.seo)) fields.push('seo');
  if (JSON.stringify(before.blocks) !== JSON.stringify(after.blocks)) fields.push('blocks');
  return fields;
}

/**
 * Saves the content of one language (and optionally changes its status). Validation covers the
 * title, the slug (format, reserved, unique in the language), the SEO fields, the blocks on
 * offer and the media they use. Published content changes directly in M1.
 */
export async function saveTranslation(
  ctx: MediaContext,
  pageId: string,
  locale: string,
  input: ContentInput,
  actor: Actor,
  options: SaveOptions,
): Promise<{ slugChanged: boolean; status: ContentStatus }> {
  const current = await getTranslation(ctx.db, pageId, locale);
  const errors: string[] = [];
  const attempt = <T>(run: () => T): T | undefined => {
    try {
      return run();
    } catch (error) {
      if (error instanceof PageError && error.code === 'invalid') {
        errors.push(...(error.details.fields ?? []));
        return undefined;
      }
      throw error;
    }
  };
  const title = attempt(() => parseTitle(input.title));
  const seo = attempt(() => parseSeo(input.seo));
  const blocks = attempt(() =>
    parseBlocks(input.blocks, options.offer, new Map(current.blocks.map((b) => [b.id, b]))),
  );
  if (!isSlug(input.slug)) errors.push('slug');
  if (errors.length > 0 || !title || !seo || !blocks) {
    throw new PageError('invalid', { fields: [...new Set(errors)] });
  }
  const content: PageContent = { title, slug: input.slug, seo, blocks };
  const uses = contentMediaUses(content);
  await prepareMedia(ctx, uses);

  try {
    return await ctx.db.transaction(async (tx) => {
      const row = await findTranslation(tx, pageId, locale, true);
      if (!row) throw new PageError('not_found');
      if (options.version && row.updatedAt.toISOString() !== options.version) {
        throw new PageError('edit_conflict');
      }
      if (content.slug !== row.slug) await checkSlug(tx, locale, content.slug, pageId);
      if (options.status && !canTransition(row.status, options.status)) {
        throw new PageError('invalid_status');
      }
      const status = options.status ? TRANSITIONS[options.status].to : row.status;
      const before = { ...current, slug: row.slug };
      await writeContent(tx, row.id, content, actor, options.status);
      await writeUsages(tx, pageId, locale, uses);
      await touchPage(tx, pageId);
      const fields = changedFields(before, content);
      if (fields.length > 0) {
        await audit(tx, {
          action: 'pages.update',
          actorId: actor.id,
          targetType: 'page',
          targetId: pageId,
          details: { locale, fields },
          ip: actor.ip,
        });
      }
      const slugChanged = content.slug !== row.slug;
      if (slugChanged) {
        // Kept so that the redirects of M2 (seo) can be written for addresses that were live.
        await audit(tx, {
          action: 'pages.slug_change',
          actorId: actor.id,
          targetType: 'page',
          targetId: pageId,
          details: {
            locale,
            from: row.slug,
            to: content.slug,
            published: row.status === 'published',
          },
          ip: actor.ip,
        });
        // TODO(M2): write the 301 for a published address and emit `content.slug_changed`.
      }
      if (options.status) await auditStatus(tx, pageId, locale, row.status, status, actor);
      return { slugChanged, status };
    });
  } catch (error) {
    if (error instanceof PageError) throw error;
    return slugRace(error);
  }
}

async function auditStatus(
  tx: Executor,
  pageId: string,
  locale: string,
  from: ContentStatus,
  to: ContentStatus,
  actor: Actor,
): Promise<void> {
  const action =
    to === 'published'
      ? 'pages.publish'
      : to === 'unpublished'
        ? 'pages.unpublish'
        : 'pages.status';
  await audit(tx, {
    action,
    actorId: actor.id,
    targetType: 'page',
    targetId: pageId,
    details: { locale, from, to },
    ip: actor.ip,
  });
  // TODO(M2): emit `content.published` / `content.unpublished` with the affected paths.
}

/** Changes the status of one language without saving content. */
export async function changeStatus(
  db: Database,
  pageId: string,
  locale: string,
  action: StatusAction,
  actor: Actor,
): Promise<ContentStatus> {
  return db.transaction(async (tx) => {
    const row = await findTranslation(tx, pageId, locale, true);
    if (!row) throw new PageError('not_found');
    if (!canTransition(row.status, action)) throw new PageError('invalid_status');
    const to = TRANSITIONS[action].to;
    await tx
      .update(schema.pagesTranslations)
      .set({ ...statusFields(action), updatedBy: actor.id, updatedAt: sql`now()` })
      .where(eq(schema.pagesTranslations.id, row.id));
    await touchPage(tx, pageId);
    await auditStatus(tx, pageId, locale, row.status, to, actor);
    return to;
  });
}

/** Makes a page the home page (`/{locale}`); the previous home page becomes an ordinary page. */
export async function setHomePage(db: Database, pageId: string, actor: Actor): Promise<void> {
  if (!isUuid(pageId)) throw new PageError('not_found');
  await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('bluepax:pages:home'))`);
    const [page] = await tx
      .select({ id: schema.pages.id, isHome: schema.pages.isHome })
      .from(schema.pages)
      .where(eq(schema.pages.id, pageId))
      .for('update');
    if (!page) throw new PageError('not_found');
    if (page.isHome) return;
    const previous = await tx
      .update(schema.pages)
      .set({ isHome: false, updatedAt: sql`now()` })
      .where(eq(schema.pages.isHome, true))
      .returning({ id: schema.pages.id });
    await tx
      .update(schema.pages)
      .set({ isHome: true, updatedAt: sql`now()` })
      .where(eq(schema.pages.id, pageId));
    await audit(tx, {
      action: 'pages.home',
      actorId: actor.id,
      targetType: 'page',
      targetId: pageId,
      details: { previous: previous[0]?.id ?? null },
      ip: actor.ip,
    });
  });
}

/** Menu items that link to a page, by label in the primary language. */
async function navigationLinks(tx: Executor, pageId: string): Promise<string[]> {
  const rows = await tx
    .select({ menu: schema.navItems.menu, label: schema.navItems.label })
    .from(schema.navItems)
    .where(eq(schema.navItems.pageId, pageId));
  const { primary } = (await exportInstanceConfig(tx)).languages;
  return rows.map((r) => `${r.menu}: ${r.label[primary] ?? Object.values(r.label)[0] ?? ''}`);
}

/** Deletes one language version with its blocks; the last one is refused (delete the page). */
export async function deleteTranslation(
  db: Database,
  pageId: string,
  locale: string,
  actor: Actor,
): Promise<void> {
  if (!isUuid(pageId)) throw new PageError('not_found');
  await db.transaction(async (tx) => {
    const [page] = await tx
      .select({ id: schema.pages.id })
      .from(schema.pages)
      .where(eq(schema.pages.id, pageId))
      .for('update');
    if (!page) throw new PageError('not_found');
    const row = await findTranslation(tx, pageId, locale, true);
    if (!row) throw new PageError('not_found');
    const [others] = await tx
      .select({ n: count() })
      .from(schema.pagesTranslations)
      .where(
        and(eq(schema.pagesTranslations.entityId, pageId), ne(schema.pagesTranslations.id, row.id)),
      );
    if ((others?.n ?? 0) === 0) throw new PageError('last_translation');
    await tx.delete(schema.pagesTranslations).where(eq(schema.pagesTranslations.id, row.id));
    await clearMediaUsages(tx, target(pageId, locale));
    await touchPage(tx, pageId);
    await audit(tx, {
      action: 'pages.translation_delete',
      actorId: actor.id,
      targetType: 'page',
      targetId: pageId,
      details: { locale, slug: row.slug, title: row.title, status: row.status },
      ip: actor.ip,
    });
    // TODO(M2): mark a published address as 410 and emit `content.deleted`.
  });
}

/**
 * Deletes a page with every language version. The home page and pages that menus link to are
 * refused, so neither the home address nor a menu item is left pointing nowhere.
 */
export async function deletePage(db: Database, pageId: string, actor: Actor): Promise<void> {
  if (!isUuid(pageId)) throw new PageError('not_found');
  await db.transaction(async (tx) => {
    const [page] = await tx
      .select({ id: schema.pages.id, isHome: schema.pages.isHome })
      .from(schema.pages)
      .where(eq(schema.pages.id, pageId))
      .for('update');
    if (!page) throw new PageError('not_found');
    if (page.isHome) throw new PageError('home_page');
    const links = await navigationLinks(tx, pageId);
    if (links.length > 0) throw new PageError('in_navigation', { items: links });
    const versions = await tx
      .select({
        locale: schema.pagesTranslations.locale,
        slug: schema.pagesTranslations.slug,
        status: schema.pagesTranslations.status,
      })
      .from(schema.pagesTranslations)
      .where(eq(schema.pagesTranslations.entityId, pageId));
    await clearMediaUsages(tx, target(pageId));
    try {
      await tx.delete(schema.pages).where(eq(schema.pages.id, pageId));
    } catch (error) {
      // A menu item was added meanwhile (nav_items.page_id is ON DELETE RESTRICT).
      if (pgError(error).code === '23503') throw new PageError('in_navigation', { items: [] });
      throw error;
    }
    await audit(tx, {
      action: 'pages.delete',
      actorId: actor.id,
      targetType: 'page',
      targetId: pageId,
      details: { versions },
      ip: actor.ip,
    });
    // TODO(M2): mark published addresses as 410 and emit `content.deleted`.
  });
}
