# @bluepax/cms-blocks

[English](README.md)

[BluePax CMS](https://github.com/bluepax/bluepax-cms) 标准区块与富文本的数据结构：CMS 校验所用的 Zod schema、对应的
TypeScript 类型，以及同一份 schema 的 JSON Schema 文件（draft 2020-12），供其他语言的前台使用。

## 从 GitHub Packages 安装

本包发布在 GitHub Packages 的 npm 仓库（`npm.pkg.github.com`），不在 npmjs.com。GitHub Packages 即使是公开包，
安装时也要提供令牌。

1. **准备令牌。** 本机：创建一个带 `read:packages` 权限的经典个人令牌（GitHub → Settings → Developer settings →
   Personal access tokens → Tokens (classic)）。GitHub Actions：直接用工作流自带的 `GITHUB_TOKEN`，但要先在本包的
   设置页（“Manage Actions access”）给你的前台仓库加上读取权限。
2. **让 `@bluepax` 作用域走 GitHub Packages。** 在项目的 `.npmrc` 中写入下面两行。文件里没有密钥，可以提交：

   ```ini
   @bluepax:registry=https://npm.pkg.github.com
   //npm.pkg.github.com/:_authToken=${NODE_AUTH_TOKEN}
   ```

3. **安装。** 把令牌放进环境变量 `NODE_AUTH_TOKEN`（不要提交令牌）：

   ```bash
   export NODE_AUTH_TOKEN=<你的令牌>
   pnpm add @bluepax/cms-blocks@beta
   ```

   1.0.0 之前只有 beta 版本（dist-tag `beta`）；1.0.0 起去掉 `@beta`（dist-tag `latest`）。包的版本号与 CMS 一致：
   安装与你运行的 CMS 相同的版本（`GET /api/health` 会返回版本号）。npm 与 Yarn 用法相同（`npm install …@beta`）。

GitHub Actions 中：

```yaml
permissions:
  contents: read
  packages: read
steps:
  - uses: actions/checkout@v7
  - uses: pnpm/action-setup@v6
  - uses: actions/setup-node@v7
    with:
      node-version: 26
      registry-url: https://npm.pkg.github.com
      scope: '@bluepax'
  - run: pnpm install --frozen-lockfile
    env:
      NODE_AUTH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

在 Docker 构建中用构建密钥传入令牌（`docker build --secret id=npm,env=NODE_AUTH_TOKEN`），不要把令牌写进镜像层。

## 用法

- `blockSchemas`、`richTextSchema`：Zod schema；`BlockData<K>` 是类型为 `K` 的区块在 Delivery API 中的数据（已补全默认值）。
- `@bluepax/cms-blocks/keys`：`BLOCK_KEYS`（13 种标准区块，按规范中的顺序）与 `isBlockKey`，不依赖 Zod。
- `@bluepax/cms-blocks/schemas/index.json`：`{ richText, blocks }`，与 `GET /api/delivery/v1/schema/blocks` 相同；另有
  `schemas/rich-text.json` 与 `schemas/blocks/<key>.json`。

实例只提供已启用模块的区块，以 `GET /schema/blocks` 为准。遇到不认识的区块类型请忽略并记录。

## 许可

MIT
