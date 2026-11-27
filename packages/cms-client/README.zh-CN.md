# @bluepax/cms-client

[English](README.md)

[BluePax CMS](https://github.com/bluepax/bluepax-cms) Delivery API v1 的类型化客户端。类型来自 CMS 生成 OpenAPI
文档所用的同一组 Zod schema。

**只在服务端使用。** Delivery Token 绝不能进入浏览器：请在服务端代码中创建客户端（SvelteKit 的
`+page.server.ts` / `hooks.server.ts`、Node.js 服务、边缘函数）。

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
   pnpm add @bluepax/cms-client@beta @bluepax/cms-blocks@beta
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

```ts
import { createCmsClient, isCmsError, memoryCache } from '@bluepax/cms-client';

const cms = createCmsClient({
  baseUrl: 'https://cms.example.com', // CMS 的地址，不是前台的
  token: process.env.BLUEPAX_DELIVERY_TOKEN!, // “接入与 API”签发的 Delivery Token
  cache: memoryCache(), // 可选：按 ETag 复用响应
  staleIfError: true, // 可选：CMS 不可达时返回缓存内容
});

const route = await cms.resolveRoute('/en/blog/hello');
if (route.status === 200 && route.type === 'post') {
  const post = await cms.getPost(route.slug, { locale: route.locale });
}
```

方法与端点一一对应（见英文说明中的表格）：`getSite`、`resolveRoute`（总是返回结果，看 `status` 200 / 301 / 404）、
`getPage`、`listPosts`（可按 `category` / `tag` / `author` 过滤）、`getPost`、`listPostCategories`、`listTags`、
`listAuthors`、`getAuthor`、`getBlockSchemas`、`getPreview`（从不缓存）、`getOpenApi`（不需要 Token）。

每个方法最后一个参数可传 `{ signal }`。`cms.withFetch(fetch)` 返回改用另一个 `fetch`（如 SvelteKit 的
`event.fetch`）、设置与缓存不变的客户端。

### 错误

所有失败都是 `CmsError`：`kind`（`bad_request`、`unauthorized` 401、`forbidden` 403、`not_found` 404、`gone` 410、
`rate_limited` 429、`http`、`server` 5xx、`network`、`timeout`、`invalid_response`）、`status`、接口的 `code`、
`message` 与 `details`、`retryAfter`（秒）以及请求的 `url`。

### 辅助函数

- `verifyPreviewToken(预览密钥, token)`：调用 CMS 前先用预览密钥校验预览链接的 token（Web Crypto），CMS 端还会再校验。
- `jsonLdScript(seo.jsonLd)`：生成 `<script type="application/ld+json">` 元素，`<`、`>`、`&` 已转义，数据无法闭合该元素。
- `routePath(模板, { locale, slug })`：按 `site.frontend.routes` 中的路由模板生成地址。
- `knownBlock(block)`：按 `@bluepax/cms-blocks` 给区块数据加上类型；本版本不认识的类型返回 null（忽略并记录）。
- `@bluepax/cms-client/contract`：所有响应的 Zod schema，可用于校验响应。

`verifyWebhook()` 随 Webhook（M2）提供。

## 许可

MIT
