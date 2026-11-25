// Post categories and tags (docs/spec/README.md chapters 3, 4 and 6; docs/adr/0010). Both are
// flat lists of routable terms with a name, slug, description and SEO fields per content
// language; a term exists in a language when it has a translation there. Categories have an
// order and cannot be deleted while posts, menu items or page blocks use them; deleting a tag
// removes it from its posts.
import { schema, type Database, type Executor, type Localized, type SeoFields } from '@bluepax/db';
import { and, asc, count, desc, eq, exists, ilike, inArray, ne, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import { audit } from '../../audit.ts';
import { emptySeo } from '../../content/seo.ts';
import { escapeLike, isUuid, pgError } from '../../content/status.ts';
import { clearMediaUsages, type MediaContext } from '../media/library.ts';
import {
  changedFields,
  checkSlug,
  contentSetup,
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
} from './common.ts';
import { PostError } from './errors.ts';
import { blockUses, navUses } from './references.ts';

export type TermKind = 'category' | 'tag';

export const NAME_MAX_LENGTH = 200;
export const DESCRIPTION_MAX_LENGTH = 2000;

// Both translation tables have the same columns; the category tables stand for both in types.
type Main = typeof schema.postCategories;
type Translations = typeof schema.postCategoriesTranslations;

function tables(kind: TermKind) {
  return kind === 'category'
    ? {
        main: schema.postCategories as Main,
        t: schema.postCategoriesTranslations,
        linkTerm: schema.postCategoryLinks.categoryId,
        links: schema.postCategoryLinks,
      }
    : {
        // Tags have no order column; `sortOrder` is never read or written for them.
        main: schema.tags as unknown as Main,
        t: schema.tagsTranslations as unknown as Translations,
        linkTerm: schema.postTagLinks
          .tagId as unknown as typeof schema.postCategoryLinks.categoryId,
        links: schema.postTagLinks as unknown as typeof schema.postCategoryLinks,
      };
}

const target = (kind: TermKind, id: string, locale?: string) => ({
  module: 'posts',
  targetType: kind,
  targetId: id,
  ...(locale !== undefined && { locale }),
});

// ---------------------------------------------------------------------------------------------
// Reading

export interface TermListItem {
  id: string;
  sortOrder: number;
  names: Localized;
  slugs: Localized;
  /** Posts that have this term. */
  posts: number;
  updatedAt: Date;
}

async function versionsOf(db: Executor, kind: TermKind, ids: string[]) {
  const { t } = tables(kind);
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

async function postCounts(db: Executor, kind: TermKind, ids: string[]) {
  const { links, linkTerm } = tables(kind);
  if (ids.length === 0) return new Map<string, number>();
  const rows = await db
    .select({ id: linkTerm, n: count() })
    .from(links)
    .where(inArray(linkTerm, ids))
    .groupBy(linkTerm);
  return new Map(rows.map((r) => [r.id, r.n]));
}

/** Terms with their names and slugs per language; categories in order, tags by recency. */
export async function listTerms(
  db: Executor,
  kind: TermKind,
  filter: { query?: string; page?: number; pageSize?: number } = {},
): Promise<{ items: TermListItem[]; total: number; page: number; pageSize: number }> {
  const { main, t } = tables(kind);
  const pageSize = Math.min(Math.max(filter.pageSize ?? 100, 1), 500);
  const page = Math.max(filter.page ?? 1, 1);
  const query = filter.query?.trim();
  const where = query
    ? exists(
        db
          .select({ one: sql`1` })
          .from(t)
          .where(
            and(
              eq(t.entityId, main.id),
              or(ilike(t.name, `%${escapeLike(query)}%`), ilike(t.slug, `%${escapeLike(query)}%`)),
            ),
          ),
      )
    : undefined;
  const [total] = await db.select({ n: count() }).from(main).where(where);
  const rows = await db
    .select({
      id: main.id,
      ...(kind === 'category' && { sortOrder: main.sortOrder }),
      updatedAt: main.updatedAt,
    })
    .from(main)
    .where(where)
    .orderBy(
      ...(kind === 'category'
        ? [asc(main.sortOrder), asc(main.createdAt)]
        : [desc(main.createdAt), desc(main.id)]),
    )
    .limit(pageSize)
    .offset((page - 1) * pageSize);
  const ids = rows.map((r) => r.id);
  const [versions, counts] = await Promise.all([
    versionsOf(db, kind, ids),
    postCounts(db, kind, ids),
  ]);
  return {
    items: rows.map((row) => ({
      id: row.id,
      sortOrder: row.sortOrder ?? 0,
      names: versions.get(row.id)?.names ?? {},
      slugs: versions.get(row.id)?.slugs ?? {},
      posts: counts.get(row.id) ?? 0,
      updatedAt: row.updatedAt,
    })),
    total: total?.n ?? 0,
    page,
    pageSize,
  };
}

/** Every term with its names, for pickers: categories in order, tags by name. */
export async function termOptions(
  db: Executor,
  kind: TermKind,
): Promise<{ id: string; names: Localized }[]> {
  const { items } = await listTerms(db, kind, { pageSize: 500 });
  const options = items.map(({ id, names }) => ({ id, names }));
  if (kind === 'tag') {
    const first = (names: Localized) => Object.values(names)[0] ?? '';
    options.sort((a, b) => first(a.names).localeCompare(first(b.names)));
  }
  return options;
}

export interface TermTranslation {
  locale: string;
  name: string;
  slug: string;
  description: string;
  seo: SeoFields;
  updatedAt: Date;
}

export interface Term {
  id: string;
  kind: TermKind;
  sortOrder: number;
  posts: number;
  /** Version for edit conflicts: changes with every save. */
  updatedAt: Date;
  translations: TermTranslation[];
}

export async function getTerm(db: Executor, kind: TermKind, id: string): Promise<Term> {
  if (!isUuid(id)) throw new PostError('not_found');
  const { main, t } = tables(kind);
  const [row] = await db
    .select({
      id: main.id,
      ...(kind === 'category' && { sortOrder: main.sortOrder }),
      updatedAt: main.updatedAt,
    })
    .from(main)
    .where(eq(main.id, id));
  if (!row) throw new PostError('not_found');
  const translations = await db
    .select({
      locale: t.locale,
      name: t.name,
      slug: t.slug,
      description: t.description,
      seo: t.seo,
      updatedAt: t.updatedAt,
    })
    .from(t)
    .where(eq(t.entityId, id))
    .orderBy(asc(t.locale));
  const counts = await postCounts(db, kind, [id]);
  return {
    id: row.id,
    kind,
    sortOrder: row.sortOrder ?? 0,
    posts: counts.get(id) ?? 0,
    updatedAt: row.updatedAt,
    translations,
  };
}

// ---------------------------------------------------------------------------------------------
// Writing

const audited = (kind: TermKind, event: string) => `posts.${kind}_${event}`;

/** Creates a term with its first language version. */
export async function createTerm(
  db: Database,
  kind: TermKind,
  input: { locale: string; name: string; slug: string },
  actor: Actor,
): Promise<string> {
  const checks = fieldChecks();
  const name = checks.attempt(() => requiredText(input.name, 'name', NAME_MAX_LENGTH));
  checks.throwIfFailed();
  const { main, t } = tables(kind);
  try {
    return await db.transaction(async (tx) => {
      await requireLanguage(tx, input.locale);
      await checkSlug(tx, kind, input.locale, input.slug);
      let sortOrder = 0;
      if (kind === 'category') {
        // New categories go last.
        const [last] = await tx
          .select({ max: sql<number | null>`max(${main.sortOrder})` })
          .from(main);
        sortOrder = (last?.max ?? -10) + 10;
      }
      const [row] = await tx
        .insert(main)
        .values(kind === 'category' ? { sortOrder } : {})
        .returning({ id: main.id });
      const id = row!.id;
      await tx.insert(t).values({
        entityId: id,
        locale: input.locale,
        name: name!,
        slug: input.slug,
        seo: emptySeo(),
      });
      await audit(tx, {
        action: audited(kind, 'create'),
        actorId: actor.id,
        targetType: kind,
        targetId: id,
        details: { locale: input.locale, slug: input.slug },
        ip: actor.ip,
      });
      return id;
    });
  } catch (error) {
    if (error instanceof PostError) throw error;
    return uniqueRace(kind, error);
  }
}

export interface TermInput {
  name: string;
  slug: string;
  description: string;
  /** SEO fields as submitted; see seoSchema. */
  seo: unknown;
  /** Categories only. */
  sortOrder?: number;
}

/**
 * Saves one language of a term, adding the language version if it does not exist yet, and the
 * shared order of a category. `version` is the term's `updatedAt` when the editor opened it;
 * if anyone saved the term since, the save is refused with `edit_conflict` (409).
 */
export async function saveTerm(
  ctx: MediaContext,
  kind: TermKind,
  id: string,
  locale: string,
  input: TermInput,
  actor: Actor,
  options: { version?: string | undefined } = {},
): Promise<{ created: boolean }> {
  await getTerm(ctx.db, kind, id);
  const checks = fieldChecks();
  const name = checks.attempt(() => requiredText(input.name, 'name', NAME_MAX_LENGTH));
  const description = checks.attempt(() =>
    optionalText(input.description, 'description', DESCRIPTION_MAX_LENGTH),
  );
  const seo = checks.attempt(() => parseSeo(input.seo));
  // A category keeps its order unless the form sends one.
  const sortOrder =
    kind === 'category' && input.sortOrder !== undefined
      ? z.int().min(-1_000_000).max(1_000_000).safeParse(input.sortOrder)
      : null;
  if (sortOrder && !sortOrder.success) checks.fail('sortOrder');
  checks.throwIfFailed();
  const uses = ogImageUse(seo!.ogImage);
  await prepareMedia(ctx, uses);
  const { main, t } = tables(kind);

  try {
    return await ctx.db.transaction(async (tx) => {
      await requireLanguage(tx, locale);
      const [entity] = await tx
        .select({
          updatedAt: main.updatedAt,
          ...(kind === 'category' && { sortOrder: main.sortOrder }),
        })
        .from(main)
        .where(eq(main.id, id))
        .for('update');
      if (!entity) throw new PostError('not_found');
      if (options.version && entity.updatedAt.toISOString() !== options.version) {
        throw new PostError('edit_conflict');
      }
      const [before] = await tx
        .select()
        .from(t)
        .where(and(eq(t.entityId, id), eq(t.locale, locale)));
      if (!before || before.slug !== input.slug) await checkSlug(tx, kind, locale, input.slug, id);
      const values = { name: name!, slug: input.slug, description: description!, seo: seo! };
      if (before) {
        await tx
          .update(t)
          .set({ ...values, updatedAt: sql`now()` })
          .where(eq(t.id, before.id));
      } else {
        await tx.insert(t).values({ entityId: id, locale, ...values });
      }
      const order = sortOrder?.success ? sortOrder.data : undefined;
      await tx
        .update(main)
        .set({ updatedAt: sql`now()`, ...(order !== undefined && { sortOrder: order }) })
        .where(eq(main.id, id));
      await writeUsages(tx, target(kind, id, locale), uses);

      const fields = before
        ? changedFields(
            {
              name: before.name,
              slug: before.slug,
              description: before.description,
              seo: before.seo,
            },
            values,
          )
        : [];
      if (order !== undefined && order !== entity.sortOrder) fields.push('sortOrder');
      if (!before) {
        await audit(tx, {
          action: audited(kind, 'translation_create'),
          actorId: actor.id,
          targetType: kind,
          targetId: id,
          details: { locale, slug: input.slug },
          ip: actor.ip,
        });
      } else if (fields.length > 0) {
        await audit(tx, {
          action: audited(kind, 'update'),
          actorId: actor.id,
          targetType: kind,
          targetId: id,
          details: { locale, fields },
          ip: actor.ip,
        });
      }
      if (before && before.slug !== input.slug) {
        // Kept so that the redirects of M2 (seo) can be written for addresses that were live.
        await audit(tx, {
          action: audited(kind, 'slug_change'),
          actorId: actor.id,
          targetType: kind,
          targetId: id,
          details: { locale, from: before.slug, to: input.slug },
          ip: actor.ip,
        });
        // TODO(M2): write the 301 and emit `content.slug_changed`.
      }
      return { created: !before };
    });
  } catch (error) {
    if (error instanceof PostError) throw error;
    return uniqueRace(kind, error);
  }
}

/** Deletes one language version of a term; the last one is refused (delete the term). */
export async function deleteTermTranslation(
  db: Database,
  kind: TermKind,
  id: string,
  locale: string,
  actor: Actor,
): Promise<void> {
  if (!isUuid(id)) throw new PostError('not_found');
  const { main, t } = tables(kind);
  await db.transaction(async (tx) => {
    const [entity] = await tx
      .select({ id: main.id })
      .from(main)
      .where(eq(main.id, id))
      .for('update');
    if (!entity) throw new PostError('not_found');
    const [row] = await tx
      .select({ id: t.id, slug: t.slug, name: t.name })
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
      .update(main)
      .set({ updatedAt: sql`now()` })
      .where(eq(main.id, id));
    await clearMediaUsages(tx, target(kind, id, locale));
    await audit(tx, {
      action: audited(kind, 'translation_delete'),
      actorId: actor.id,
      targetType: kind,
      targetId: id,
      details: { locale, slug: row.slug, name: row.name },
      ip: actor.ip,
    });
    // TODO(M2): mark the address as 410 and emit `content.deleted`.
  });
}

/**
 * Deletes a term with every language version. A category is refused while posts have it
 * (`has_posts`) or menu items or page blocks use it (`in_use`); a tag is removed from its posts.
 */
export async function deleteTerm(
  db: Database,
  kind: TermKind,
  id: string,
  actor: Actor,
): Promise<void> {
  if (!isUuid(id)) throw new PostError('not_found');
  const { main, t } = tables(kind);
  await db.transaction(async (tx) => {
    const [entity] = await tx
      .select({ id: main.id })
      .from(main)
      .where(eq(main.id, id))
      .for('update');
    if (!entity) throw new PostError('not_found');
    const versions = await tx
      .select({ locale: t.locale, slug: t.slug, name: t.name })
      .from(t)
      .where(eq(t.entityId, id));
    const posts = (await postCounts(tx, kind, [id])).get(id) ?? 0;
    if (kind === 'category') {
      if (posts > 0) throw new PostError('has_posts', { count: posts });
      const { primary } = await contentSetup(tx);
      const items = [
        ...(await navUses(tx, { postCategoryId: id }, primary)),
        ...(await blockUses(tx, { categoryId: id })),
      ];
      if (items.length > 0) throw new PostError('in_use', { items });
    }
    await clearMediaUsages(tx, target(kind, id));
    try {
      await tx.delete(main).where(eq(main.id, id));
    } catch (error) {
      // A post or menu item took the category meanwhile (both are ON DELETE RESTRICT).
      if (pgError(error).code === '23503') throw new PostError('in_use', { items: [] });
      throw error;
    }
    await audit(tx, {
      action: audited(kind, 'delete'),
      actorId: actor.id,
      targetType: kind,
      targetId: id,
      details: { versions, posts },
      ip: actor.ip,
    });
    // TODO(M2): mark the addresses as 410 and emit `content.deleted`.
  });
}
