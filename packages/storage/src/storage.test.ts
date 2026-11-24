import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  assertValidKey,
  createLocalDriver,
  isMediaKey,
  originalKey,
  StorageKeyError,
  variantKey,
  type StorageDriver,
} from './index.ts';

const hash = 'ab'.repeat(32);

describe('object keys', () => {
  it('builds original keys from the UTC year and month', () => {
    expect(originalKey(new Date('2026-01-31T23:30:00Z'), hash, 'jpg')).toBe(`2026/01/${hash}.jpg`);
    expect(() => originalKey(new Date(), 'nothex', 'jpg')).toThrow();
    expect(() => originalKey(new Date(), hash, 'J PG')).toThrow();
  });

  it('puts variants in a folder named after the original hash', () => {
    const original = `2026/11/${hash}.png`;
    expect(variantKey(original, 'w960', 'webp')).toBe(`2026/11/${hash}/w960.webp`);
    expect(() => variantKey(`2026/11/${hash}/w960.webp`, 'og', 'jpg')).toThrow();
    expect(() => variantKey(original, '../x', 'jpg')).toThrow();
  });

  it('recognises media keys', () => {
    expect(isMediaKey(`2026/11/${hash}.png`)).toBe(true);
    expect(isMediaKey(`2026/11/${hash}/apple-touch.png`)).toBe(true);
    expect(isMediaKey(`2026/11/${hash}/../x.png`)).toBe(false);
    expect(isMediaKey('etc/passwd')).toBe(false);
  });

  it('rejects keys that could leave the storage root', () => {
    for (const key of ['', '/abs', '../x', 'a/../b', 'a//b', 'a\\b', '.hidden', 'a/./b']) {
      expect(() => assertValidKey(key), key).toThrow(StorageKeyError);
    }
    expect(() => assertValidKey('2026/11/file.webp')).not.toThrow();
  });
});

describe('local driver', () => {
  let root: string;
  let driver: StorageDriver;

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'bluepax-storage-'));
    driver = createLocalDriver({ root: join(root, 'uploads'), publicBaseUrl: '/uploads/' });
  });

  afterAll(async () => {
    await rm(root, { recursive: true, force: true });
  });

  async function text(stream: ReadableStream<Uint8Array> | null): Promise<string | null> {
    return stream ? new Response(stream).text() : null;
  }

  it('writes, reads, stats and deletes objects', async () => {
    const key = `2026/11/${hash}.txt`;
    expect(await driver.exists(key)).toBe(false);
    expect(await driver.get(key)).toBeNull();
    expect(await driver.stat(key)).toBeNull();

    const info = await driver.put(key, new TextEncoder().encode('hello world'), {
      contentType: 'text/plain',
    });
    expect(info).toMatchObject({ key, size: 11 });
    expect(await driver.exists(key)).toBe(true);
    expect(await text(await driver.get(key))).toBe('hello world');
    expect(await text(await driver.get(key, { start: 6, end: 10 }))).toBe('world');

    await driver.put(key, Readable.from([Buffer.from('replaced')]), { contentType: 'text/plain' });
    expect(await text(await driver.get(key))).toBe('replaced');

    await driver.delete(key);
    await driver.delete(key);
    expect(await driver.exists(key)).toBe(false);
  });

  it('lists objects in key order and skips temporary files', async () => {
    const keys = [`2026/11/${hash}.png`, `2026/11/${hash}/w480.webp`, `2026/12/${hash}.pdf`];
    for (const key of [...keys].reverse()) {
      await driver.put(key, new Uint8Array([1, 2, 3]), { contentType: 'application/octet-stream' });
    }
    const all: string[] = [];
    for await (const o of driver.list()) all.push(o.key);
    expect(all).toEqual(keys);

    const november: string[] = [];
    for await (const o of driver.list('2026/11/')) november.push(o.key);
    expect(november).toEqual(keys.slice(0, 2));

    const variants: string[] = [];
    for await (const o of driver.list(`2026/11/${hash}/`)) variants.push(o.key);
    expect(variants).toEqual([keys[1]]);
  });

  it('removes empty variant folders on delete', async () => {
    await driver.delete(`2026/11/${hash}/w480.webp`);
    expect(await readdir(join(root, 'uploads', '2026', '11'))).toEqual([`${hash}.png`]);
  });

  it('builds public URLs and refuses invalid keys', async () => {
    expect(driver.publicUrl(`2026/11/${hash}.png`)).toBe(`/uploads/2026/11/${hash}.png`);
    await expect(driver.get('../outside')).rejects.toThrow(StorageKeyError);
    await expect(driver.put('a/../../b', new Uint8Array(), { contentType: 'x' })).rejects.toThrow(
      StorageKeyError,
    );
  });
});
