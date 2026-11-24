// Media library, see docs/spec/README.md chapter 5 and docs/adr/0008: upload, folders,
// localized alt texts, derived files, usages, replacement and deletion. Files are written
// through the storage driver first and recorded in the database afterwards; objects that a
// change leaves behind are deleted after the transaction commits.
import { createHash } from 'node:crypto';
import { schema, type Database, type Executor, type Localized } from '@bluepax/db';
import { originalKey, variantKey, type StorageDriver } from '@bluepax/storage';
import { and, asc, count, desc, eq, ilike, inArray, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import { audit } from '../../audit.ts';
import { log } from '../../log.ts';
import { localized, mergeLocalized, parseInput } from '../site/values.ts';
import { MediaError } from './errors.ts';
import { checkUpload, displayName, type MediaKind, type UploadLimitsMb } from './files.ts';
import {
  hasResponsiveVariants,
  isSiteIconSource,
  ogImage,
  readImage,
  responsiveVariants,
  siteIcons,
  SITE_ICON_MIN,
  type DerivedFile,
  type ImageInfo,
} from './images.ts';

export interface Actor {
  id: string;
  ip: string | null;
}

export interface MediaContext {
  db: Database;
  storage: StorageDriver;
}

/** What a usage needs from the file, see `media_usages.purpose`. */
export const USAGE_PURPOSES = ['default', 'og', 'site_icon'] as const;
export type UsagePurpose = (typeof USAGE_PURPOSES)[number];

/** Derived files a purpose needs, by variant name; the first one marks that they exist. */
const PURPOSE_VARIANTS: Record<Exclude<UsagePurpose, 'default'>, string> = {
  og: 'og',
  site_icon: 'favicon',
};

export const MAX_FOLDER_DEPTH = 5;

type MediaRow = typeof schema.media.$inferSelect;
type ObjectRow = typeof schema.mediaObjects.$inferSelect;
type NewObject = Omit<typeof schema.mediaObjects.$inferInsert, 'mediaId'>;

function sha256Hex(data: Uint8Array): string {
  return createHash('sha256').update(data).digest('hex');
}

/** The Postgres error behind a Drizzle error, if any. */
function pgCode(error: unknown): { code?: string; constraint?: string } {
  let current: unknown = error;
  for (let i = 0; i < 5 && current; i++) {
    const e = current as { code?: unknown; constraint?: unknown; cause?: unknown };
    if (typeof e.code === 'string') {
      return {
        code: e.code,
        ...(typeof e.constraint === 'string' && { constraint: e.constraint }),
      };
    }
    current = e.cause;
  }
  return {};
}

async function deleteStored(storage: StorageDriver, keys: readonly string[]): Promise<void> {
  for (const key of keys) {
    try {
      await storage.delete(key);
    } catch (error) {
      // The database no longer points at the object; a leftover file is harmless.
      log('warn', 'media object could not be deleted', { key, error: String(error) });
    }
  }
}

async function readStored(storage: StorageDriver, key: string): Promise<Uint8Array> {
  const stream = await storage.get(key);
  if (!stream) throw new Error(`media object "${key}" is missing from ${storage.name} storage`);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** Writes derived files next to an original and returns their object rows. */
async function writeDerived(
  storage: StorageDriver,
  original: string,
  files: readonly DerivedFile[],
  written: string[],
): Promise<NewObject[]> {
  const rows: NewObject[] = [];
  for (const file of files) {
    const key = variantKey(original, file.variant, file.ext);
    await storage.put(key, file.data, { contentType: file.contentType });
    written.push(key);
    rows.push({
      variant: file.variant,
      key,
      driver: storage.name,
      status: 'synced',
      contentType: file.contentType,
      width: file.width,
      height: file.height,
      size: file.data.length,
      sha256: sha256Hex(file.data),
      syncedAt: new Date(),
    });
  }
  return rows;
}

async function derivedFor(
  data: Uint8Array,
  mimeType: string,
  info: ImageInfo | null,
  purposes: ReadonlySet<UsagePurpose>,
): Promise<DerivedFile[]> {
  if (!info) return [];
  const files = hasResponsiveVariants(mimeType, info) ? await responsiveVariants(data, info) : [];
  if (purposes.has('og')) files.push(await ogImage(data, info));
  if (purposes.has('site_icon')) files.push(...(await siteIcons(data)));
  return files;
}

interface StoredFile {
  key: string;
  sha256: string;
  objects: NewObject[];
  written: string[];
}

/** Stores an original and every derived file it needs; on failure nothing is left behind. */
async function storeFile(
  storage: StorageDriver,
  file: { data: Uint8Array; mimeType: string; ext: string },
  info: ImageInfo | null,
  purposes: ReadonlySet<UsagePurpose>,
  now: Date,
): Promise<StoredFile> {
  const sha256 = sha256Hex(file.data);
  const key = originalKey(now, sha256, file.ext);
  const written: string[] = [];
  try {
    await storage.put(key, file.data, { contentType: file.mimeType });
    written.push(key);
    const original: NewObject = {
      variant: 'original',
      key,
      driver: storage.name,
      status: 'synced',
      contentType: file.mimeType,
      width: info?.width ?? null,
      height: info?.height ?? null,
      size: file.data.length,
      sha256,
      syncedAt: new Date(),
    };
    const derived = await writeDerived(
      storage,
      key,
      await derivedFor(file.data, file.mimeType, info, purposes),
      written,
    );
    return { key, sha256, objects: [original, ...derived], written };
  } catch (error) {
    await deleteStored(storage, written);
    throw error;
  }
}

async function findByHash(db: Executor, sha256: string) {
  const [row] = await db
    .select({ id: schema.media.id, key: schema.media.key })
    .from(schema.media)
    .where(eq(schema.media.sha256, sha256));
  return row;
}

/**
 * After a unique violation on the file hash: the same file was stored concurrently. When both
 * wrote the same key the objects belong to the other media item and stay.
 */
async function duplicateAfterRace(ctx: MediaContext, stored: StoredFile): Promise<never> {
  const winner = await findByHash(ctx.db, stored.sha256);
  if (!winner || winner.key !== stored.key) await deleteStored(ctx.storage, stored.written);
  throw new MediaError('duplicate', winner ? { existingId: winner.id } : {});
}

async function requireFolder(db: Executor, folderId: string | null): Promise<void> {
  if (!folderId) return;
  const [row] = await db
    .select({ id: schema.mediaFolders.id })
    .from(schema.mediaFolders)
    .where(eq(schema.mediaFolders.id, folderId));
  if (!row) throw new MediaError('folder_not_found');
}

// ---------------------------------------------------------------------------------------------
// Upload, replace, delete

export interface Upload {
  /** File name as uploaded; only used as the initial display name. */
  name: string;
  data: Uint8Array;
}

/**
 * Adds a file to the library. The type is sniffed from the content and the limit of its kind
 * applies; a file that is already in the library is refused (`duplicate`, with its ID).
 */
export async function uploadMedia(
  ctx: MediaContext,
  upload: Upload,
  folderId: string | null,
  limits: UploadLimitsMb,
  actor: Actor,
): Promise<{ id: string }> {
  const file = await checkUpload(upload.name, upload.data, limits);
  await requireFolder(ctx.db, folderId);
  const existing = await findByHash(ctx.db, sha256Hex(file.data));
  if (existing) throw new MediaError('duplicate', { existingId: existing.id });
  const info = file.kind === 'image' ? await readImage(file.data) : null;
  const stored = await storeFile(ctx.storage, file, info, new Set(), new Date());
  const name = displayName(upload.name, `${file.kind}.${file.ext}`);
  try {
    return await ctx.db.transaction(async (tx) => {
      const [row] = await tx
        .insert(schema.media)
        .values({
          folderId,
          kind: file.kind,
          name,
          mimeType: file.mimeType,
          size: file.data.length,
          sha256: stored.sha256,
          key: stored.key,
          width: info?.width ?? null,
          height: info?.height ?? null,
          uploadedBy: actor.id,
        })
        .returning({ id: schema.media.id });
      const id = row!.id;
      await tx
        .insert(schema.mediaObjects)
        .values(stored.objects.map((o) => ({ ...o, mediaId: id })));
      await audit(tx, {
        action: 'media.upload',
        actorId: actor.id,
        targetType: 'media',
        targetId: id,
        details: { name, mimeType: file.mimeType, size: file.data.length },
        ip: actor.ip,
      });
      return { id };
    });
  } catch (error) {
    const { code, constraint } = pgCode(error);
    if (code === '23505' && constraint === 'media_sha256_unique') {
      return duplicateAfterRace(ctx, stored);
    }
    await deleteStored(ctx.storage, stored.written);
    if (code === '23503') throw new MediaError('folder_not_found');
    throw error;
  }
}

/** Purposes the media item is currently used for. */
async function purposesOf(db: Executor, mediaId: string): Promise<Set<UsagePurpose>> {
  const rows = await db
    .selectDistinct({ purpose: schema.mediaUsages.purpose })
    .from(schema.mediaUsages)
    .where(eq(schema.mediaUsages.mediaId, mediaId));
  return new Set(rows.map((r) => r.purpose as UsagePurpose));
}

function checkPurpose(
  purpose: UsagePurpose,
  media: { kind: string; mimeType: string; width: number | null; height: number | null },
  kind?: MediaKind,
): void {
  if (purpose === 'og' && media.kind !== 'image') throw new MediaError('not_image');
  if (purpose === 'site_icon' && !isSiteIconSource(media.mimeType, media.width, media.height)) {
    throw new MediaError('not_square_png', { minSize: SITE_ICON_MIN });
  }
  if (kind && media.kind !== kind)
    throw new MediaError(kind === 'image' ? 'not_image' : 'kind_mismatch');
}

/**
 * Replaces the file of a media item and keeps its ID (chapter 5): the new file gets a new key
 * from its hash and new derived files; the old objects are deleted right away. The new file
 * must be of the same kind and suit every purpose the item is used for.
 */
export async function replaceMedia(
  ctx: MediaContext,
  id: string,
  upload: Upload,
  limits: UploadLimitsMb,
  actor: Actor,
): Promise<void> {
  const current = await getMediaRow(ctx.db, id);
  const file = await checkUpload(upload.name, upload.data, limits);
  if (file.kind !== current.kind) throw new MediaError('kind_mismatch');
  const sha256 = sha256Hex(file.data);
  if (sha256 === current.sha256) throw new MediaError('same_file');
  const other = await findByHash(ctx.db, sha256);
  if (other) throw new MediaError('duplicate', { existingId: other.id });
  const info = file.kind === 'image' ? await readImage(file.data) : null;
  const purposes = await purposesOf(ctx.db, id);
  for (const purpose of purposes) {
    checkPurpose(purpose, {
      kind: file.kind,
      mimeType: file.mimeType,
      width: info?.width ?? null,
      height: info?.height ?? null,
    });
  }
  const stored = await storeFile(ctx.storage, file, info, purposes, new Date());

  let oldKeys: string[];
  try {
    oldKeys = await ctx.db.transaction(async (tx) => {
      const [locked] = await tx
        .select()
        .from(schema.media)
        .where(eq(schema.media.id, id))
        .for('update');
      if (!locked) throw new MediaError('not_found');
      const old = await tx
        .delete(schema.mediaObjects)
        .where(eq(schema.mediaObjects.mediaId, id))
        .returning({ key: schema.mediaObjects.key, driver: schema.mediaObjects.driver });
      await tx
        .update(schema.media)
        .set({
          mimeType: file.mimeType,
          size: file.data.length,
          sha256,
          key: stored.key,
          width: info?.width ?? null,
          height: info?.height ?? null,
          replacedAt: sql`now()`,
          updatedAt: sql`now()`,
        })
        .where(eq(schema.media.id, id));
      await tx
        .insert(schema.mediaObjects)
        .values(stored.objects.map((o) => ({ ...o, mediaId: id })));
      await audit(tx, {
        action: 'media.replace',
        actorId: actor.id,
        targetType: 'media',
        targetId: id,
        details: {
          before: { mimeType: locked.mimeType, size: locked.size, sha256: locked.sha256 },
          after: { mimeType: file.mimeType, size: file.data.length, sha256 },
        },
        ip: actor.ip,
      });
      return old.filter((o) => o.driver === ctx.storage.name).map((o) => o.key);
    });
  } catch (error) {
    const { code, constraint } = pgCode(error);
    if (code === '23505' && constraint === 'media_sha256_unique') {
      return duplicateAfterRace(ctx, stored);
    }
    await deleteStored(ctx.storage, stored.written);
    throw error;
  }
  // Old objects go right away (chapter 5); their keys are never reused since keys are hashes.
  await deleteStored(
    ctx.storage,
    oldKeys.filter((key) => !stored.written.includes(key)),
  );
  // TODO(M2): emit `media.replaced` with the paths affected by this item's usages.
}

/** Deletes a media item and its files. A used item is refused (`in_use`). */
export async function deleteMedia(ctx: MediaContext, id: string, actor: Actor): Promise<void> {
  let keys: string[];
  try {
    keys = await ctx.db.transaction(async (tx) => {
      const [row] = await tx
        .select()
        .from(schema.media)
        .where(eq(schema.media.id, id))
        .for('update');
      if (!row) throw new MediaError('not_found');
      const [used] = await tx
        .select({ n: count() })
        .from(schema.mediaUsages)
        .where(eq(schema.mediaUsages.mediaId, id));
      if ((used?.n ?? 0) > 0) throw new MediaError('in_use');
      const objects = await tx
        .select({ key: schema.mediaObjects.key, driver: schema.mediaObjects.driver })
        .from(schema.mediaObjects)
        .where(eq(schema.mediaObjects.mediaId, id));
      await tx.delete(schema.media).where(eq(schema.media.id, id));
      await audit(tx, {
        action: 'media.delete',
        actorId: actor.id,
        targetType: 'media',
        targetId: id,
        details: { name: row.name, mimeType: row.mimeType, sha256: row.sha256 },
        ip: actor.ip,
      });
      return objects.filter((o) => o.driver === ctx.storage.name).map((o) => o.key);
    });
  } catch (error) {
    // A usage written concurrently wins over the deletion.
    if (pgCode(error).code === '23503') throw new MediaError('in_use');
    throw error;
  }
  await deleteStored(ctx.storage, keys);
}

// ---------------------------------------------------------------------------------------------
// Editing

const updateSchema = z.object({ name: z.string().trim().min(1).max(200), alt: localized(1000) });

export interface MediaUpdate {
  name: string;
  /** Alt text per content language; languages left out keep nothing (empty). */
  alt: Localized;
  folderId: string | null;
}

/**
 * Changes the display name, the alt texts and the folder. Alt texts of languages that are no
 * longer content languages are kept, like the site data (docs/adr/0007).
 */
export async function updateMedia(
  db: Database,
  id: string,
  input: MediaUpdate,
  languages: readonly string[],
  actor: Actor,
): Promise<void> {
  const { name, alt } = parseInput(updateSchema, { name: input.name, alt: input.alt });
  await db.transaction(async (tx) => {
    const [row] = await tx.select().from(schema.media).where(eq(schema.media.id, id)).for('update');
    if (!row) throw new MediaError('not_found');
    await requireFolder(tx, input.folderId);
    const nextAlt = mergeLocalized(row.alt, alt, languages);
    const changed = [
      ...(row.name !== name ? ['name'] : []),
      ...(JSON.stringify(row.alt) !== JSON.stringify(nextAlt) ? ['alt'] : []),
      ...(row.folderId !== input.folderId ? ['folder'] : []),
    ];
    if (changed.length === 0) return;
    await tx
      .update(schema.media)
      .set({ name, alt: nextAlt, folderId: input.folderId, updatedAt: sql`now()` })
      .where(eq(schema.media.id, id));
    await audit(tx, {
      action: 'media.update',
      actorId: actor.id,
      targetType: 'media',
      targetId: id,
      details: { fields: changed },
      ip: actor.ip,
    });
  });
}

// ---------------------------------------------------------------------------------------------
// Folders

const folderName = z
  .string()
  .trim()
  .min(1)
  .max(100)
  // No slashes and no control characters.
  // eslint-disable-next-line no-control-regex
  .refine((v) => !/[/\\]/.test(v) && !/[\u0000-\u001f\u007f]/.test(v));

export interface Folder {
  id: string;
  name: string;
  parentId: string | null;
}

export async function listAllFolders(db: Executor): Promise<Folder[]> {
  return db
    .select({
      id: schema.mediaFolders.id,
      name: schema.mediaFolders.name,
      parentId: schema.mediaFolders.parentId,
    })
    .from(schema.mediaFolders)
    .orderBy(asc(sql`lower(${schema.mediaFolders.name})`));
}

/** Folders from the top down to `id` (inclusive); empty for the top level. */
export function folderPath(folders: readonly Folder[], id: string | null): Folder[] {
  const byId = new Map(folders.map((f) => [f.id, f]));
  const path: Folder[] = [];
  for (let current = id ? byId.get(id) : undefined; current;) {
    path.unshift(current);
    if (path.length > MAX_FOLDER_DEPTH + 1) break;
    current = current.parentId ? byId.get(current.parentId) : undefined;
  }
  return path;
}

/** Every folder with its full path, e.g. for a "move to" list, in path order. */
export function folderOptions(folders: readonly Folder[]): { id: string; path: string }[] {
  return folders
    .map((f) => ({
      id: f.id,
      path: folderPath(folders, f.id)
        .map((p) => p.name)
        .join(' / '),
    }))
    .sort((a, b) => a.path.localeCompare(b.path));
}

function folderError(error: unknown): never {
  const { code } = pgCode(error);
  if (code === '23505') throw new MediaError('folder_exists');
  if (code === '23503') throw new MediaError('folder_not_found');
  throw error;
}

export async function createFolder(
  db: Database,
  input: { name: string; parentId: string | null },
  actor: Actor,
): Promise<{ id: string }> {
  const name = folderName.safeParse(input.name);
  if (!name.success) throw new MediaError('invalid_name');
  try {
    return await db.transaction(async (tx) => {
      if (input.parentId) {
        const path = folderPath(await listAllFolders(tx), input.parentId);
        if (path.length === 0) throw new MediaError('folder_not_found');
        if (path.length >= MAX_FOLDER_DEPTH) throw new MediaError('folder_too_deep');
      }
      const [row] = await tx
        .insert(schema.mediaFolders)
        .values({ name: name.data, parentId: input.parentId })
        .returning({ id: schema.mediaFolders.id });
      await audit(tx, {
        action: 'media.folder_create',
        actorId: actor.id,
        targetType: 'media_folder',
        targetId: row!.id,
        details: { name: name.data },
        ip: actor.ip,
      });
      return { id: row!.id };
    });
  } catch (error) {
    if (error instanceof MediaError) throw error;
    folderError(error);
  }
}

export async function renameFolder(
  db: Database,
  id: string,
  newName: string,
  actor: Actor,
): Promise<void> {
  const name = folderName.safeParse(newName);
  if (!name.success) throw new MediaError('invalid_name');
  try {
    await db.transaction(async (tx) => {
      const [row] = await tx
        .update(schema.mediaFolders)
        .set({ name: name.data, updatedAt: sql`now()` })
        .where(eq(schema.mediaFolders.id, id))
        .returning({ id: schema.mediaFolders.id });
      if (!row) throw new MediaError('folder_not_found');
      await audit(tx, {
        action: 'media.folder_update',
        actorId: actor.id,
        targetType: 'media_folder',
        targetId: id,
        details: { name: name.data },
        ip: actor.ip,
      });
    });
  } catch (error) {
    if (error instanceof MediaError) throw error;
    folderError(error);
  }
}

/** Only empty folders can be deleted: no subfolders and no media. */
export async function deleteFolder(db: Database, id: string, actor: Actor): Promise<void> {
  try {
    await db.transaction(async (tx) => {
      const [row] = await tx
        .select()
        .from(schema.mediaFolders)
        .where(eq(schema.mediaFolders.id, id))
        .for('update');
      if (!row) throw new MediaError('folder_not_found');
      const [children] = await tx
        .select({ n: count() })
        .from(schema.mediaFolders)
        .where(eq(schema.mediaFolders.parentId, id));
      const [files] = await tx
        .select({ n: count() })
        .from(schema.media)
        .where(eq(schema.media.folderId, id));
      if ((children?.n ?? 0) > 0 || (files?.n ?? 0) > 0) throw new MediaError('folder_not_empty');
      await tx.delete(schema.mediaFolders).where(eq(schema.mediaFolders.id, id));
      await audit(tx, {
        action: 'media.folder_delete',
        actorId: actor.id,
        targetType: 'media_folder',
        targetId: id,
        details: { name: row.name },
        ip: actor.ip,
      });
    });
  } catch (error) {
    if (error instanceof MediaError) throw error;
    if (pgCode(error).code === '23503') throw new MediaError('folder_not_empty');
    throw error;
  }
}

// ---------------------------------------------------------------------------------------------
// Reading

export interface MediaVariant {
  variant: string;
  url: string;
  contentType: string;
  width: number | null;
  height: number | null;
  size: number;
}

/**
 * A media item as other modules and (later) the Delivery API see it: URL, size, alt texts per
 * language and the derived files (chapter 6, "媒体返回绝对 URL、宽高、各语言 alt 与衍生图").
 */
export interface MediaView {
  id: string;
  kind: MediaKind;
  name: string;
  mimeType: string;
  size: number;
  width: number | null;
  height: number | null;
  url: string;
  alt: Localized;
  /** Small preview for lists: the narrowest WebP variant, or the original image. */
  thumbUrl: string | null;
  variants: MediaVariant[];
}

function toView(storage: StorageDriver, row: MediaRow, objects: readonly ObjectRow[]): MediaView {
  const mine = objects.filter((o) => o.mediaId === row.id && o.driver === storage.name);
  const variants = mine
    .filter((o) => o.variant !== 'original')
    .map((o) => ({
      variant: o.variant,
      url: storage.publicUrl(o.key),
      contentType: o.contentType,
      width: o.width,
      height: o.height,
      size: o.size,
    }))
    .sort(
      (a, b) =>
        (a.width ?? 0) - (b.width ?? 0) ||
        a.variant.localeCompare(b.variant) ||
        a.contentType.localeCompare(b.contentType),
    );
  const thumb = variants.find((v) => v.variant.startsWith('w') && v.contentType === 'image/webp');
  const url = storage.publicUrl(row.key);
  return {
    id: row.id,
    kind: row.kind as MediaKind,
    name: row.name,
    mimeType: row.mimeType,
    size: row.size,
    width: row.width,
    height: row.height,
    url,
    alt: row.alt,
    thumbUrl: thumb?.url ?? (row.kind === 'image' ? url : null),
    variants,
  };
}

async function views(
  db: Executor,
  storage: StorageDriver,
  rows: readonly MediaRow[],
): Promise<MediaView[]> {
  if (rows.length === 0) return [];
  const objects = await db
    .select()
    .from(schema.mediaObjects)
    .where(
      inArray(
        schema.mediaObjects.mediaId,
        rows.map((r) => r.id),
      ),
    );
  return rows.map((row) => toView(storage, row, objects));
}

async function getMediaRow(db: Executor, id: string): Promise<MediaRow> {
  if (!z.uuid().safeParse(id).success) throw new MediaError('not_found');
  const [row] = await db.select().from(schema.media).where(eq(schema.media.id, id));
  if (!row) throw new MediaError('not_found');
  return row;
}

/** Views of the given media items, in the given order; missing IDs are left out. */
export async function getMediaViews(
  db: Executor,
  storage: StorageDriver,
  ids: readonly string[],
): Promise<MediaView[]> {
  const wanted = [...new Set(ids.filter((id) => z.uuid().safeParse(id).success))];
  if (wanted.length === 0) return [];
  const rows = await db.select().from(schema.media).where(inArray(schema.media.id, wanted));
  const result = await views(db, storage, rows);
  return wanted.flatMap((id) => result.find((v) => v.id === id) ?? []);
}

export interface MediaFilter {
  /** A folder ID, null for the top level, or `all` to search every folder. */
  folderId: string | null | 'all';
  kind?: MediaKind;
  mimeType?: string;
  /** Part of the display name. */
  query?: string;
  page?: number;
  pageSize?: number;
}

export async function listMedia(
  db: Executor,
  storage: StorageDriver,
  filter: MediaFilter,
): Promise<{ items: MediaView[]; total: number; page: number; pageSize: number }> {
  const pageSize = Math.min(Math.max(filter.pageSize ?? 60, 1), 200);
  const page = Math.max(filter.page ?? 1, 1);
  const query = filter.query?.trim();
  const where = and(
    filter.folderId === 'all'
      ? undefined
      : filter.folderId === null
        ? isNull(schema.media.folderId)
        : eq(schema.media.folderId, filter.folderId),
    filter.kind ? eq(schema.media.kind, filter.kind) : undefined,
    filter.mimeType ? eq(schema.media.mimeType, filter.mimeType) : undefined,
    query ? ilike(schema.media.name, `%${query.replace(/[\\%_]/g, (c) => `\\${c}`)}%`) : undefined,
  );
  const [total] = await db.select({ n: count() }).from(schema.media).where(where);
  const rows = await db
    .select()
    .from(schema.media)
    .where(where)
    .orderBy(desc(schema.media.createdAt), desc(schema.media.id))
    .limit(pageSize)
    .offset((page - 1) * pageSize);
  return { items: await views(db, storage, rows), total: total?.n ?? 0, page, pageSize };
}

export interface MediaUsage {
  module: string;
  targetType: string;
  targetId: string;
  field: string;
  locale: string;
  purpose: UsagePurpose;
}

export async function usagesOf(db: Executor, mediaId: string): Promise<MediaUsage[]> {
  const rows = await db
    .select({
      module: schema.mediaUsages.module,
      targetType: schema.mediaUsages.targetType,
      targetId: schema.mediaUsages.targetId,
      field: schema.mediaUsages.field,
      locale: schema.mediaUsages.locale,
      purpose: schema.mediaUsages.purpose,
    })
    .from(schema.mediaUsages)
    .where(eq(schema.mediaUsages.mediaId, mediaId))
    .orderBy(
      asc(schema.mediaUsages.module),
      asc(schema.mediaUsages.targetType),
      asc(schema.mediaUsages.targetId),
      asc(schema.mediaUsages.field),
    );
  return rows.map((r) => ({ ...r, purpose: r.purpose as UsagePurpose }));
}

export interface MediaDetail {
  view: MediaView;
  folderId: string | null;
  sha256: string;
  key: string;
  uploadedBy: string | null;
  createdAt: Date;
  replacedAt: Date | null;
  usages: MediaUsage[];
}

export async function getMediaDetail(
  db: Database,
  storage: StorageDriver,
  id: string,
): Promise<MediaDetail> {
  const row = await getMediaRow(db, id);
  const [view] = await views(db, storage, [row]);
  const [uploader] = row.uploadedBy
    ? await db
        .select({ name: schema.users.displayName })
        .from(schema.users)
        .where(eq(schema.users.id, row.uploadedBy))
    : [];
  return {
    view: view!,
    folderId: row.folderId,
    sha256: row.sha256,
    key: row.key,
    uploadedBy: uploader?.name ?? null,
    createdAt: row.createdAt,
    replacedAt: row.replacedAt,
    usages: await usagesOf(db, id),
  };
}

/** Number of objects and bytes per driver, for the storage settings. */
export async function storageStats(db: Executor) {
  return db
    .select({
      driver: schema.mediaObjects.driver,
      objects: count(),
      bytes: sql<number>`coalesce(sum(${schema.mediaObjects.size}), 0)::bigint`.mapWith(Number),
    })
    .from(schema.mediaObjects)
    .groupBy(schema.mediaObjects.driver);
}

// ---------------------------------------------------------------------------------------------
// Usages, written by other modules

export interface UsageTarget {
  /** Module that owns the record, e.g. `site`. */
  module: string;
  targetType: string;
  targetId: string;
}

export interface UsageRef {
  mediaId: string;
  field: string;
  /** Content language of the field; leave out for fields shared by all languages. */
  locale?: string;
  purpose?: UsagePurpose;
  /** The kind the field accepts, e.g. `image` for a logo. */
  kind?: MediaKind;
}

/** Makes sure the derived files of a purpose exist for the item's current file. */
async function ensurePurposeFiles(
  ctx: MediaContext,
  row: MediaRow,
  purpose: UsagePurpose,
): Promise<void> {
  if (purpose === 'default') return;
  const marker = PURPOSE_VARIANTS[purpose];
  const [exists] = await ctx.db
    .select({ id: schema.mediaObjects.id })
    .from(schema.mediaObjects)
    .where(
      and(
        eq(schema.mediaObjects.mediaId, row.id),
        eq(schema.mediaObjects.driver, ctx.storage.name),
        eq(schema.mediaObjects.variant, marker),
      ),
    );
  if (exists) return;
  const data = await readStored(ctx.storage, row.key);
  const info = await readImage(data);
  const files = purpose === 'og' ? [await ogImage(data, info)] : await siteIcons(data);
  const written: string[] = [];
  let rows: NewObject[];
  try {
    rows = await writeDerived(ctx.storage, row.key, files, written);
  } catch (error) {
    await deleteStored(ctx.storage, written);
    throw error;
  }
  try {
    await ctx.db
      .insert(schema.mediaObjects)
      .values(rows.map((o) => ({ ...o, mediaId: row.id })))
      .onConflictDoNothing();
  } catch (error) {
    // The item was replaced or deleted meanwhile; its new state no longer needs these files.
    if (pgCode(error).code !== '23503') throw error;
    await deleteStored(ctx.storage, written);
  }
}

/**
 * Before saving a record that uses media: checks that every item exists and suits the field
 * (`kind`, `purpose`), and derives the files the purpose needs (OG image, site icons). Call it
 * before the transaction that saves the record, since it may take a moment; then write the
 * usages with setMediaUsages inside that transaction.
 */
export async function prepareMediaUse(ctx: MediaContext, refs: readonly UsageRef[]): Promise<void> {
  for (const ref of refs) {
    if (!z.uuid().safeParse(ref.mediaId).success) throw new MediaError('not_found');
    const row = await getMediaRow(ctx.db, ref.mediaId);
    const purpose = ref.purpose ?? 'default';
    checkPurpose(purpose, row, ref.kind);
    await ensurePurposeFiles(ctx, row, purpose);
  }
}

/**
 * Replaces the usages of one record, inside the transaction that saves the record. The media
 * items are locked against deletion until the transaction ends.
 */
export async function setMediaUsages(
  tx: Executor,
  target: UsageTarget,
  refs: readonly UsageRef[],
): Promise<void> {
  const ids = [...new Set(refs.map((r) => r.mediaId))];
  if (ids.length > 0) {
    const found = await tx
      .select({ id: schema.media.id })
      .from(schema.media)
      .where(inArray(schema.media.id, ids))
      .for('key share');
    if (found.length !== ids.length) throw new MediaError('not_found');
  }
  await tx
    .delete(schema.mediaUsages)
    .where(
      and(
        eq(schema.mediaUsages.module, target.module),
        eq(schema.mediaUsages.targetType, target.targetType),
        eq(schema.mediaUsages.targetId, target.targetId),
      ),
    );
  const unique = new Map(refs.map((r) => [`${r.mediaId} ${r.field} ${r.locale ?? ''}`, r]));
  if (unique.size === 0) return;
  await tx.insert(schema.mediaUsages).values(
    [...unique.values()].map((r) => ({
      mediaId: r.mediaId,
      ...target,
      field: r.field,
      locale: r.locale ?? '',
      purpose: r.purpose ?? 'default',
    })),
  );
}

/** Media items used by a set of records, e.g. to show what a settings page points at. */
export async function usagesOfTarget(db: Executor, target: UsageTarget) {
  return db
    .select({ mediaId: schema.mediaUsages.mediaId, field: schema.mediaUsages.field })
    .from(schema.mediaUsages)
    .where(
      and(
        eq(schema.mediaUsages.module, target.module),
        eq(schema.mediaUsages.targetType, target.targetType),
        eq(schema.mediaUsages.targetId, target.targetId),
      ),
    );
}
