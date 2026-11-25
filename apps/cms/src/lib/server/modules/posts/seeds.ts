// The post categories of the instance configuration (chapter 2, "文章：预置分类"; docs/adr/0010).
// An instance starts with the categories of its config file or preset; the export writes the
// current categories back in the same format, so a fresh instance gets the same ones. Only the
// names and slugs belong to the configuration; descriptions and SEO fields are content.
// This file only uses the tables, so instance.ts can import it without a cycle.
import { schema, type Executor } from '@bluepax/db';
import type { PostCategorySeed } from '@bluepax/presets';
import { asc, eq } from 'drizzle-orm';
import { emptySeo } from '../../content/seo.ts';

/** Creates the categories of a configuration, in order (initialisation only). */
export async function seedPostCategories(
  tx: Executor,
  seeds: readonly PostCategorySeed[],
): Promise<void> {
  for (const [index, seed] of seeds.entries()) {
    const [row] = await tx
      .insert(schema.postCategories)
      .values({ sortOrder: index * 10 })
      .returning({ id: schema.postCategories.id });
    await tx.insert(schema.postCategoriesTranslations).values(
      Object.entries(seed.name).map(([locale, name]) => ({
        entityId: row!.id,
        locale,
        name,
        slug: seed.slug[locale]!,
        seo: emptySeo(),
      })),
    );
  }
}

/**
 * The current categories in the configuration format: names and slugs of the given content
 * languages, in category order. Languages that are no longer content languages are left out,
 * and so are categories without a name in any of them.
 */
export async function postCategorySeeds(
  db: Executor,
  codes: readonly string[],
): Promise<PostCategorySeed[]> {
  const rows = await db
    .select({
      id: schema.postCategories.id,
      locale: schema.postCategoriesTranslations.locale,
      name: schema.postCategoriesTranslations.name,
      slug: schema.postCategoriesTranslations.slug,
    })
    .from(schema.postCategories)
    .innerJoin(
      schema.postCategoriesTranslations,
      eq(schema.postCategoriesTranslations.entityId, schema.postCategories.id),
    )
    .orderBy(asc(schema.postCategories.sortOrder), asc(schema.postCategories.createdAt));
  const byId = new Map<string, Map<string, { name: string; slug: string }>>();
  for (const row of rows) {
    const versions = byId.get(row.id) ?? new Map();
    versions.set(row.locale, { name: row.name, slug: row.slug });
    byId.set(row.id, versions);
  }
  const seeds: PostCategorySeed[] = [];
  for (const versions of byId.values()) {
    const seed: PostCategorySeed = { name: {}, slug: {} };
    for (const code of codes) {
      const version = versions.get(code);
      if (!version) continue;
      seed.name[code] = version.name;
      seed.slug[code] = version.slug;
    }
    if (Object.keys(seed.name).length > 0) seeds.push(seed);
  }
  return seeds;
}
