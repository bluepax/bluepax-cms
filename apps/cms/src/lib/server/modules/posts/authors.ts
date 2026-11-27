// Authors of posts (docs/spec/README.md chapters 4 and 6; docs/adr/0010): display name, job
// title, bio, slug and SEO fields per content language; avatar, sameAs, whether there is a
// public author page and the linked admin account are shared. An author exists in a language
// when it has a translation there. A blog names one author as its main author, the Person
// publisher of the site settings (docs/adr/0007).
import {
  allQueries,
  schema,
  type Database,
  type Executor,
  type Localized,
  type SeoFields,
} from '@bluepax/db';
import { httpUrl } from '@bluepax/presets';
import { and, asc, count, eq, inArray, ne, sql } from 'drizzle-orm';
import { z } from 'zod';
import { audit } from '../../audit.ts';
import { emptySeo } from '../../content/seo.ts';
import { isUuid, pgError } from '../../content/status.ts';
import { clearMediaUsages, type MediaContext } from '../media/library.ts';
import {
  changedFields,
  checkSlug,
  fieldChecks,
  ogImageUse,
  optionalText,
  parseSeo,
  prepareMedia,
  requireLanguage,
  requiredText,
  uniqueRace,
  writeUsages,
  type Actor,
  type MediaUse,
} from './common.ts';
import { PostError } from './errors.ts';

export const AUTHOR_NAME_MAX_LENGTH = 200;
export const JOB_TITLE_MAX_LENGTH = 200;
export const BIO_MAX_LENGTH = 5000;
export const SAME_AS_MAX = 20;

const target = (id: string, locale?: string) => ({
  module: 'posts',
  targetType: 'author',
  targetId: id,
  ...(locale !== undefined && { locale }),
});

/** The site's main author: the Person publisher (settings row `site.publisher`). */
export async function primaryAuthorId(db: Executor): Promise<string | null> {
  const [row] = await db
    .select({ value: schema.settings.value })
    .from(schema.settings)
    .where(eq(schema.settings.key, 'site.publisher'));
  const id = (row?.value as { authorId?: unknown } | undefined)?.authorId;
  return typeof id === 'string' ? id : null;
}

// ---------------------------------------------------------------------------------------------
// Reading

export interface AuthorListItem {
  id: string;
  names: Localized;
  slugs: Localized;
  publicPage: boolean;
  /** Display name of the linked account. */
  account: string | null;
  posts: number;
  primary: boolean;
  updatedAt: Date;
}

async function translationsOf(db: Executor, ids: string[]) {
  const t = schema.authorsTranslations;
  const map = new Map<string, { names: Localized; slugs: Localized }>();
  if (ids.length === 0) return map;
  const rows = await db
    .select({ id: t.entityId, locale: t.locale, name: t.name, slug: t.slug })
    .from(t)
    .where(inArray(t.entityId, ids))
    .orderBy(asc(t.locale));
  for (const row of rows) {
    const entry = map.get(row.id) ?? { names: {}, slugs: {} };
    entry.names[row.locale] = row.name;
    entry.slugs[row.locale] = row.slug;
    map.set(row.id, entry);
  }
  return map;
}

async function postCounts(db: Executor, ids: string[]) {
  if (ids.length === 0) return new Map<string, number>();
  const l = schema.postAuthorLinks;
  const rows = await db
    .select({ id: l.authorId, n: count() })
    .from(l)
    .where(inArray(l.authorId, ids))
    .groupBy(l.authorId);
  return new Map(rows.map((r) => [r.id, r.n]));
}

export async function listAuthors(db: Executor): Promise<AuthorListItem[]> {
  const rows = await db
    .select({
      id: schema.authors.id,
      publicPage: schema.authors.publicPage,
      account: schema.users.displayName,
      updatedAt: schema.authors.updatedAt,
    })
    .from(schema.authors)
    .leftJoin(schema.users, eq(schema.users.id, schema.authors.userId))
    .orderBy(asc(schema.authors.createdAt), asc(schema.authors.id));
  const ids = rows.map((r) => r.id);
  const [versions, counts, primary] = await allQueries(db, [
    () => translationsOf(db, ids),
    () => postCounts(db, ids),
    () => primaryAuthorId(db),
  ]);
  return rows.map((row) => ({
    ...row,
    names: versions.get(row.id)?.names ?? {},
    slugs: versions.get(row.id)?.slugs ?? {},
    posts: counts.get(row.id) ?? 0,
    primary: row.id === primary,
  }));
}

