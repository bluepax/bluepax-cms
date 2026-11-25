// Tables of the posts module, see docs/spec/README.md chapters 3, 4 and 6 and docs/adr/0010.
// Posts, post categories, tags and authors are routable content: a main table with the fields
// shared by all languages, and a `_translations` table with one row per content language
// (slug, title or name, texts, SEO fields). Only posts have a status per language; a category,
// tag or author exists in a language when it has a translation there. Categories, tags and
// authors are linked to posts through link tables that keep the editor's order.
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { users } from './core.ts';
import type { ContentStatus, SeoFields } from './pages.ts';

const timestamptz = (name: string) => timestamp(name, { withTimezone: true });

const timestamps = {
  createdAt: timestamptz('created_at').notNull().defaultNow(),
  updatedAt: timestamptz('updated_at').notNull().defaultNow(),
};

/** Where the text of a post language comes from (chapter 7): written by hand or an AI draft. */
export const POST_SOURCES = ['manual', 'ai'] as const;
export type PostSource = (typeof POST_SOURCES)[number];

/** Rich text as Tiptap (ProseMirror) JSON, validated by @bluepax/cms-blocks. */
export interface RichTextJson {
  type: 'doc';
  content?: unknown[];
}

// ---------------------------------------------------------------------------------------------
// Categories and tags

/** Post categories; flat, in the editor's order. */
export const postCategories = pgTable('post_categories', {
  id: uuid('id').primaryKey().defaultRandom(),
  sortOrder: integer('sort_order').notNull().default(0),
  ...timestamps,
});

export const postCategoriesTranslations = pgTable(
  'post_categories_translations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    entityId: uuid('entity_id')
      .notNull()
      .references(() => postCategories.id, { onDelete: 'cascade' }),
    locale: text('locale').notNull(),
    slug: text('slug').notNull(),
    name: text('name').notNull(),
    description: text('description').notNull().default(''),
    seo: jsonb('seo').$type<SeoFields>().notNull(),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('post_categories_translations_entity_locale_unique').on(t.entityId, t.locale),
    uniqueIndex('post_categories_translations_locale_slug_unique').on(t.locale, t.slug),
  ],
);

export const tags = pgTable('tags', {
  id: uuid('id').primaryKey().defaultRandom(),
  ...timestamps,
});

export const tagsTranslations = pgTable(
  'tags_translations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    entityId: uuid('entity_id')
      .notNull()
      .references(() => tags.id, { onDelete: 'cascade' }),
    locale: text('locale').notNull(),
    slug: text('slug').notNull(),
    name: text('name').notNull(),
    description: text('description').notNull().default(''),
    seo: jsonb('seo').$type<SeoFields>().notNull(),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('tags_translations_entity_locale_unique').on(t.entityId, t.locale),
    uniqueIndex('tags_translations_locale_slug_unique').on(t.locale, t.slug),
  ],
);

// ---------------------------------------------------------------------------------------------
// Authors

export const authors = pgTable(
  'authors',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** The admin account of this author, if any; one author per account. */
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    /** Media ID of the avatar. */
    avatar: uuid('avatar'),
    /** Profiles elsewhere (JSON-LD `sameAs`). */
    sameAs: jsonb('same_as').$type<string[]>().notNull().default([]),
    /** Whether the frontend has an author page (`/{locale}/authors/{slug}`). */
    publicPage: boolean('public_page').notNull().default(true),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('authors_user_unique')
      .on(t.userId)
      .where(sql`${t.userId} is not null`),
  ],
);

export const authorsTranslations = pgTable(
  'authors_translations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    entityId: uuid('entity_id')
      .notNull()
      .references(() => authors.id, { onDelete: 'cascade' }),
    locale: text('locale').notNull(),
    slug: text('slug').notNull(),
    /** Display name. */
    name: text('name').notNull(),
    jobTitle: text('job_title').notNull().default(''),
    bio: text('bio').notNull().default(''),
    seo: jsonb('seo').$type<SeoFields>().notNull(),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('authors_translations_entity_locale_unique').on(t.entityId, t.locale),
    uniqueIndex('authors_translations_locale_slug_unique').on(t.locale, t.slug),
  ],
);

