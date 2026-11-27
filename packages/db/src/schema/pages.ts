// Tables of the pages module, see docs/spec/README.md chapters 3, 4 and 6 and docs/adr/0009.
// A page is flat (no parent); each content language has its own translation row with slug,
// title, SEO fields, status and publishing times, and its own ordered list of blocks.
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { users } from './core.ts';

const timestamptz = (name: string) => timestamp(name, { withTimezone: true });

const timestamps = {
  createdAt: timestamptz('created_at').notNull().defaultNow(),
  updatedAt: timestamptz('updated_at').notNull().defaultNow(),
};

/** Status of one language of a routable content item (chapter 3, "状态"). */
export const CONTENT_STATUSES = ['draft', 'in_review', 'published', 'unpublished'] as const;
export type ContentStatus = (typeof CONTENT_STATUSES)[number];

/**
 * SEO fields of one language (chapter 3, "SEO 面板"). Empty texts fall back when delivered:
 * OG text → meta → global default; OG image → first image → global default share image.
 */
export interface SeoFields {
  metaTitle: string;
  metaDescription: string;
  /** Empty: the address generated from the route templates. */
  canonical: string;
  robots: { index: boolean; follow: boolean };
  ogTitle: string;
  ogDescription: string;
  /** Media ID of the OG image; a 1200×630 JPG is derived from it. */
  ogImage: string | null;
  /** Target keywords. */
  keywords: string[];
  /** One-sentence answer to the page's main question ("一句话结论"). */
  summary: string;
}

/** Fields shared by all languages of a page. */
export const pages = pgTable(
  'pages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** The home page lives at `/{locale}` (chapter 6); at most one page is the home page. */
    isHome: boolean('is_home').notNull().default(false),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('pages_home_unique')
      .on(t.isHome)
      .where(sql`${t.isHome}`),
  ],
);

export const pagesTranslations = pgTable(
  'pages_translations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    entityId: uuid('entity_id')
      .notNull()
      .references(() => pages.id, { onDelete: 'cascade' }),
    /** BCP 47 code of a content language. */
    locale: text('locale').notNull(),
    slug: text('slug').notNull(),
    title: text('title').notNull(),
    status: text('status').$type<ContentStatus>().notNull().default('draft'),
    /** Last time this language was published. */
    publishedAt: timestamptz('published_at'),
    /** Last time this language was taken offline. */
    unpublishedAt: timestamptz('unpublished_at'),
    seo: jsonb('seo').$type<SeoFields>().notNull(),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    updatedBy: uuid('updated_by').references(() => users.id, { onDelete: 'set null' }),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('pages_translations_entity_locale_unique').on(t.entityId, t.locale),
    uniqueIndex('pages_translations_locale_slug_unique').on(t.locale, t.slug),
    index('pages_translations_list_idx').on(t.locale, t.status, t.publishedAt.desc()),
    check(
      'pages_translations_status_check',
      sql`${t.status} in ('draft', 'in_review', 'published', 'unpublished')`,
    ),
  ],
);

/**
 * Blocks of one language of a page, in order. `data` follows the block's schema in
 * @bluepax/cms-blocks; the ID stays the same while the block exists.
 */
export const pageBlocks = pgTable(
  'page_blocks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    translationId: uuid('translation_id')
      .notNull()
      .references(() => pagesTranslations.id, { onDelete: 'cascade' }),
    sortOrder: integer('sort_order').notNull(),
    /** Block key, e.g. `hero`. */
    type: text('type').notNull(),
    data: jsonb('data').notNull(),
  },
  (t) => [uniqueIndex('page_blocks_order_unique').on(t.translationId, t.sortOrder)],
);
