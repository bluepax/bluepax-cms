# @bluepax/cms-blocks

[简体中文](README.zh-CN.md)

Data structures of the [BluePax CMS](https://github.com/bluepax/bluepax-cms) standard blocks and
rich text: the Zod schemas the CMS validates with, their TypeScript types, and the same schemas
as JSON Schema files (draft 2020-12) for frontends in other languages.

Install it like `@bluepax/cms-client` (GitHub Packages, see its README).

```ts
import type { BlockData } from '@bluepax/cms-blocks';
import { BLOCK_KEYS, isBlockKey } from '@bluepax/cms-blocks/keys'; // no Zod

function hero(data: BlockData<'hero'>) {
  return data.title;
}
```

- `blockSchemas`, `richTextSchema`: Zod schemas; `BlockData<K>` is the data a block of type `K`
  has in the Delivery API (defaults filled in).
- `@bluepax/cms-blocks/keys`: `BLOCK_KEYS` (the 13 standard blocks in the specification's order)
  and `isBlockKey`.
- `@bluepax/cms-blocks/schemas/index.json`: `{ richText, blocks }`, like
  `GET /api/delivery/v1/schema/blocks`; also `schemas/rich-text.json` and
  `schemas/blocks/<key>.json`.

An instance only offers the blocks of its active modules: ask `GET /schema/blocks` for those.
Ignore block types you do not know, and log them.

## License

MIT