/** Every author with their names, for pickers. */
export async function authorOptions(db: Executor): Promise<{ id: string; names: Localized }[]> {
  return (await listAuthors(db)).map(({ id, names }) => ({ id, names }));
}

/** The author linked to an admin account, if any. */
export async function authorOfUser(db: Executor, userId: string): Promise<string | null> {
  const [row] = await db
    .select({ id: schema.authors.id })
    .from(schema.authors)
    .where(eq(schema.authors.userId, userId));
  return row?.id ?? null;
}

export interface AuthorTranslation {
  locale: string;
  name: string;
  slug: string;
  jobTitle: string;
  bio: string;
  seo: SeoFields;
}

export interface Author {
  id: string;
  userId: string | null;
  avatar: string | null;
  sameAs: string[];
  publicPage: boolean;
  posts: number;
  primary: boolean;
  /** Version for edit conflicts: changes with every save. */
  updatedAt: Date;
  translations: AuthorTranslation[];
}

export async function getAuthor(db: Executor, id: string): Promise<Author> {
  if (!isUuid(id)) throw new PostError('not_found');
  const [row] = await db.select().from(schema.authors).where(eq(schema.authors.id, id));
  if (!row) throw new PostError('not_found');
  const t = schema.authorsTranslations;
  const translations = await db
    .select({
      locale: t.locale,
      name: t.name,
      slug: t.slug,
      jobTitle: t.jobTitle,
      bio: t.bio,
      seo: t.seo,
    })
    .from(t)
    .where(eq(t.entityId, id))
    .orderBy(asc(t.locale));
  return {
    id: row.id,
    userId: row.userId,
    avatar: row.avatar,
    sameAs: row.sameAs,
    publicPage: row.publicPage,
    posts: (await postCounts(db, [id])).get(id) ?? 0,
    primary: (await primaryAuthorId(db)) === id,
    updatedAt: row.updatedAt,
    translations,
  };
}

/** Admin accounts an author can be linked to, with the author that has each one. */
export async function accountOptions(db: Executor) {
  return db
    .select({
      id: schema.users.id,
      displayName: schema.users.displayName,
      email: schema.users.email,
      authorId: schema.authors.id,
    })
    .from(schema.users)
    .leftJoin(schema.authors, eq(schema.authors.userId, schema.users.id))
    .orderBy(asc(schema.users.displayName));
}

// ---------------------------------------------------------------------------------------------
// Writing

/** One author per account; a taken account names the author that has it. */
async function checkAccount(db: Executor, userId: string | null, authorId?: string) {
  if (!userId) return;
  if (!isUuid(userId)) throw new PostError('invalid', { fields: ['userId'] });
  const [user] = await db
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(eq(schema.users.id, userId));
  if (!user) throw new PostError('invalid', { fields: ['userId'] });
  const [taken] = await db
    .select({ name: schema.authorsTranslations.name })
    .from(schema.authors)
    .leftJoin(
      schema.authorsTranslations,
      eq(schema.authorsTranslations.entityId, schema.authors.id),
    )
    .where(
      and(
        eq(schema.authors.userId, userId),
        authorId ? ne(schema.authors.id, authorId) : undefined,
      ),
    )
    .limit(1);
  if (taken) throw new PostError('account_taken', { fields: ['userId'], title: taken.name ?? '' });
}

/** A unique violation of a concurrent save: the slug, the language or the account is taken. */
function authorRace(error: unknown): never {
  const { code, constraint } = pgError(error);
  if (code === '23505' && constraint === 'authors_user_unique') {
    throw new PostError('account_taken', { fields: ['userId'] });
  }
  return uniqueRace('author', error);
}

/** Creates an author with a first language version, optionally linked to an account. */
export async function createAuthor(
  db: Database,
  input: { locale: string; name: string; slug: string; userId?: string | null },
  actor: Actor,
): Promise<string> {
  const checks = fieldChecks();
  const name = checks.attempt(() => requiredText(input.name, 'name', AUTHOR_NAME_MAX_LENGTH));
  checks.throwIfFailed();
  try {
    return await db.transaction(async (tx) => {
      await requireLanguage(tx, input.locale);
      await checkSlug(tx, 'author', input.locale, input.slug);
      await checkAccount(tx, input.userId ?? null);
      const [row] = await tx
        .insert(schema.authors)
        .values({ userId: input.userId ?? null })
        .returning({ id: schema.authors.id });
      const id = row!.id;
      await tx.insert(schema.authorsTranslations).values({
        entityId: id,
        locale: input.locale,
        name: name!,
        slug: input.slug,
        seo: emptySeo(),
      });
      await audit(tx, {
        action: 'posts.author_create',
        actorId: actor.id,
        targetType: 'author',
        targetId: id,
        details: { locale: input.locale, slug: input.slug, linked: Boolean(input.userId) },
        ip: actor.ip,
      });
      return id;
    });
  } catch (error) {
    if (error instanceof PostError) throw error;
    return authorRace(error);
  }
}

