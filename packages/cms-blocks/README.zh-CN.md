# @bluepax/cms-blocks

[English](README.md)

[BluePax CMS](https://github.com/bluepax/bluepax-cms) 标准区块与富文本的数据结构：CMS 校验所用的 Zod schema、对应的
TypeScript 类型，以及同一份 schema 的 JSON Schema 文件（draft 2020-12），供其他语言的前台使用。

安装方式与 `@bluepax/cms-client` 相同（GitHub Packages，见其说明）。

- `blockSchemas`、`richTextSchema`：Zod schema；`BlockData<K>` 是类型为 `K` 的区块在 Delivery API 中的数据（已补全默认值）。
- `@bluepax/cms-blocks/keys`：`BLOCK_KEYS`（13 种标准区块，按规范中的顺序）与 `isBlockKey`，不依赖 Zod。
- `@bluepax/cms-blocks/schemas/index.json`：`{ richText, blocks }`，与 `GET /api/delivery/v1/schema/blocks` 相同；另有
  `schemas/rich-text.json` 与 `schemas/blocks/<key>.json`。

实例只提供已启用模块的区块，以 `GET /schema/blocks` 为准。遇到不认识的区块类型请忽略并记录。

## 许可

MIT