// ---------------------------------------------------------------------------------------------
// Posts

/**
 * Fields shared by all languages of a post. `updated_at` changes only with these fields, so the
 * editor can tell whether someone changed them since it opened the post.
 */
export const posts = pgTable('posts', {
  id: uuid('id').primaryKey().defaultRandom(),
  /** Media ID of the cover image. */
  cover: uuid('cover'),
  createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
  ...timestamps,
});

export const postsTranslations = pgTable(
  'posts_translations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    entityId: uuid('entity_id')
      .notNull()
      .references(() => posts.id, { onDelete: 'cascade' }),
    locale: text('locale').notNull(),
    slug: text('slug').notNull(),
    title: text('title').notNull(),
    /** Summary shown in lists and feeds. */
    excerpt: text('excerpt').notNull().default(''),
    body: jsonb('body').$type<RichTextJson>().notNull(),
    /** Key takeaways, one sentence each. */
    keyTakeaways: jsonb('key_takeaways').$type<string[]>().notNull().default([]),
    status: text('status').$type<ContentStatus>().notNull().default('draft'),
    source: text('source').$type<PostSource>().notNull().default('manual'),
    /** Publication date (JSON-LD datePublished): set on the first publish, editable later. */
    publishedAt: timestamptz('published_at'),
    /** Last time the live content changed (JSON-LD dateModified). */
    modifiedAt: timestamptz('modified_at'),
    /** Last time this language was taken offline. */
    unpublishedAt: timestamptz('unpublished_at'),
    seo: jsonb('seo').$type<SeoFields>().notNull(),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    updatedBy: uuid('updated_by').references(() => users.id, { onDelete: 'set null' }),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('posts_translations_entity_locale_unique').on(t.entityId, t.locale),
    uniqueIndex('posts_translations_locale_slug_unique').on(t.locale, t.slug),
    index('posts_translations_list_idx').on(t.locale, t.status, t.publishedAt.desc()),
    check(
      'posts_translations_status_check',
      sql`${t.status} in ('draft', 'in_review', 'published', 'unpublished')`,
    ),
    check('posts_translations_source_check', sql`${t.source} in ('manual', 'ai')`),
  ],
);

/** Categories of a post; the first one is its main category (e.g. for breadcrumbs). */
export const postCategoryLinks = pgTable(
  'post_category_links',
  {
    postId: uuid('post_id')
      .notNull()
      .references(() => posts.id, { onDelete: 'cascade' }),
    /** A category with posts cannot be deleted. */
    categoryId: uuid('category_id')
      .notNull()
      .references(() => postCategories.id, { onDelete: 'restrict' }),
    sortOrder: integer('sort_order').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.postId, t.categoryId] }),
    index('post_category_links_category_idx').on(t.categoryId, t.postId),
  ],
);

export const postTagLinks = pgTable(
  'post_tag_links',
  {
    postId: uuid('post_id')
      .notNull()
      .references(() => posts.id, { onDelete: 'cascade' }),
    /** Deleting a tag removes it from its posts. */
    tagId: uuid('tag_id')
      .notNull()
      .references(() => tags.id, { onDelete: 'cascade' }),
    sortOrder: integer('sort_order').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.postId, t.tagId] }),
    index('post_tag_links_tag_idx').on(t.tagId, t.postId),
  ],
);

/** Authors of a post, in the order they are credited. */
export const postAuthorLinks = pgTable(
  'post_author_links',
  {
    postId: uuid('post_id')
      .notNull()
      .references(() => posts.id, { onDelete: 'cascade' }),
    /** An author with posts cannot be deleted. */
    authorId: uuid('author_id')
      .notNull()
      .references(() => authors.id, { onDelete: 'restrict' }),
    sortOrder: integer('sort_order').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.postId, t.authorId] }),
    index('post_author_links_author_idx').on(t.authorId, t.postId),
  ],
);
