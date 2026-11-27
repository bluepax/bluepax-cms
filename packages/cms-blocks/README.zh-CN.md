# @bluepax/cms-blocks

[English](README.md)

[BluePax CMS](https://github.com/bluepax/bluepax-cms) 标准区块与富文本的数据结构：CMS 校验所用的 Zod schema、对应的
TypeScript 类型，以及同一份 schema 的 JSON Schema 文件（draft 2020-12），供其他语言的前台使用。

## 安装

本包发布在 npmjs：[`@bluepax/cms-blocks`](https://www.npmjs.com/package/@bluepax/cms-blocks)。包是公开的，
安装不需要令牌、`.npmrc` 或任何仓库设置。

```bash
pnpm add @bluepax/cms-blocks@beta
```

1.0.0 之前只有 beta 版本（dist-tag `beta`）；1.0.0 起去掉 `@beta`（dist-tag `latest`）。包的版本号与 CMS 一致：
安装与你运行的 CMS 相同的版本（`GET /api/health` 会返回版本号），如 `pnpm add @bluepax/cms-blocks@<CMS 版本>`。npm
与 Yarn 用法相同（`npm install @bluepax/cms-blocks@beta`）。`@bluepax/cms-client` 已依赖本包（同一版本）；只需要
schema 或 JSON Schema 文件时单独安装本包。

由发布工作流发布的版本带 npm 来源证明（provenance）：包页面会显示构建它的提交与 GitHub Actions 运行，
`npm audit signatures` 可以校验。

**以前从 GitHub Packages 安装过？** `1.0.0-beta.34` 只发布在 GitHub Packages（`npm.pkg.github.com`），
那里已不再使用。请从 `.npmrc` 删除 `@bluepax:registry=…` 与 `//npm.pkg.github.com/:_authToken=…` 两行，
去掉不再需要的令牌，再从 npmjs 安装与你的 CMS 相同的版本（CMS 还在运行 `1.0.0-beta.34` 的话先升级 CMS）。

## 用法

- `blockSchemas`、`richTextSchema`：Zod schema；`BlockData<K>` 是类型为 `K` 的区块在 Delivery API 中的数据（已补全默认值）。
- `@bluepax/cms-blocks/keys`：`BLOCK_KEYS`（13 种标准区块，按规范中的顺序）与 `isBlockKey`，不依赖 Zod。
- `@bluepax/cms-blocks/schemas/index.json`：`{ richText, blocks }`，与 `GET /api/delivery/v1/schema/blocks` 相同；另有
  `schemas/rich-text.json` 与 `schemas/blocks/<key>.json`。

实例只提供已启用模块的区块，以 `GET /schema/blocks` 为准。遇到不认识的区块类型请忽略并记录。

## 许可

MIT
