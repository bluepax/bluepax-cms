// Storage abstraction, see docs/spec/README.md chapter 5 ("驱动接口"). Every file read or write
// goes through a StorageDriver; business code never touches paths or object storage SDKs.
// Built-in drivers: `local` (this package); `r2` follows in M3. A new driver only implements
// this interface and registers its factory in `DRIVERS`.
import type { Readable } from 'node:stream';

export interface ObjectInfo {
  key: string;
  size: number;
  modifiedAt: Date;
}

export interface PutOptions {
  /** MIME type the object is served with. */
  contentType: string;
  /** `Cache-Control` for drivers that store response headers with the object (R2). */
  cacheControl?: string;
}

/** Inclusive byte range, as in an HTTP `Range` header. */
export interface ByteRange {
  start: number;
  end: number;
}

export interface StorageDriver {
  /** Driver name as recorded in `media_objects.driver`, e.g. `local`. */
  readonly name: string;
  /** Writes an object, replacing any object with the same key. */
  put(key: string, body: Uint8Array | Readable, options: PutOptions): Promise<ObjectInfo>;
  /** The object's bytes (or a range of them), or null when it does not exist. */
  get(key: string, range?: ByteRange): Promise<ReadableStream<Uint8Array> | null>;
  stat(key: string): Promise<ObjectInfo | null>;
  /** Removes an object; removing a missing object is not an error. */
  delete(key: string): Promise<void>;
  exists(key: string): Promise<boolean>;
  /** Objects whose key starts with `prefix`, in key order. */
  list(prefix?: string): AsyncIterable<ObjectInfo>;
  /** URL the object is served at by this driver. */
  publicUrl(key: string): string;
}

export class StorageKeyError extends Error {
  override name = 'StorageKeyError';
}

const SEGMENT = /^[A-Za-z0-9_-][A-Za-z0-9._-]*$/;

/**
 * Checks that a key is a relative path of safe segments, so no driver can be made to read or
 * write outside its root: no leading slash, no `.` or `..`, no backslashes or empty segments.
 */
export function assertValidKey(key: string): void {
  if (key.length === 0 || key.length > 512) throw new StorageKeyError(`invalid key "${key}"`);
  for (const segment of key.split('/')) {
    if (!SEGMENT.test(segment) || segment === '.' || segment === '..') {
      throw new StorageKeyError(`invalid key "${key}"`);
    }
  }
}
