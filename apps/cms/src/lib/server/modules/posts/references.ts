// Where posts and post categories are used outside the posts module: menu items (site) and the
// featured-posts and latest-posts blocks of pages. Used records cannot be deleted, and page
// blocks may only point at records that exist (docs/adr/0010).
import type { Block } from '@bluepax/cms-blocks';
import { schema, type Executor } from '@bluepax/db';
import { and, eq, inArray, sql } from 'drizzle-orm';

/** Menu items that link to a post or a category, as `menu: label` in the primary language. */
export async function navUses(
  db: Executor,
  link: { postId: string } | { postCategoryId: string },
  primary: string,
): Promise<string[]> {
  const rows = await db
    .select({ menu: schema.navItems.menu, label: schema.navItems.label })
    .from(schema.navItems)
    .where(
      'postId' in link
        ? eq(schema.navItems.postId, link.postId)
        : eq(schema.navItems.postCategoryId, link.postCategoryId),
    );
  return rows.map((r) => `${r.menu}: ${r.label[primary] ?? Object.values(r.label)[0] ?? ''}`);
}

/** Page languages whose featured-posts or latest-posts blocks use a post or a category. */
export async function blockUses(
  db: Executor,
  ref: { postId: string } | { categoryId: string },
): Promise<string[]> {
  const b = schema.pageBlocks;
  const where =
    'postId' in ref
      ? and(
          eq(b.type, 'featured-posts'),
          sql`${b.data} -> 'postIds' @> ${JSON.stringify([ref.postId])}::jsonb`,
        )
      : and(
          inArray(b.type, ['featured-posts', 'latest-posts']),
          sql`${b.data} ->> 'categoryId' = ${ref.categoryId}`,
        );
  const rows = await db
    .selectDistinct({
      locale: schema.pagesTranslations.locale,
      title: schema.pagesTranslations.title,
    })
    .from(b)
    .innerJoin(schema.pagesTranslations, eq(schema.pagesTranslations.id, b.translationId))
    .where(where);
  return rows.map((r) => `${r.locale}: ${r.title}`);
}

/** Post and category IDs a block points at, with their form paths inside the block data. */
export function blockReferences(
  block: Block,
): { path: string; kind: 'post' | 'category'; id: string }[] {
  if (block.type !== 'featured-posts' && block.type !== 'latest-posts') return [];
  const refs: { path: string; kind: 'post' | 'category'; id: string }[] = [];
  if (block.data.categoryId)
    refs.push({ path: 'categoryId', kind: 'category', id: block.data.categoryId });
  if (block.type === 'featured-posts') {
    block.data.postIds.forEach((id, i) => refs.push({ path: `postIds.${i}`, kind: 'post', id }));
  }
  return refs;
}

/**
 * Form fields of blocks that point at a post or category that does not exist, e.g.
 * `blocks.2.data.postIds.0`. Existing records are locked against deletion until the
 * transaction ends.
 */
export async function unknownBlockReferences(
  db: Executor,
  blocks: readonly Block[],
): Promise<string[]> {
  const refs = blocks.flatMap((block, index) =>
    blockReferences(block).map((ref) => ({ ...ref, field: `blocks.${index}.data.${ref.path}` })),
  );
  if (refs.length === 0) return [];
  const postIds = [...new Set(refs.filter((r) => r.kind === 'post').map((r) => r.id))];
  const categoryIds = [...new Set(refs.filter((r) => r.kind === 'category').map((r) => r.id))];
  const found = new Set<string>();
  if (postIds.length > 0) {
    const rows = await db
      .select({ id: schema.posts.id })
      .from(schema.posts)
      .where(inArray(schema.posts.id, postIds))
      .for('key share');
    for (const row of rows) found.add(`post ${row.id}`);
  }
  if (categoryIds.length > 0) {
    const rows = await db
      .select({ id: schema.postCategories.id })
      .from(schema.postCategories)
      .where(inArray(schema.postCategories.id, categoryIds))
      .for('key share');
    for (const row of rows) found.add(`category ${row.id}`);
  }
  return refs.filter((r) => !found.has(`${r.kind} ${r.id}`)).map((r) => r.field);
}
