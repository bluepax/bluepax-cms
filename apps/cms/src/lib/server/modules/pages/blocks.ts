// Blocks of a page language (docs/spec/README.md chapter 4, "标准区块"): validation against the
// block schemas of @bluepax/cms-blocks and against what this instance offers. A block is only
// offered when the instance configuration lists it and an active module provides it; a feature
// that needs an optional module (Hero's selector bar, the contact form) only when that module is
// active. Blocks and features that became unavailable stay as they are but cannot be changed.
import { randomUUID } from 'node:crypto';
import type { ModuleId, ModuleRegistry } from '@bluepax/core';
import {
  BLOCK_FEATURES,
  BLOCK_KEYS,
  blockMedia,
  blockSchemas,
  isBlockKey,
  type Block,
  type BlockKey,
} from '@bluepax/cms-blocks';
import type { InstanceConfig } from '@bluepax/presets';
import { z } from 'zod';
import type { UsageRef } from '../media/library.ts';
import { PageError } from './errors.ts';

/** Most blocks on one page language. */
export const MAX_BLOCKS = 100;

export interface BlockOffer {
  /** Blocks that can be added, in the order of the spec's table. */
  blocks: BlockKey[];
  /** Active modules, for block features. */
  modules: ReadonlySet<string>;
}

/** The blocks and features this instance offers (chapter 2, "可用区块"; chapter 3). */
export function blockOffer(
  config: Pick<InstanceConfig, 'blocks'>,
  registry: ModuleRegistry,
  active: ReadonlySet<ModuleId>,
): BlockOffer {
  const provided = new Set(
    registry
      .all()
      .filter((m) => active.has(m.id))
      .flatMap((m) => m.blocks ?? []),
  );
  return {
    blocks: BLOCK_KEYS.filter((key) => config.blocks.available.includes(key) && provided.has(key)),
    modules: active,
  };
}

/** Features of a block type that the offer leaves off, by field. */
export function unavailableFeatures(type: BlockKey, offer: BlockOffer): string[] {
  return Object.entries(BLOCK_FEATURES[type] ?? {})
    .filter(([, feature]) => !offer.modules.has(feature.module))
    .map(([field]) => field);
}

/** Deep equality of JSON values; object key order does not matter (jsonb does not keep it). */
export function sameJson(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((value, i) => sameJson(value, b[i]));
  }
  const x = a as Record<string, unknown>;
  const y = b as Record<string, unknown>;
  const keys = Object.keys(x);
  return (
    keys.length === Object.keys(y).length &&
    keys.every((key) => Object.hasOwn(y, key) && sameJson(x[key], y[key]))
  );
}

const submitted = z
  .array(
    z.strictObject({
      id: z.string().max(64).optional(),
      type: z.string().max(64),
      data: z.unknown(),
    }),
  )
  .max(MAX_BLOCKS);

function issuePaths(error: z.ZodError, prefix: string): string[] {
  return error.issues.map((issue) => [prefix, ...issue.path].join('.'));
}

/** Stored data in its current schema form (defaults of later fields filled in), or as stored. */
export function readBlockData(type: string, data: unknown): unknown {
  if (!isBlockKey(type)) return data;
  const parsed = blockSchemas[type].safeParse(data);
  return parsed.success ? parsed.data : data;
}

/**
 * Validates the blocks of a language. `stored` are its current blocks by ID; blocks keep their
 * ID, new ones (or IDs this language does not have) get a fresh one. Field errors name form
 * paths such as `blocks.2.data.buttons.0.url`.
 */
export function parseBlocks(
  input: unknown,
  offer: BlockOffer,
  stored: ReadonlyMap<string, { type: string; data: unknown }>,
): Block[] {
  const list = submitted.safeParse(input);
  if (!list.success) throw new PageError('invalid', { fields: issuePaths(list.error, 'blocks') });
  const fields: string[] = [];
  const used = new Set<string>();
  const blocks: Block[] = [];
  list.data.forEach((item, index) => {
    const at = `blocks.${index}`;
    if (!isBlockKey(item.type)) {
      fields.push(`${at}.type`);
      return;
    }
    const type = item.type;
    const before =
      item.id && !used.has(item.id) && stored.get(item.id)?.type === type
        ? stored.get(item.id)
        : undefined;
    const id = before ? item.id! : randomUUID();
    used.add(id);
    const parsed = blockSchemas[type].safeParse(item.data);
    const unchanged =
      before !== undefined && sameJson(readBlockData(type, before.data), parsed.data);
    if (!offer.blocks.includes(type) && !unchanged) {
      throw new PageError('block_unavailable', { fields: [`${at}.type`] });
    }
    if (!parsed.success) {
      fields.push(...issuePaths(parsed.error, `${at}.data`));
      return;
    }
    const data = parsed.data as Record<string, unknown>;
    const previous = before ? (readBlockData(type, before.data) as Record<string, unknown>) : {};
    for (const field of unavailableFeatures(type, offer)) {
      const off = BLOCK_FEATURES[type]?.[field]?.off;
      if (!sameJson(data[field], off) && !sameJson(data[field], previous[field])) {
        fields.push(`${at}.data.${field}`);
      }
    }
    blocks.push({ id, type, data: parsed.data } as Block);
  });
  if (fields.length > 0) throw new PageError('invalid', { fields: [...new Set(fields)] });
  return blocks;
}

/** A media usage of a block with the form field it comes from, for error messages. */
export interface BlockMediaUse {
  ref: UsageRef;
  /** Form path, e.g. `blocks.2.data.image`. */
  formField: string;
}

/** Media usages of the blocks of one language; fields name the block by its ID. */
export function blocksMediaUses(blocks: readonly Block[]): BlockMediaUse[] {
  return blocks.flatMap((block, index) =>
    blockMedia(block).map((media) => ({
      ref: {
        mediaId: media.mediaId,
        field: `blocks.${block.id}.${media.path}`,
        kind: media.kind === 'image' ? ('image' as const) : (['image', 'video'] as const),
      },
      formField: `blocks.${index}.data.${media.path}`,
    })),
  );
}
