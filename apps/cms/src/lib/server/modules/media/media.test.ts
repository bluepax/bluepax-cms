import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createDatabase,
  createPool,
  migrationSets,
  runMigrations,
  schema,
  type Database,
} from '@bluepax/db';
import { freshTestDatabase } from '@bluepax/db/testing';
import { configFromPreset } from '@bluepax/presets';
import { createLocalDriver, isMediaKey, type StorageDriver } from '@bluepax/storage';
import { eq } from 'drizzle-orm';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { listAudit } from '../../audit.ts';
import { exportInstanceConfig, initializeInstance } from '../../instance.ts';
import { migrationSetNames, registry } from '../../modules.ts';
import { readSiteData, saveBranding, saveGeneral } from '../site/settings.ts';
import { InvalidInputError } from '../site/values.ts';
import { MediaError, type MediaErrorCode } from './errors.ts';
import { checkUpload, detectType, displayName, sanitizeSvg } from './files.ts';
import { parseRange } from './http.ts';
import { encodeIco, ogImage, OG_MAX_BYTES, readImage, siteIcons, variantWidths } from './images.ts';
import {
  createFolder,
  deleteFolder,
  deleteMedia,
  folderOptions,
  getMediaDetail,
  listAllFolders,
  listMedia,
  prepareMediaUse,
  renameFolder,
  replaceMedia,
  setMediaUsages,
  updateMedia,
  uploadMedia,
  usagesOf,
  type MediaContext,
} from './library.ts';
import { mediaCacheControl, readStorageConfig, saveStorageSettings } from './storage.ts';

// The file route reads the database and storage from the runtime; tests hand in their own.
const runtime = vi.hoisted(() => ({ ctx: null as MediaContext | null }));
vi.mock('../../runtime.ts', () => ({
  getDatabase: () => runtime.ctx!.db,
  getStorage: () => runtime.ctx!.storage,
}));

const limits = { image: 20, document: 50, video: 200 };
/**
 * Encoding AVIF variants takes a few seconds on CI runners (about 4–5 s for one photo), more
 * than Vitest's default of 5 s per test.
 */
const IMAGE_TEST_TIMEOUT = 30_000;

function png(width: number, height: number, color = { r: 30, g: 90, b: 200 }) {
  return sharp({ create: { width, height, channels: 3, background: color } })
    .png()
    .toBuffer();
}

/** A photo-like image: a gradient with some noise, which compresses like real photos. */
async function photo(width: number, height: number): Promise<Buffer> {
  const raw = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 3;
      const noise = (Math.random() - 0.5) * 24;
      raw[i] = Math.max(0, Math.min(255, (x / width) * 255 + noise));
      raw[i + 1] = Math.max(0, Math.min(255, (y / height) * 255 + noise));
      raw[i + 2] = Math.max(0, Math.min(255, 128 + noise));
    }
  }
  return sharp(raw, { raw: { width, height, channels: 3 } })
    .jpeg({ quality: 90 })
    .toBuffer();
}

const pdf = Buffer.from('%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\ntrailer << >>\n%%EOF\n');
const mp4 = Buffer.from('000000186674797069736f6d0000020069736f6d69736f32000000086d646174', 'hex');

async function code(run: Promise<unknown>): Promise<MediaErrorCode> {
  try {
    await run;
  } catch (error) {
    if (error instanceof MediaError) return error.code;
    throw error;
  }
  throw new Error('expected a MediaError');
}

