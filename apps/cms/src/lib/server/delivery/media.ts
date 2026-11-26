// Media in Delivery responses (docs/spec/README.md chapter 6: absolute URLs at the current
// distribution origin, size, alt per language and derived files; docs/adr/0012). Local storage is
// the only origin in M1, so URLs start with the CMS's public origin.
import type { Executor } from '@bluepax/db';
import type { StorageDriver } from '@bluepax/storage';
import { getMediaViews, type MediaView } from '../modules/media/library.ts';
import type { Media, OgImage } from '@bluepax/cms-client/contract';

export function absoluteMediaUrl(origin: string, url: string): string {
  return new URL(url, origin).toString();
}

export function toDeliveryMedia(origin: string, view: MediaView): Media {
  return {
    id: view.id,
    kind: view.kind,
    mimeType: view.mimeType,
    url: absoluteMediaUrl(origin, view.url),
    width: view.width,
    height: view.height,
    size: view.size,
    alt: view.alt,
    variants: view.variants.map((v) => ({
      name: v.variant,
      url: absoluteMediaUrl(origin, v.url),
      contentType: v.contentType,
      width: v.width,
      height: v.height,
    })),
  };
}

/** Loads media items once per response; asking again for a known ID costs nothing. */
export class MediaLoader {
  readonly #db: Executor;
  readonly #storage: StorageDriver;
  readonly #origin: string;
  readonly #cache = new Map<string, Media | null>();

  constructor(db: Executor, storage: StorageDriver, origin: string) {
    this.#db = db;
    this.#storage = storage;
    this.#origin = origin;
  }

  /** Fetches the items that are not cached yet. */
  async load(ids: Iterable<string | null | undefined>): Promise<void> {
    const missing = [...new Set(ids)].filter(
      (id): id is string => typeof id === 'string' && !this.#cache.has(id),
    );
    if (missing.length === 0) return;
    const views = await getMediaViews(this.#db, this.#storage, missing);
    for (const id of missing) this.#cache.set(id, null);
    for (const view of views) this.#cache.set(view.id, toDeliveryMedia(this.#origin, view));
  }

  /** A loaded item, or null when it is unknown (or was not loaded). */
  get(id: string | null | undefined): Media | null {
    return id ? (this.#cache.get(id) ?? null) : null;
  }

  async one(id: string | null | undefined): Promise<Media | null> {
    await this.load([id]);
    return this.get(id);
  }

  /** The loaded items among `ids`, by ID. */
  map(ids: Iterable<string>): Record<string, Media> {
    const result: Record<string, Media> = {};
    for (const id of ids) {
      const media = this.get(id);
      if (media) result[id] = media;
    }
    return result;
  }
}

/**
 * The OG image of a media item (chapter 5: always the derived 1200×630 JPG). An image saved
 * before it was used as an OG image may not have one yet; then the original stands in.
 */
export function ogImageOf(media: Media | null, locale: string): OgImage | null {
  if (!media || media.kind !== 'image') return null;
  const og = media.variants.find((v) => v.name === 'og');
  return {
    url: og?.url ?? media.url,
    width: og ? og.width : media.width,
    height: og ? og.height : media.height,
    type: og?.contentType ?? media.mimeType,
    alt: media.alt[locale] ?? '',
  };
}
