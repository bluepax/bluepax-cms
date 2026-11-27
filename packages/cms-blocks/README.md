# @bluepax/cms-blocks

[简体中文说明（含安装步骤）](https://github.com/bluepax/bluepax-cms/blob/dev/packages/cms-blocks/README.zh-CN.md)

Data structures of the [BluePax CMS](https://github.com/bluepax/bluepax-cms) standard blocks and
rich text: the Zod schemas the CMS validates with, their TypeScript types, and the same schemas
as JSON Schema files (draft 2020-12) for frontends in other languages.

## Install

Published on npmjs: [`@bluepax/cms-blocks`](https://www.npmjs.com/package/@bluepax/cms-blocks). The
package is public, so no token, `.npmrc` entry or registry setting is needed.

```bash
pnpm add @bluepax/cms-blocks@beta
```

Until 1.0.0 there are only betas (dist-tag `beta`); from 1.0.0 on, drop `@beta` (dist-tag `latest`).
The packages share their version numbers with the CMS: install the version of the CMS you run
(`GET /api/health` shows it), e.g. `pnpm add @bluepax/cms-blocks@<CMS version>`. npm and Yarn work the
same way (`npm install @bluepax/cms-blocks@beta`). `@bluepax/cms-client` already depends on this
package (same version); install it on its own for the schemas or the JSON Schema files.

Versions published by the release workflow carry npm provenance: the package page shows the commit
and the GitHub Actions run that built them, and `npm audit signatures` verifies it.

**Installed it from GitHub Packages before?** `1.0.0-beta.34` was published to GitHub Packages
(`npm.pkg.github.com`) only, which is no longer used. Remove the `@bluepax:registry=…` and
`//npm.pkg.github.com/:_authToken=…` lines from your `.npmrc`, drop the token, and install the npmjs
version that matches your CMS (upgrade a CMS that still runs `1.0.0-beta.34` first).

## 安装（简体中文）

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

## Use

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
