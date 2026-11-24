// Local driver (chapter 5): objects are files below a root folder, `/data/uploads` in the
// container (the `uploads` volume, chapter 9). The local copy is always the primary copy.
import { randomBytes } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, opendir, rename, rm, rmdir, stat, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { assertValidKey, type ByteRange, type ObjectInfo, type StorageDriver } from './driver.ts';

export const DEFAULT_LOCAL_ROOT = '/data/uploads';

export interface LocalDriverOptions {
  /** Root folder; created on first write. */
  root: string;
  /** URL prefix the objects are served under, e.g. `/uploads` or `https://cms.example.com/uploads`. */
  publicBaseUrl: string;
}

/** Writes go to a temporary file first and are renamed into place, so readers never see half a file. */
const TMP_DIR = '.tmp';

export function createLocalDriver(options: LocalDriverOptions): StorageDriver {
  const root = resolve(options.root);
  const base = options.publicBaseUrl.replace(/\/+$/, '');

  const pathOf = (key: string): string => {
    assertValidKey(key);
    const path = join(root, ...key.split('/'));
    // Defence in depth: assertValidKey already rules out leaving the root.
    if (!path.startsWith(root + sep)) throw new Error(`key "${key}" leaves the storage root`);
    return path;
  };

  async function info(key: string, path: string): Promise<ObjectInfo | null> {
    try {
      const s = await stat(path);
      return s.isFile() ? { key, size: s.size, modifiedAt: s.mtime } : null;
    } catch (error) {
      if (isNotFound(error)) return null;
      throw error;
    }
  }

  /** Removes empty folders between a deleted file and the root (e.g. a variant folder). */
  async function prune(folder: string): Promise<void> {
    while (folder.startsWith(root + sep)) {
      try {
        await rmdir(folder);
      } catch {
        return;
      }
      folder = dirname(folder);
    }
  }

  async function* walk(folder: string): AsyncGenerator<string> {
    let dir;
    try {
      dir = await opendir(folder);
    } catch (error) {
      if (isNotFound(error)) return;
      throw error;
    }
    const entries: { name: string; isDir: boolean }[] = [];
    for await (const entry of dir) {
      if (entry.name.startsWith('.')) continue;
      if (entry.isDirectory()) entries.push({ name: entry.name, isDir: true });
      else if (entry.isFile()) entries.push({ name: entry.name, isDir: false });
    }
    // Sort as keys sort: a folder `a` stands for `a/…`, which comes after a file `a.webp`.
    const sortName = (e: { name: string; isDir: boolean }) => (e.isDir ? `${e.name}/` : e.name);
    entries.sort((a, b) => (sortName(a) < sortName(b) ? -1 : sortName(a) > sortName(b) ? 1 : 0));
    for (const entry of entries) {
      const path = join(folder, entry.name);
      if (entry.isDir) yield* walk(path);
      else yield path;
    }
  }

  return {
    name: 'local',

    async put(key, body) {
      const path = pathOf(key);
      const tmpFolder = join(root, TMP_DIR);
      await mkdir(tmpFolder, { recursive: true });
      await mkdir(dirname(path), { recursive: true });
      const tmp = join(tmpFolder, `${randomBytes(12).toString('hex')}.part`);
      try {
        if (body instanceof Readable) await pipeline(body, createWriteStream(tmp));
        else await writeFile(tmp, body);
        await rename(tmp, path);
      } catch (error) {
        await rm(tmp, { force: true });
        throw error;
      }
      const result = await info(key, path);
      if (!result) throw new Error(`object "${key}" vanished after writing`);
      return result;
    },

    async get(key, range?: ByteRange) {
      const path = pathOf(key);
      if (!(await info(key, path))) return null;
      const stream = createReadStream(path, range ? { start: range.start, end: range.end } : {});
      return Readable.toWeb(stream) as ReadableStream<Uint8Array>;
    },

    stat(key) {
      return info(key, pathOf(key));
    },

    async delete(key) {
      const path = pathOf(key);
      await rm(path, { force: true });
      await prune(dirname(path));
    },

    async exists(key) {
      return (await info(key, pathOf(key))) !== null;
    },

    async *list(prefix = '') {
      // Start at the deepest folder the prefix names, then filter by the full prefix.
      const folderPart = prefix.includes('/') ? prefix.slice(0, prefix.lastIndexOf('/')) : '';
      if (folderPart) assertValidKey(folderPart);
      const start = folderPart ? join(root, ...folderPart.split('/')) : root;
      for await (const path of walk(start)) {
        const key = relative(root, path).split(sep).join('/');
        if (!key.startsWith(prefix)) continue;
        const result = await info(key, path);
        if (result) yield result;
      }
    },

    publicUrl(key) {
      assertValidKey(key);
      return `${base}/${key}`;
    },
  };
}

function isNotFound(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException | null)?.code;
  return code === 'ENOENT' || code === 'ENOTDIR';
}
