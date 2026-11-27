import type { Media } from '@bluepax/cms-client';

/** `srcset` from the WebP width variants (`w480`, `w960`, `w1600`), like the CMS's rich text. */
export function srcsetOf(media: Media): string {
  return media.variants
    .filter((v) => v.name.startsWith('w') && v.contentType === 'image/webp' && v.width)
    .sort((a, b) => (a.width ?? 0) - (b.width ?? 0))
    .map((v) => `${v.url} ${v.width}w`)
    .join(', ');
}

export function variantUrl(media: Media | null, name: string): string | null {
  return media?.variants.find((v) => v.name === name)?.url ?? null;
}

/** Alt text in the page's language; images without one are decorative (`alt=""`). */
export function altOf(media: Media, locale: string): string {
  return media.alt[locale] ?? '';
}
