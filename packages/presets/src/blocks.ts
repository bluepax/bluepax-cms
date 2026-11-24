// The 13 standard blocks of docs/spec/README.md chapter 4, in the order of the spec's table.
// Their JSON Schemas live in @bluepax/cms-blocks; presets only refer to them by key.
export const BLOCK_KEYS = [
  'hero', // 1
  'text-media', // 2
  'cards', // 3
  'steps', // 4
  'stats', // 5
  'logos', // 6
  'category-entry', // 7, needs catalog
  'catalog-list', // 8, needs catalog
  'featured-posts', // 9
  'service-network', // 10, needs regions
  'latest-posts', // 11
  'contact-cta', // 12
  'rich-text', // 13
] as const;

export type BlockKey = (typeof BLOCK_KEYS)[number];

export function isBlockKey(value: string): value is BlockKey {
  return (BLOCK_KEYS as readonly string[]).includes(value);
}