describe('media module (unit)', { timeout: IMAGE_TEST_TIMEOUT }, () => {
  it('gives editors the content permission but not the storage settings', () => {
    const all = registry.order().map((m) => m.id);
    expect(registry.permissions(all)).toEqual(
      expect.arrayContaining(['media.edit', 'media.storage']),
    );
    expect(registry.editorPermissions(all)).toContain('media.edit');
    expect(registry.editorPermissions(all)).not.toContain('media.storage');
    expect(registry.get('media')?.webhookEvents).toEqual([
      'media.replaced',
      'media.origin_changed',
    ]);
    // site uses media for its logo and icons, so media's tables come first.
    const sets = migrationSetNames();
    expect(sets.indexOf('media')).toBeLessThan(sets.indexOf('site'));
  });

  it('sniffs the type from the content', async () => {
    expect(await detectType(await png(10, 10))).toMatchObject({
      mimeType: 'image/png',
      ext: 'png',
    });
    expect(await detectType(pdf)).toMatchObject({ mimeType: 'application/pdf', kind: 'document' });
    expect(await detectType(mp4)).toMatchObject({ mimeType: 'video/mp4', kind: 'video' });
    expect(
      await detectType(
        Buffer.from('<?xml version="1.0"?>\n<svg xmlns="http://www.w3.org/2000/svg"/>'),
      ),
    ).toMatchObject({ mimeType: 'image/svg+xml' });
    expect(await detectType(Buffer.from('just some text'))).toBeNull();
    expect(await detectType(Buffer.from('<html><body>hi</body></html>'))).toBeNull();
  });

  it('refuses executables, unknown types and files over the limit of their kind', async () => {
    const image = await png(10, 10);
    expect(await code(checkUpload('a.png', Buffer.from('MZ\x90\x00rest'), limits))).toBe(
      'executable',
    );
    expect(await code(checkUpload('a.bin', Buffer.from('\x7fELF\x02\x01'), limits))).toBe(
      'executable',
    );
    expect(await code(checkUpload('a.txt', Buffer.from('#!/bin/sh\nrm -rf /\n'), limits))).toBe(
      'executable',
    );
    expect(await code(checkUpload('setup.exe', image, limits))).toBe('executable');
    expect(await code(checkUpload('page.html', image, limits))).toBe('executable');
    expect(await code(checkUpload('notes.txt', Buffer.from('hello'), limits))).toBe(
      'unsupported_type',
    );
    expect(await code(checkUpload('empty.png', Buffer.alloc(0), limits))).toBe('empty_file');
    const big = Buffer.concat([pdf, Buffer.alloc(2 * 1024 * 1024)]);
    await expect(checkUpload('big.pdf', big, { ...limits, document: 1 })).rejects.toMatchObject({
      code: 'too_large',
      details: { limitMb: 1 },
    });
    expect(await checkUpload('big.pdf', big, limits)).toMatchObject({ kind: 'document' });
  });

  it('sanitises SVG files', () => {
    const dirty = `<?xml version="1.0"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 10 10" onload="alert(1)">
  <script>alert(2)</script>
  <foreignObject><body xmlns="http://www.w3.org/1999/xhtml"><iframe src="https://evil.example"/></body></foreignObject>
  <a xlink:href="javascript:alert(3)"><rect width="10" height="10" fill="#123456"/></a>
  <path d="M0 0L10 10" stroke="red"/>
</svg>`;
    const clean = new TextDecoder().decode(sanitizeSvg(Buffer.from(dirty)));
    expect(clean).not.toMatch(/script|onload|alert|foreignObject|iframe|javascript/i);
    expect(clean).toContain('viewBox="0 0 10 10"');
    expect(clean).toContain('<path d="M0 0L10 10" stroke="red"');
    expect(clean).toContain('xmlns="http://www.w3.org/2000/svg"');
    expect(() => sanitizeSvg(Buffer.from('<svg><unclosed></svg>'))).toThrow(MediaError);
    expect(() => sanitizeSvg(Buffer.from('<html/>'))).toThrow(MediaError);
  });

  it('cleans display names', () => {
    expect(displayName('C:\\Users\\me\\photo.jpg', 'x')).toBe('photo.jpg');
    expect(displayName('../../etc/\u0007passwd', 'x')).toBe('passwd');
    expect(displayName('', 'image.png')).toBe('image.png');
  });

  it('derives variant widths without enlarging', () => {
    expect(variantWidths(4000)).toEqual([480, 960, 1600]);
    expect(variantWidths(1600)).toEqual([480, 960, 1600]);
    expect(variantWidths(1200)).toEqual([480, 960, 1200]);
    expect(variantWidths(480)).toEqual([480]);
    expect(variantWidths(300)).toEqual([300]);
  });

  it('makes a 1200×630 OG image of at most about 300 KB', async () => {
    const data = await photo(2400, 1600);
    const og = await ogImage(data, await readImage(data));
    expect(og).toMatchObject({ variant: 'og', ext: 'jpg', width: 1200, height: 630 });
    expect(og.data.length).toBeLessThanOrEqual(OG_MAX_BYTES);
    expect((await sharp(og.data).metadata()).format).toBe('jpeg');
  });

  it('derives favicon, Apple Touch and PWA icons', async () => {
    const icons = await siteIcons(await png(512, 512));
    expect(icons.map((i) => [i.variant, i.width])).toEqual([
      ['favicon', 48],
      ['apple-touch', 180],
      ['pwa-192', 192],
      ['pwa-512', 512],
    ]);
    const ico = icons[0]!.data;
    expect([ico.readUInt16LE(0), ico.readUInt16LE(2), ico.readUInt16LE(4)]).toEqual([0, 1, 3]);
    expect([ico[6], ico[22], ico[38]]).toEqual([16, 32, 48]);
    expect(encodeIco([{ size: 256, png: Buffer.from('x') }])[6]).toBe(0);
  });

  it('parses byte ranges', () => {
    expect(parseRange(null, 100)).toBeNull();
    expect(parseRange('bytes=0-9', 100)).toEqual({ start: 0, end: 9 });
    expect(parseRange('bytes=90-', 100)).toEqual({ start: 90, end: 99 });
    expect(parseRange('bytes=-10', 100)).toEqual({ start: 90, end: 99 });
    expect(parseRange('bytes=50-500', 100)).toEqual({ start: 50, end: 99 });
    expect(parseRange('bytes=100-', 100)).toBe('invalid');
    expect(parseRange('bytes=0-1,5-6', 100)).toBeNull();
  });

  it('builds the cache header from days', () => {
    expect(mediaCacheControl(365)).toBe('public, max-age=31536000, immutable');
    expect(mediaCacheControl(1)).toBe('public, max-age=86400, immutable');
  });
});

