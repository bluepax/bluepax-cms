// Optional response cache (docs/adr/0013): the Delivery API sends a strong `ETag` with every
// content response and answers `If-None-Match` with 304, so a cached body can be reused without
// transferring it again. The same entries let a frontend render cached pages while the CMS is
// unreachable (chapter 6, frontend checklist step 7) when the client has `staleIfError`.

export interface CachedResponse {
  etag: string;
  /** The response body as received (JSON text). */
  body: string;
  /** When it was stored, ms since the epoch. */
  storedAt: number;
}

/** Where the client keeps responses, keyed by request URL. May be async (e.g. Redis). */
export interface ResponseCache {
  get(key: string): CachedResponse | undefined | Promise<CachedResponse | undefined>;
  set(key: string, value: CachedResponse): void | Promise<void>;
}

/** An in-process cache that keeps the most recently used `maxEntries` responses (default 500). */
export function memoryCache(options: { maxEntries?: number } = {}): ResponseCache & {
  readonly size: number;
  clear(): void;
} {
  const max = options.maxEntries ?? 500;
  if (!Number.isInteger(max) || max < 1)
    throw new RangeError('maxEntries must be a positive integer');
  const entries = new Map<string, CachedResponse>();
  return {
    get(key) {
      const entry = entries.get(key);
      if (entry) {
        // Map keeps insertion order: re-inserting marks the entry as recently used.
        entries.delete(key);
        entries.set(key, entry);
      }
      return entry;
    },
    set(key, value) {
      entries.delete(key);
      entries.set(key, value);
      while (entries.size > max) {
        const oldest = entries.keys().next();
        if (oldest.done) break;
        entries.delete(oldest.value);
      }
    },
    get size() {
      return entries.size;
    },
    clear() {
      entries.clear();
    },
  };
}