export interface AuthorInput {
  name: string;
  slug: string;
  jobTitle: string;
  bio: string;
  /** SEO fields as submitted; see seoSchema. */
  seo: unknown;
  /** Fields shared by all languages. */
  avatar: string | null;
  sameAs: string[];
  publicPage: boolean;
  userId: string | null;
}

const sameAsSchema = z
  .array(httpUrl)
  .max(SAME_AS_MAX)
  .transform((values) => [...new Set(values)]);

/**
 * Saves one language of an author (adding it if missing) together with the shared fields.
 * `version` is the author's `updatedAt` when the editor opened it; if anyone saved the author
 * since, the save is refused with `edit_conflict` (409).
 */
export async function saveAuthor(
  ctx: MediaContext,
  id: string,
  locale: string,
  input: AuthorInput,
  actor: Actor,
  options: { version?: string | undefined } = {},
): Promise<{ created: boolean }> {
  const current = await getAuthor(ctx.db, id);
  const checks = fieldChecks();
  const name = checks.attempt(() => requiredText(input.name, 'name', AUTHOR_NAME_MAX_LENGTH));
  const jobTitle = checks.attempt(() =>
    optionalText(input.jobTitle, 'jobTitle', JOB_TITLE_MAX_LENGTH),
  );
  const bio = checks.attempt(() => optionalText(input.bio, 'bio', BIO_MAX_LENGTH));
  const seo = checks.attempt(() => parseSeo(input.seo));
  const sameAs = sameAsSchema.safeParse(input.sameAs);
  if (!sameAs.success) checks.fail('sameAs');
  if (input.avatar !== null && !isUuid(input.avatar)) checks.fail('avatar');
  checks.throwIfFailed();
  const shared = {
    avatar: input.avatar,
    sameAs: sameAs.data!,
    publicPage: input.publicPage,
    userId: input.userId,
  };
  const sharedUses: MediaUse[] = shared.avatar
    ? [{ ref: { mediaId: shared.avatar, field: 'avatar', kind: 'image' }, formField: 'avatar' }]
    : [];
  const uses = ogImageUse(seo!.ogImage);
  await prepareMedia(ctx, [...sharedUses, ...uses]);
  const t = schema.authorsTranslations;

  try {
    return await ctx.db.transaction(async (tx) => {
      await requireLanguage(tx, locale);
      const [entity] = await tx
        .select()
        .from(schema.authors)
        .where(eq(schema.authors.id, id))
        .for('update');
      if (!entity) throw new PostError('not_found');
      if (options.version && entity.updatedAt.toISOString() !== options.version) {
        throw new PostError('edit_conflict');
      }
      if (shared.userId !== entity.userId) await checkAccount(tx, shared.userId, id);
      const [before] = await tx
        .select()
        .from(t)
        .where(and(eq(t.entityId, id), eq(t.locale, locale)));
      if (!before || before.slug !== input.slug)
        await checkSlug(tx, 'author', locale, input.slug, id);
      const values = {
        name: name!,
        slug: input.slug,
        jobTitle: jobTitle!,
        bio: bio!,
        seo: seo!,
      };
      if (before) {
        await tx
          .update(t)
          .set({ ...values, updatedAt: sql`now()` })
          .where(eq(t.id, before.id));
      } else {
        await tx.insert(t).values({ entityId: id, locale, ...values });
      }
      await tx
        .update(schema.authors)
        .set({ ...shared, updatedAt: sql`now()` })
        .where(eq(schema.authors.id, id));
      await writeUsages(tx, target(id, ''), sharedUses);
      await writeUsages(tx, target(id, locale), uses);

      const fields = [
        ...changedFields(
          {
            avatar: entity.avatar,
            sameAs: entity.sameAs,
            publicPage: entity.publicPage,
            userId: entity.userId,
          },
          shared,
        ),
        ...(before
          ? changedFields(
              {
                name: before.name,
                slug: before.slug,
                jobTitle: before.jobTitle,
                bio: before.bio,
                seo: before.seo,
              },
              values,
            )
          : []),
      ];
      if (!before) {
        await audit(tx, {
          action: 'posts.author_translation_create',
          actorId: actor.id,
          targetType: 'author',
          targetId: id,
          details: { locale, slug: input.slug },
          ip: actor.ip,
        });
      }
      if (fields.length > 0) {
        await audit(tx, {
          action: 'posts.author_update',
          actorId: actor.id,
          targetType: 'author',
          targetId: id,
          details: { locale, fields },
          ip: actor.ip,
        });
      }
      if (before && before.slug !== input.slug) {
        await audit(tx, {
          action: 'posts.author_slug_change',
          actorId: actor.id,
          targetType: 'author',
          targetId: id,
          details: { locale, from: before.slug, to: input.slug, public: current.publicPage },
          ip: actor.ip,
        });
        // TODO(M2): write the 301 and emit `content.slug_changed`.
      }
      return { created: !before };
    });
  } catch (error) {
    if (error instanceof PostError) throw error;
    return authorRace(error);
  }
}