// Integration tests: need a PostgreSQL server (TEST_DATABASE_URL).
const baseUrl = process.env.TEST_DATABASE_URL;
const migrations = fileURLToPath(
  new URL('../../../../../../../packages/db/migrations', import.meta.url),
);

describe.skipIf(!baseUrl)('media module', { timeout: IMAGE_TEST_TIMEOUT }, () => {
  let pool: ReturnType<typeof createPool>;
  let db: Database;
  let root: string;
  let storage: StorageDriver;
  let ctx: MediaContext;
  let actor: { id: string; ip: string };

  async function files(): Promise<string[]> {
    const keys: string[] = [];
    for await (const o of storage.list()) keys.push(o.key);
    return keys;
  }

  async function objectKeys(mediaId: string): Promise<string[]> {
    const rows = await db
      .select({ key: schema.mediaObjects.key })
      .from(schema.mediaObjects)
      .where(eq(schema.mediaObjects.mediaId, mediaId));
    return rows.map((r) => r.key).sort();
  }

  async function lastAudit() {
    const [entry] = await listAudit(db, { limit: 1 });
    return entry!;
  }

  beforeAll(async () => {
    pool = createPool(await freshTestDatabase(baseUrl!, 'media'), 4);
    await runMigrations(pool, migrationSets(migrations, migrationSetNames()));
    db = createDatabase(pool);
    const { adminId } = await initializeInstance(
      db,
      configFromPreset({
        type: 'corporate',
        name: 'Example Site',
        contentLanguages: ['zh-Hans', 'en', 'ar'],
        primaryLanguage: 'zh-Hans',
        adminLocale: 'zh',
        frontendBaseUrl: 'https://www.example.com',
      }),
      {
        registry,
        source: 'wizard',
        admin: {
          email: 'owner@example.com',
          displayName: 'Owner',
          password: 'a long enough password',
          locale: 'zh',
        },
      },
    );
    actor = { id: adminId!, ip: '203.0.113.7' };
    root = await mkdtemp(join(tmpdir(), 'bluepax-media-'));
    storage = createLocalDriver({ root, publicBaseUrl: '/uploads' });
    ctx = { db, storage };
    runtime.ctx = ctx;
  });

  afterAll(async () => {
    await pool?.end();
    if (root) await rm(root, { recursive: true, force: true });
  });

  it('gives the default editor role the media content permission', async () => {
    const rows = await db
      .select({ permission: schema.rolePermissions.permission, key: schema.roles.key })
      .from(schema.rolePermissions)
      .innerJoin(schema.roles, eq(schema.roles.id, schema.rolePermissions.roleId));
    const editor = rows.filter((r) => r.key === 'editor').map((r) => r.permission);
    expect(editor).toContain('media.edit');
    expect(editor).not.toContain('media.storage');
  });

  let imageId: string;

  it('stores an image with AVIF and WebP variants', async () => {
    const data = await photo(2000, 1000);
    const { id } = await uploadMedia(ctx, { name: 'Photo.JPG', data }, null, limits, actor);
    imageId = id;
    const detail = await getMediaDetail(db, storage, id);
    expect(detail.view).toMatchObject({
      kind: 'image',
      name: 'Photo.JPG',
      mimeType: 'image/jpeg',
      width: 2000,
      height: 1000,
    });
    expect(detail.key).toMatch(/^\d{4}\/\d{2}\/[0-9a-f]{64}\.jpg$/);
    expect(detail.view.url).toBe(`/uploads/${detail.key}`);
    const hash = detail.key.slice(8, 72);
    expect(detail.view.variants.map((v) => [v.variant, v.contentType, v.width])).toEqual([
      ['w480', 'image/avif', 480],
      ['w480', 'image/webp', 480],
      ['w960', 'image/avif', 960],
      ['w960', 'image/webp', 960],
      ['w1600', 'image/avif', 1600],
      ['w1600', 'image/webp', 1600],
    ]);
    expect(detail.view.variants[0]!.url).toBe(
      `/uploads/${detail.key.slice(0, 8)}${hash}/w480.avif`,
    );
    expect(detail.view.thumbUrl).toMatch(/\/w480\.webp$/);
    expect(await files()).toEqual(await objectKeys(id));
    expect((await files()).every(isMediaKey)).toBe(true);
    expect(await lastAudit()).toMatchObject({ action: 'media.upload', targetId: id });
  });

  it('refuses a file that is already in the library', async () => {
    const detail = await getMediaDetail(db, storage, imageId);
    const data = await new Response((await storage.get(detail.key))!).arrayBuffer();
    await expect(
      uploadMedia(ctx, { name: 'again.jpg', data: new Uint8Array(data) }, null, limits, actor),
    ).rejects.toMatchObject({ code: 'duplicate', details: { existingId: imageId } });
  });

  it('stores videos and PDFs as they are', async () => {
    const { id: video } = await uploadMedia(
      ctx,
      { name: 'clip.mp4', data: mp4 },
      null,
      limits,
      actor,
    );
    const { id: doc } = await uploadMedia(
      ctx,
      { name: 'sheet.pdf', data: pdf },
      null,
      limits,
      actor,
    );
    for (const [id, mime] of [
      [video, 'video/mp4'],
      [doc, 'application/pdf'],
    ] as const) {
      const detail = await getMediaDetail(db, storage, id);
      expect(detail.view).toMatchObject({
        mimeType: mime,
        width: null,
        variants: [],
        thumbUrl: null,
      });
      expect(await objectKeys(id)).toEqual([detail.key]);
    }
  });

  it('keeps folders unique, shallow and only deletes them when empty', async () => {
    const { id: top } = await createFolder(db, { name: 'Products', parentId: null }, actor);
    expect(await code(createFolder(db, { name: 'products', parentId: null }, actor))).toBe(
      'folder_exists',
    );
    expect(await code(createFolder(db, { name: 'a/b', parentId: null }, actor))).toBe(
      'invalid_name',
    );
    let parent = top;
    for (let depth = 2; depth <= 5; depth++) {
      parent = (await createFolder(db, { name: `Level ${depth}`, parentId: parent }, actor)).id;
    }
    expect(await code(createFolder(db, { name: 'Level 6', parentId: parent }, actor))).toBe(
      'folder_too_deep',
    );
    expect(folderOptions(await listAllFolders(db)).at(-1)?.path).toBe(
      'Products / Level 2 / Level 3 / Level 4 / Level 5',
    );

    const { id: inFolder } = await uploadMedia(
      ctx,
      { name: 'red.png', data: await png(64, 64, { r: 200, g: 0, b: 0 }) },
      top,
      limits,
      actor,
    );
    expect((await listMedia(db, storage, { folderId: top })).items.map((i) => i.id)).toEqual([
      inFolder,
    ]);
    expect((await listMedia(db, storage, { folderId: 'all', query: 'RED' })).total).toBe(1);
    expect(await code(deleteFolder(db, top, actor))).toBe('folder_not_empty');
    await renameFolder(db, top, 'Catalogue', actor);
    expect(await lastAudit()).toMatchObject({ action: 'media.folder_update', targetId: top });
    await updateMedia(
      db,
      inFolder,
      { name: 'red.png', alt: {}, folderId: null },
      ['zh-Hans', 'en', 'ar'],
      actor,
    );
    await deleteFolder(db, parent, actor);
    expect(await lastAudit()).toMatchObject({ action: 'media.folder_delete', targetId: parent });
  });

  it('stores alt texts per language and keeps those of removed languages', async () => {
    await updateMedia(
      db,
      imageId,
      { name: 'Hero photo', alt: { 'zh-Hans': '一张照片', en: 'A photo', ar: '' }, folderId: null },
      ['zh-Hans', 'en', 'ar'],
      actor,
    );
    expect((await getMediaDetail(db, storage, imageId)).view.alt).toEqual({
      'zh-Hans': '一张照片',
      en: 'A photo',
    });
    expect(await lastAudit()).toMatchObject({
      action: 'media.update',
      details: { fields: ['name', 'alt'] },
    });
    // `en` is no longer a content language: its text stays, the others are replaced.
    await updateMedia(
      db,
      imageId,
      { name: 'Hero photo', alt: { 'zh-Hans': '照片', ar: 'صورة' }, folderId: null },
      ['zh-Hans', 'ar'],
      actor,
    );
    expect((await getMediaDetail(db, storage, imageId)).view.alt).toEqual({
      en: 'A photo',
      'zh-Hans': '照片',
      ar: 'صورة',
    });
    await expect(
      updateMedia(
        db,
        imageId,
        { name: ' ', alt: { 'not a tag!': 'x' }, folderId: null },
        [],
        actor,
      ),
    ).rejects.toBeInstanceOf(InvalidInputError);
  });

  it('derives the OG image when an image is used as one', async () => {
    await prepareMediaUse(ctx, [{ mediaId: imageId, field: 'og', purpose: 'og' }]);
    const og = (await getMediaDetail(db, storage, imageId)).view.variants.find(
      (v) => v.variant === 'og',
    );
    expect(og).toMatchObject({ contentType: 'image/jpeg', width: 1200, height: 630 });
    expect(og!.size).toBeLessThanOrEqual(OG_MAX_BYTES);
    // Calling it again keeps the existing file.
    await prepareMediaUse(ctx, [{ mediaId: imageId, field: 'og', purpose: 'og' }]);
    expect(
      (await getMediaDetail(db, storage, imageId)).view.variants.filter((v) => v.variant === 'og'),
    ).toHaveLength(1);
  });

  it('refuses to delete used media and lists where it is used', async () => {
    await db.transaction((tx) =>
      setMediaUsages(tx, { module: 'pages', targetType: 'page', targetId: 'p1' }, [
        { mediaId: imageId, field: 'seo.og', locale: 'en', purpose: 'og' },
      ]),
    );
    expect(await usagesOf(db, imageId)).toEqual([
      {
        module: 'pages',
        targetType: 'page',
        targetId: 'p1',
        field: 'seo.og',
        locale: 'en',
        purpose: 'og',
      },
    ]);
    expect(await code(deleteMedia(ctx, imageId, actor))).toBe('in_use');
    expect(await code(deleteMedia(ctx, '00000000-0000-4000-8000-000000000000', actor))).toBe(
      'not_found',
    );
  });

  it('replaces the file but keeps the ID, new key and derived files, old objects gone', async () => {
    const before = await getMediaDetail(db, storage, imageId);
    const oldKeys = await objectKeys(imageId);
    const data = await photo(1200, 800);
    await replaceMedia(ctx, imageId, { name: 'new.jpg', data }, limits, actor);
    const after = await getMediaDetail(db, storage, imageId);
    expect(after.view).toMatchObject({ id: imageId, name: 'Hero photo', width: 1200, height: 800 });
    expect(after.key).not.toBe(before.key);
    expect(after.replacedAt).not.toBeNull();
    expect(after.view.alt).toEqual(before.view.alt);
    expect(after.usages).toEqual(before.usages);
    // Used as OG image, so the new file gets its OG image too.
    expect(after.view.variants.map((v) => v.variant)).toEqual(
      expect.arrayContaining(['w480', 'w960', 'w1200', 'og']),
    );
    const stored = await files();
    expect(stored.filter((k) => oldKeys.includes(k))).toEqual([]);
    expect(stored).toEqual(expect.arrayContaining(await objectKeys(imageId)));
    expect(await lastAudit()).toMatchObject({ action: 'media.replace', targetId: imageId });

    expect(await code(replaceMedia(ctx, imageId, { name: 'same.jpg', data }, limits, actor))).toBe(
      'same_file',
    );
    expect(
      await code(replaceMedia(ctx, imageId, { name: 'doc.pdf', data: pdf }, limits, actor)),
    ).toBe('kind_mismatch');
  });

  it('serves the local source with cache and robots headers', async () => {
    const { GET } = await import('../../../../routes/uploads/[...key]/+server.ts');
    const detail = await getMediaDetail(db, storage, imageId);
    const get = (key: string, headers: Record<string, string> = {}) =>
      GET({
        params: { key },
        request: new Request(`http://cms.test/uploads/${key}`, { headers }),
      } as never) as Promise<Response>;

    const response = await get(detail.key);
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
    expect(response.headers.get('x-robots-tag')).toBe('noindex');
    expect(response.headers.get('x-bluepax-origin')).toBe('local');
    expect(response.headers.get('content-type')).toBe('image/jpeg');
    expect(Number(response.headers.get('content-length'))).toBe(detail.view.size);
    expect((await response.arrayBuffer()).byteLength).toBe(detail.view.size);

    const partial = await get(detail.key, { range: 'bytes=0-9' });
    expect(partial.status).toBe(206);
    expect(partial.headers.get('content-range')).toBe(`bytes 0-9/${detail.view.size}`);
    expect((await partial.arrayBuffer()).byteLength).toBe(10);

    const etag = response.headers.get('etag')!;
    expect((await get(detail.key, { 'if-none-match': etag })).status).toBe(304);
    expect((await get('2020/01/' + 'a'.repeat(64) + '.jpg')).status).toBe(404);
    expect((await get('../../etc/passwd')).status).toBe(404);

    // The cache lifetime from the storage settings applies right away.
    await saveStorageSettings(db, { cacheDays: 30, uploadLimitsMb: limits }, actor);
    expect((await get(detail.key)).headers.get('cache-control')).toBe(
      'public, max-age=2592000, immutable',
    );
  });

  it('saves the storage settings into the instance configuration', async () => {
    await saveStorageSettings(
      db,
      { cacheDays: 90, uploadLimitsMb: { image: 10, document: 50, video: 100 } },
      actor,
    );
    expect((await exportInstanceConfig(db)).storage).toEqual({
      mode: 'local',
      cacheDays: 90,
      uploadLimitsMb: { image: 10, document: 50, video: 100 },
    });
    expect(await readStorageConfig(db)).toMatchObject({ cacheDays: 90 });
    expect(await lastAudit()).toMatchObject({
      action: 'media.storage_update',
      details: { cacheDays: { from: 30, to: 90 }, uploadLimitsMb: { from: limits } },
    });
    await expect(
      saveStorageSettings(db, { cacheDays: 0, uploadLimitsMb: limits }, actor),
    ).rejects.toMatchObject({ fields: ['cacheDays'] });
    await saveStorageSettings(db, { cacheDays: 365, uploadLimitsMb: limits }, actor);
  });

  it('sets the site logo, site icon and publisher image as media usages', async () => {
    const { id: logo } = await uploadMedia(
      ctx,
      { name: 'logo.png', data: await png(400, 100) },
      null,
      limits,
      actor,
    );
    const { id: icon } = await uploadMedia(
      ctx,
      { name: 'icon.png', data: await png(512, 512, { r: 0, g: 160, b: 80 }) },
      null,
      limits,
      actor,
    );

    // The site icon must be a square PNG of at least 512 px.
    const refused = await saveBranding(
      ctx,
      { themeColor: '', logo: null, icon: logo },
      actor,
    ).catch((e: unknown) => e);
    expect(refused).toBeInstanceOf(InvalidInputError);
    expect(refused).toMatchObject({ fields: ['icon'], reason: 'not_square_png' });

    await saveBranding(ctx, { themeColor: '#1E40AF', logo, icon }, actor);
    expect(await readSiteData(db, 'site.branding')).toEqual({ themeColor: '#1e40af', logo, icon });
    const iconView = await getMediaDetail(db, storage, icon);
    expect(iconView.view.variants.map((v) => v.variant)).toEqual(
      expect.arrayContaining(['favicon', 'apple-touch', 'pwa-192', 'pwa-512']),
    );
    expect(iconView.usages).toMatchObject([
      { module: 'site', targetId: 'site.branding', field: 'icon', purpose: 'site_icon' },
    ]);
    expect(await code(deleteMedia(ctx, logo, actor))).toBe('in_use');

    // A used site icon can only be replaced by another square PNG.
    expect(
      await code(
        replaceMedia(ctx, icon, { name: 'wide.png', data: await png(600, 300) }, limits, actor),
      ),
    ).toBe('not_square_png');
    await replaceMedia(
      ctx,
      icon,
      { name: 'icon2.png', data: await png(1024, 1024, { r: 10, g: 10, b: 10 }) },
      limits,
      actor,
    );
    expect(
      (await getMediaDetail(db, storage, icon)).view.variants.filter(
        (v) => v.variant === 'pwa-512',
      ),
    ).toHaveLength(1);

    await saveGeneral(
      db,
      {
        type: 'corporate',
        name: 'Example Site',
        timezone: 'UTC',
        publisher: { type: 'organization', name: '', sameAs: [] },
        brandTerms: [],
      },
      actor,
      { media: ctx, image: logo },
    );
    expect(await readSiteData(db, 'site.publisher')).toEqual({ image: logo, authorId: null });
    expect((await usagesOf(db, logo)).map((u) => u.targetId).sort()).toEqual([
      'site.branding',
      'site.publisher',
    ]);

    // Unset everywhere: now it can be deleted, and its files go with it.
    await saveBranding(ctx, { themeColor: '', logo: null, icon }, actor);
    await saveGeneral(
      db,
      {
        type: 'corporate',
        name: 'Example Site',
        timezone: 'UTC',
        publisher: { type: 'organization', name: '', sameAs: [] },
        brandTerms: [],
      },
      actor,
      { media: ctx, image: null },
    );
    const keys = await objectKeys(logo);
    await deleteMedia(ctx, logo, actor);
    expect(await lastAudit()).toMatchObject({ action: 'media.delete', targetId: logo });
    expect((await files()).filter((k) => keys.includes(k))).toEqual([]);
    expect(await code(getMediaDetail(db, storage, logo))).toBe('not_found');
  });

  it('leaves no files behind that the database does not know', async () => {
    const rows = await db.select({ key: schema.mediaObjects.key }).from(schema.mediaObjects);
    expect((await files()).sort()).toEqual(rows.map((r) => r.key).sort());
    // Variant folders of deleted files are removed too.
    for (const year of await readdir(root)) {
      if (year.startsWith('.')) continue;
      for (const month of await readdir(join(root, year))) {
        expect((await readdir(join(root, year, month))).length).toBeGreaterThan(0);
      }
    }
  });
});
