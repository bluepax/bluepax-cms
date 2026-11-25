// Slugs of pages (docs/spec/README.md chapters 2 and 6): lowercase Latin, unique per language,
// and never one of the reserved slugs — those of the instance configuration's frontend section
// plus the fixed segments of the route templates (`blog`, `authors`, ...).
import { isSlug } from '@bluepax/core';
import { schema, type Executor } from '@bluepax/db';
import { routeFixedSegments } from '@bluepax/presets';
import { and, asc, eq, inArray, ne } from 'drizzle-orm';
import { exportInstanceConfig } from '../../instance.ts';
import { PageError } from './errors.ts';

/** Reserved slugs: the configured ones (frontend section) and the route templates' segments. */
export async function reservedSlugs(db: Executor): Promise<Set<string>> {
  const config = await exportInstanceConfig(db);
  return new Set([...config.frontend.reservedSlugs, ...routeFixedSegments()]);
}

/**
 * Checks a slug for one language: lowercase Latin (`isSlug`), not reserved, not used by another
 * page in the same language (`slug_taken`, 409).
 */
export async function checkSlug(
  db: Executor,
  locale: string,
  slug: string,
  pageId?: string,
): Promise<void> {
  if (!isSlug(slug)) throw new PageError('invalid', { fields: ['slug'] });
  if ((await reservedSlugs(db)).has(slug)) {
    throw new PageError('slug_reserved', { fields: ['slug'] });
  }
  const [taken] = await db
    .select({ title: schema.pagesTranslations.title })
    .from(schema.pagesTranslations)
    .where(
      and(
        eq(schema.pagesTranslations.locale, locale),
        eq(schema.pagesTranslations.slug, slug),
        pageId ? ne(schema.pagesTranslations.entityId, pageId) : undefined,
      ),
    );
  if (taken) throw new PageError('slug_taken', { fields: ['slug'], title: taken.title });
}

/** Page languages that use any of the given slugs, e.g. before they become reserved. */
export async function pagesUsingSlugs(db: Executor, slugs: readonly string[]) {
  if (slugs.length === 0) return [];
  return db
    .select({
      pageId: schema.pagesTranslations.entityId,
      locale: schema.pagesTranslations.locale,
      slug: schema.pagesTranslations.slug,
      title: schema.pagesTranslations.title,
    })
    .from(schema.pagesTranslations)
    .where(inArray(schema.pagesTranslations.slug, [...slugs]))
    .orderBy(asc(schema.pagesTranslations.slug), asc(schema.pagesTranslations.locale));
}
