// Post slugs that collide with reserved slugs, e.g. before slugs become reserved in the
// frontend settings (chapter 2: page and post slugs may not use reserved slugs).
import { schema, type Executor } from '@bluepax/db';
import { asc, inArray } from 'drizzle-orm';

/** Post languages that use any of the given slugs. */
export async function postsUsingSlugs(db: Executor, slugs: readonly string[]) {
  if (slugs.length === 0) return [];
  const t = schema.postsTranslations;
  return db
    .select({ postId: t.entityId, locale: t.locale, slug: t.slug, title: t.title })
    .from(t)
    .where(inArray(t.slug, [...slugs]))
    .orderBy(asc(t.slug), asc(t.locale));
}
