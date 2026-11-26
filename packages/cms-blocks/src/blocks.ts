// The 13 standard blocks (docs/spec/README.md chapter 4, "标准区块"): one schema per block for
// the data the CMS stores and the Delivery API returns. The frontend renders them; there is no
// custom HTML block. These Zod schemas are the single definition, and the JSON Schemas of the
// published package are generated from them (docs/adr/0009).
import { z } from 'zod';
import type { BlockKey } from './keys.ts';
import { isLinkUrl, LINK_MAX_LENGTH } from './links.ts';
import { richTextMedia, richTextSchema, type RichTextDoc } from './rich-text.ts';

const text = (max: number) => z.string().trim().max(max).default('');
/** A media item (its ID), or null for none. */
const media = z.uuid().nullable().default(null);
const linkUrl = z
  .string()
  .trim()
  .max(LINK_MAX_LENGTH)
  .refine(isLinkUrl, 'must be a path, URL, mailto: or tel:');
const optionalLinkUrl = z.union([z.literal(''), linkUrl]).default('');
/** A button or link: both a label and a target. */
const button = z.strictObject({
  label: z.string().trim().min(1).max(80),
  url: linkUrl,
});
const ids = (max: number) => z.array(z.uuid()).max(max).default([]);
/** Lowercase key, e.g. a catalog type (`products`) or a business type. */
const key = z
  .string()
  .trim()
  .regex(/^[a-z][a-z0-9-]{0,63}$/, 'must be a lowercase key');

export const blockSchemas = {
  hero: z.strictObject({
    title: text(200),
    subtitle: text(500),
    /** Background image or video. */
    background: media,
    buttons: z.array(button).max(2).default([]),
    /** Spec selector bar for a catalog type; needs `catalog`, off (null) by default. */
    selector: z.strictObject({ catalogType: key }).nullable().default(null),
  }),
  'text-media': z.strictObject({
    title: text(200),
    body: richTextSchema.default({ type: 'doc', content: [] }),
    image: media,
    /** Image before (`start`) or after (`end`) the text, in reading direction. */
    imagePosition: z.enum(['start', 'end']).default('end'),
    button: button.nullable().default(null),
  }),
  cards: z.strictObject({
    title: text(200),
    columns: z.int().min(2).max(4).default(3),
    cards: z
      .array(
        z.strictObject({
          icon: media,
          title: text(200),
          description: text(1000),
          url: optionalLinkUrl,
        }),
      )
      .max(24)
      .default([]),
  }),
  steps: z.strictObject({
    title: text(200),
    /** Numbered in this order. */
    steps: z
      .array(z.strictObject({ title: text(200), description: text(1000) }))
      .max(20)
      .default([]),
  }),
  stats: z.strictObject({
    items: z
      .array(
        z.strictObject({
          /** As displayed, e.g. `1200` or `24/7`. */
          value: z.string().trim().min(1).max(20),
          unit: text(20),
          label: text(200),
        }),
      )
      .max(12)
      .default([]),
  }),
  logos: z.strictObject({
    title: text(200),
    logos: z
      .array(z.strictObject({ name: text(100), image: z.uuid(), url: optionalLinkUrl }))
      .max(60)
      .default([]),
  }),
  'category-entry': z.strictObject({
    /** Catalog type key; its published categories are read automatically. */
    catalogType: key.nullable().default(null),
  }),
  'catalog-list': z.strictObject({
    /** Hand-picked items, or the first N items of a category. */
    mode: z.enum(['manual', 'category']).default('manual'),
    itemIds: ids(24),
    categoryId: z.uuid().nullable().default(null),
    limit: z.int().min(1).max(24).default(6),
  }),
  'featured-posts': z.strictObject({
    /** Hand-picked posts from a category, or its latest N posts. */
    mode: z.enum(['manual', 'latest']).default('latest'),
    categoryId: z.uuid().nullable().default(null),
    postIds: ids(12),
    limit: z.int().min(1).max(12).default(3),
  }),
  'service-network': z.strictObject({
    /** Legal entities and regions to show; empty shows all. */
    legalEntityIds: ids(50),
    regionIds: ids(50),
  }),
  'latest-posts': z.strictObject({
    limit: z.int().min(1).max(24).default(3),
    categoryId: z.uuid().nullable().default(null),
  }),
  'contact-cta': z.strictObject({
    title: text(200),
    description: text(1000),
    /** Default business type of the inquiry form; needs `inquiries`. */
    businessType: key.nullable().default(null),
    /** Shows the inquiry form; needs `inquiries`. */
    showForm: z.boolean().default(false),
    /** Shows the instant messaging button of the site settings. */
    showIm: z.boolean().default(false),
    link: button.nullable().default(null),
  }),
  'rich-text': z.strictObject({
    title: text(200),
    body: richTextSchema.default({ type: 'doc', content: [] }),
  }),
} as const satisfies Record<BlockKey, z.ZodType>;

