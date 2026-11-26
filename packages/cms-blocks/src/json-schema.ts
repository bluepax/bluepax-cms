// JSON Schemas of the blocks and of rich text (docs/spec/README.md chapters 4 and 6), generated
// from the Zod schemas, which stay the single definition (docs/adr/0009, 0012). They describe the
// data as the Delivery API returns it, defaults filled in. `GET /schema/blocks` serves them; the
// published package will ship the same output as files.
import { z } from 'zod';
import { BLOCK_KEYS, blockSchemas, type BlockKey } from './blocks.ts';
import { richTextSchema } from './rich-text.ts';

export type JsonSchema = Record<string, unknown>;

const options = { io: 'output', unrepresentable: 'any', target: 'draft-2020-12' } as const;

let cache: { richText: JsonSchema; blocks: Record<BlockKey, JsonSchema> } | undefined;

function all() {
  cache ??= {
    richText: z.toJSONSchema(richTextSchema, options) as JsonSchema,
    blocks: Object.fromEntries(
      BLOCK_KEYS.map((key) => [key, z.toJSONSchema(blockSchemas[key], options) as JsonSchema]),
    ) as Record<BlockKey, JsonSchema>,
  };
  return cache;
}

/** The rich text schema and the schemas of the given blocks, in the order of the spec's table. */
export function blockJsonSchemas(keys: readonly BlockKey[] = BLOCK_KEYS): {
  richText: JsonSchema;
  blocks: Partial<Record<BlockKey, JsonSchema>>;
} {
  const { richText, blocks } = all();
  return {
    richText,
    blocks: Object.fromEntries(
      BLOCK_KEYS.filter((k) => keys.includes(k)).map((k) => [k, blocks[k]]),
    ),
  };
}
