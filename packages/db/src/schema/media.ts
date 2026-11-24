// Tables of the media module, see docs/spec/README.md chapters 4 and 5 and docs/adr/0008.
// A media item is one file in the library; every stored file (the original and each derived
// file) is a media object with one row per storage driver. Alt texts are a JSONB map keyed
// by BCP 47 code, like the site data (docs/adr/0007).
import { sql } from 'drizzle-orm';
import {
  bigint,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import { users } from './core.ts';

const timestamptz = (name: string) => timestamp(name, { withTimezone: true });

const timestamps = {
  createdAt: timestamptz('created_at').notNull().defaultNow(),
  updatedAt: timestamptz('updated_at').notNull().defaultNow(),
};

/** Folders of the media library; a folder can only be deleted when it is empty. */
export const mediaFolders = pgTable(
  'media_folders',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    parentId: uuid('parent_id').references((): AnyPgColumn => mediaFolders.id, {
      onDelete: 'restrict',
    }),
    name: text('name').notNull(),
    ...timestamps,
  },
  (t) => [
    // Names are unique among siblings, ignoring case; top-level folders count as siblings too.
    uniqueIndex('media_folders_name_unique').on(
      sql`coalesce(${t.parentId}, '00000000-0000-0000-0000-000000000000'::uuid)`,
      sql`lower(${t.name})`,
    ),
  ],
);

export const media = pgTable(
  'media',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    folderId: uuid('folder_id').references(() => mediaFolders.id, { onDelete: 'restrict' }),
    /** `image`, `video` or `document`. */
    kind: text('kind').notNull(),
    /** Display name, initially the uploaded file name. */
    name: text('name').notNull(),
    /** Detected from the content, never taken from the upload. */
    mimeType: text('mime_type').notNull(),
    size: bigint('size', { mode: 'number' }).notNull(),
    /** SHA-256 of the current file (hex); one media item per file content. */
    sha256: text('sha256').notNull(),
    /** Key of the original, `{yyyy}/{mm}/{hash}.{ext}` (chapter 5). */
    key: text('key').notNull(),
    /** Pixel size of images (after EXIF rotation); null for other kinds. */
    width: integer('width'),
    height: integer('height'),
    alt: jsonb('alt').$type<Record<string, string>>().notNull().default({}),
    uploadedBy: uuid('uploaded_by').references(() => users.id, { onDelete: 'set null' }),
    /** Last time the file was replaced; the media ID stays the same. */
    replacedAt: timestamptz('replaced_at'),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('media_sha256_unique').on(t.sha256),
    uniqueIndex('media_key_unique').on(t.key),
    index('media_folder_idx').on(t.folderId, t.createdAt.desc()),
    index('media_created_idx').on(t.createdAt.desc()),
  ],
);

/**
 * Every stored file of a media item on every driver (chapter 5): the original and the derived
 * files, with their sync state. The local copy is the primary one and is `synced` once written.
 */
export const mediaObjects = pgTable(
  'media_objects',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    mediaId: uuid('media_id')
      .notNull()
      .references(() => media.id, { onDelete: 'cascade' }),
    /** `original`, or a derived file such as `w960`, `og` or `apple-touch`. */
    variant: text('variant').notNull(),
    key: text('key').notNull(),
    /** Storage driver, e.g. `local` or `r2`. */
    driver: text('driver').notNull(),
    /** `pending`, `synced` or `failed`. */
    status: text('status').notNull(),
    contentType: text('content_type').notNull(),
    width: integer('width'),
    height: integer('height'),
    size: bigint('size', { mode: 'number' }).notNull(),
    sha256: text('sha256').notNull(),
    syncedAt: timestamptz('synced_at'),
    attempts: integer('attempts').notNull().default(0),
    lastError: text('last_error'),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('media_objects_driver_key_unique').on(t.driver, t.key),
    index('media_objects_media_idx').on(t.mediaId),
    index('media_objects_status_idx').on(t.driver, t.status),
  ],
);

/**
 * Where a media item is used. Modules write the usages of a record together with the record;
 * a used media item cannot be deleted, and the list shows where it is used (chapter 5). The
 * paths affected by `media.replaced` are computed from these rows.
 */
export const mediaUsages = pgTable(
  'media_usages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    mediaId: uuid('media_id')
      .notNull()
      .references(() => media.id, { onDelete: 'restrict' }),
    /** Module that owns the record, e.g. `site` or `pages`. */
    module: text('module').notNull(),
    /** Kind of record within the module, e.g. `settings` or `page`. */
    targetType: text('target_type').notNull(),
    targetId: text('target_id').notNull(),
    /** Field of the record, e.g. `logo` or `blocks.2.image`. */
    field: text('field').notNull(),
    /** Content language of the field; empty when the field is shared by all languages. */
    locale: text('locale').notNull().default(''),
    /**
     * What the file must provide: `default`, `og` (a 1200×630 JPG is derived) or
     * `site_icon` (favicon, Apple Touch and PWA icons are derived).
     */
    purpose: text('purpose').notNull().default('default'),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('media_usages_unique').on(
      t.mediaId,
      t.module,
      t.targetType,
      t.targetId,
      t.field,
      t.locale,
    ),
    index('media_usages_target_idx').on(t.module, t.targetType, t.targetId),
  ],
);