export type BlockData<K extends BlockKey = BlockKey> = z.output<(typeof blockSchemas)[K]>;

/** Type and data of a block, correlated: `data` is the data of `type`. */
export type BlockContent = { [K in BlockKey]: { type: K; data: BlockData<K> } }[BlockKey];

/** A stored block; `id` stays the same while the block exists. */
export type Block = BlockContent & { id: string };

/** Optional modules a block feature needs (chapter 2 and 4). */
export type BlockModule = 'catalog' | 'inquiries' | 'regions';

/**
 * Fields of a block that are only available while an optional module is active, with their
 * "off" value: Hero's selector bar needs `catalog`, the contact CTA's form needs `inquiries`.
 * While the module is off a field must keep that value (or the value it already had). Whole
 * blocks that need a module (7 and 8: `catalog`, 10: `regions`) are provided by that module's
 * manifest instead.
 */
export const BLOCK_FEATURES: Readonly<
  Partial<Record<BlockKey, Readonly<Record<string, { module: BlockModule; off: unknown }>>>>
> = {
  hero: { selector: { module: 'catalog', off: null } },
  'contact-cta': {
    showForm: { module: 'inquiries', off: false },
    businessType: { module: 'inquiries', off: null },
  },
};

/** Blocks that need an optional module, and the module that provides them. */
export const MODULE_BLOCKS: Readonly<Record<BlockModule, readonly BlockKey[]>> = {
  catalog: ['category-entry', 'catalog-list'],
  inquiries: [],
  regions: ['service-network'],
};

/** Data of a new, empty block. */
export function emptyBlockData<K extends BlockKey>(type: K): BlockData<K> {
  return blockSchemas[type].parse({}) as BlockData<K>;
}

/** What a media field of a block accepts. */
export type BlockMediaKind = 'image' | 'image-or-video';

export interface BlockMediaRef {
  /** Field path inside the block data, e.g. `cards.2.icon` or `body`. */
  path: string;
  mediaId: string;
  kind: BlockMediaKind;
}

function richTextRefs(path: string, doc: RichTextDoc): BlockMediaRef[] {
  return richTextMedia(doc).map((mediaId) => ({ path, mediaId, kind: 'image' }));
}

/** Media items a block uses, for the media usages and the media checks before saving. */
export function blockMedia(block: BlockContent): BlockMediaRef[] {
  const refs: BlockMediaRef[] = [];
  const add = (path: string, mediaId: string | null, kind: BlockMediaKind = 'image') => {
    if (mediaId) refs.push({ path, mediaId, kind });
  };
  switch (block.type) {
    case 'hero':
      add('background', block.data.background, 'image-or-video');
      break;
    case 'text-media':
      add('image', block.data.image);
      refs.push(...richTextRefs('body', block.data.body));
      break;
    case 'cards':
      block.data.cards.forEach((card, i) => add(`cards.${i}.icon`, card.icon));
      break;
    case 'logos':
      block.data.logos.forEach((logo, i) => add(`logos.${i}.image`, logo.image));
      break;
    case 'rich-text':
      refs.push(...richTextRefs('body', block.data.body));
      break;
    default:
      break;
  }
  return refs;
}
