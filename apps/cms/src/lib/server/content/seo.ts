// SEO fields of routable content per language (docs/spec/README.md chapter 3, "SEO 面板"):
// pages now, posts, catalog items, categories and authors later.
import type { SeoFields } from '@bluepax/db';
import { httpUrl } from '@bluepax/presets';
import { z } from 'zod';

/** Lengths the panel recommends; longer texts are cut off in search results. */
export const SEO_RECOMMENDED = { title: 60, description: 160 } as const;

const text = (max: number) => z.string().trim().max(max).default('');

export const seoSchema = z.strictObject({
  metaTitle: text(200),
  metaDescription: text(500),
  canonical: z.union([z.literal(''), httpUrl]).default(''),
  robots: z
    .strictObject({ index: z.boolean().default(true), follow: z.boolean().default(true) })
    .prefault({}),
  ogTitle: text(200),
  ogDescription: text(500),
  ogImage: z.uuid().nullable().default(null),
  keywords: z
    .array(z.string().trim().min(1).max(100))
    .max(20)
    .default([])
    .transform((values) => [...new Set(values)]),
  summary: text(500),
}) satisfies z.ZodType<SeoFields>;

export function emptySeo(): SeoFields {
  return seoSchema.parse({});
}
