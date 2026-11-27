# @bluepax/cms-client

[English](README.md)

[BluePax CMS](https://github.com/bluepax/bluepax-cms) Delivery API v1 的类型化客户端。类型来自 CMS 生成 OpenAPI
文档所用的同一组 Zod schema。

**只在服务端使用。** Delivery Token 绝不能进入浏览器：请在服务端代码中创建客户端（SvelteKit 的
`+page.server.ts` / `hooks.server.ts`、Node.js 服务、边缘函数）。

## 安装

本包发布在 npmjs：[`@bluepax/cms-client`](https://www.npmjs.com/package/@bluepax/cms-client)。包是公开的，
安装不需要令牌、`.npmrc` 或任何仓库设置。

```bash
pnpm add @bluepax/cms-client@beta
```

1.0.0 之前只有 beta 版本（dist-tag `beta`）；1.0.0 起去掉 `@beta`（dist-tag `latest`）。包的版本号与 CMS 一致：
安装与你运行的 CMS 相同的版本（`GET /api/health` 会返回版本号），如 `pnpm add @bluepax/cms-client@<CMS 版本>`。npm
与 Yarn 用法相同（`npm install @bluepax/cms-client@beta`）。它会带上同一版本的 `@bluepax/cms-blocks`；
只有直接引用那个包时才需要自己安装，版本保持一致。

由发布工作流发布的版本带 npm 来源证明（provenance）：包页面会显示构建它的提交与 GitHub Actions 运行，
`npm audit signatures` 可以校验。

**以前从 GitHub Packages 安装过？** `1.0.0-beta.34` 只发布在 GitHub Packages（`npm.pkg.github.com`），
那里已不再使用。请从 `.npmrc` 删除 `@bluepax:registry=…` 与 `//npm.pkg.github.com/:_authToken=…` 两行，
去掉不再需要的令牌，再从 npmjs 安装与你的 CMS 相同的版本（CMS 还在运行 `1.0.0-beta.34` 的话先升级 CMS）。

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