/** Deletes one language version of an author; the last one is refused (delete the author). */
export async function deleteAuthorTranslation(
  db: Database,
  id: string,
  locale: string,
  actor: Actor,
): Promise<void> {
  if (!isUuid(id)) throw new PostError('not_found');
  const t = schema.authorsTranslations;
  await db.transaction(async (tx) => {
    const [entity] = await tx
      .select({ id: schema.authors.id })
      .from(schema.authors)
      .where(eq(schema.authors.id, id))
      .for('update');
    if (!entity) throw new PostError('not_found');
    const [row] = await tx
      .select({ id: t.id, slug: t.slug })
      .from(t)
      .where(and(eq(t.entityId, id), eq(t.locale, locale)));
    if (!row) throw new PostError('not_found');
    const [others] = await tx
      .select({ n: count() })
      .from(t)
      .where(and(eq(t.entityId, id), ne(t.id, row.id)));
    if ((others?.n ?? 0) === 0) throw new PostError('last_translation');
    await tx.delete(t).where(eq(t.id, row.id));
    await tx
      .update(schema.authors)
      .set({ updatedAt: sql`now()` })
      .where(eq(schema.authors.id, id));
    await clearMediaUsages(tx, target(id, locale));
    await audit(tx, {
      action: 'posts.author_translation_delete',
      actorId: actor.id,
      targetType: 'author',
      targetId: id,
      details: { locale, slug: row.slug },
      ip: actor.ip,
    });
  });
}

/**
 * Deletes an author with every language version. Refused while posts credit the author
 * (`has_posts`) or while it is the site's main author (`primary_author`).
 */
export async function deleteAuthor(db: Database, id: string, actor: Actor): Promise<void> {
  if (!isUuid(id)) throw new PostError('not_found');
  await db.transaction(async (tx) => {
    // Serialise with changes of the publisher, which name the main author.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('bluepax:site:publisher'))`);
    const [entity] = await tx
      .select({ id: schema.authors.id })
      .from(schema.authors)
      .where(eq(schema.authors.id, id))
      .for('update');
    if (!entity) throw new PostError('not_found');
    if ((await primaryAuthorId(tx)) === id) throw new PostError('primary_author');
    const posts = (await postCounts(tx, [id])).get(id) ?? 0;
    if (posts > 0) throw new PostError('has_posts', { count: posts });
    const versions = await tx
      .select({
        locale: schema.authorsTranslations.locale,
        slug: schema.authorsTranslations.slug,
      })
      .from(schema.authorsTranslations)
      .where(eq(schema.authorsTranslations.entityId, id));
    await clearMediaUsages(tx, target(id));
    try {
      await tx.delete(schema.authors).where(eq(schema.authors.id, id));
    } catch (error) {
      // A post credited the author meanwhile (post_author_links is ON DELETE RESTRICT).
      if (pgError(error).code === '23503') throw new PostError('has_posts', { count: 1 });
      throw error;
    }
    await audit(tx, {
      action: 'posts.author_delete',
      actorId: actor.id,
      targetType: 'author',
      targetId: id,
      details: { versions },
      ip: actor.ip,
    });
    // TODO(M2): mark public author pages as 410 and emit `content.deleted`.
  });
}
