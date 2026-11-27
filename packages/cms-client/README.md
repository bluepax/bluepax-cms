# @bluepax/cms-client

[简体中文说明（含安装步骤）](https://github.com/bluepax/bluepax-cms/blob/dev/packages/cms-client/README.zh-CN.md)

Typed client of the [BluePax CMS](https://github.com/bluepax/bluepax-cms) Delivery API v1. Its
types come from the same Zod schemas the CMS generates its OpenAPI document from.

**Server-side only.** The Delivery Token must never reach a browser: create the client in server
code (SvelteKit `+page.server.ts` / `hooks.server.ts`, a Node.js server, an edge function).

## Install

Published on npmjs: [`@bluepax/cms-client`](https://www.npmjs.com/package/@bluepax/cms-client). The
package is public, so no token, `.npmrc` entry or registry setting is needed.

```bash
pnpm add @bluepax/cms-client@beta
```

Until 1.0.0 there are only betas (dist-tag `beta`); from 1.0.0 on, drop `@beta` (dist-tag `latest`).
The packages share their version numbers with the CMS: install the version of the CMS you run
(`GET /api/health` shows it), e.g. `pnpm add @bluepax/cms-client@<CMS version>`. npm and Yarn work the
same way (`npm install @bluepax/cms-client@beta`). It brings `@bluepax/cms-blocks` of the same
version along; add that package yourself only if you import it directly, at the same version.

Versions published by the release workflow carry npm provenance: the package page shows the commit
and the GitHub Actions run that built them, and `npm audit signatures` verifies it.

**Installed it from GitHub Packages before?** `1.0.0-beta.34` was published to GitHub Packages
(`npm.pkg.github.com`) only, which is no longer used. Remove the `@bluepax:registry=…` and
`//npm.pkg.github.com/:_authToken=…` lines from your `.npmrc`, drop the token, and install the npmjs
version that matches your CMS (upgrade a CMS that still runs `1.0.0-beta.34` first).

## 安装（简体中文）

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

## Use

```ts
import { createCmsClient, isCmsError, memoryCache } from '@bluepax/cms-client';

const cms = createCmsClient({
  baseUrl: 'https://cms.example.com', // the CMS, not the frontend
  token: process.env.BLUEPAX_DELIVERY_TOKEN!, // "接入与 API" → Delivery Token
  cache: memoryCache(), // optional: ETag revalidation
  staleIfError: true, // optional: cached bodies while the CMS is unreachable
});

const route = await cms.resolveRoute('/en/blog/hello');
if (route.status === 200 && route.type === 'post') {
  const post = await cms.getPost(route.slug, { locale: route.locale });
}
```

| Method                                                         | Endpoint                                                              |
| -------------------------------------------------------------- | --------------------------------------------------------------------- |
| `getSite({ locale })`                                          | `GET /site`                                                           |
| `resolveRoute(path)`                                           | `GET /routes/resolve` (always resolves; see `status` 200 / 301 / 404) |
| `getPage(slug, { locale })`                                    | `GET /pages/{slug}`                                                   |
| `listPosts({ locale, page, pageSize, category, tag, author })` | `GET /posts`                                                          |
| `getPost(slug, { locale })`                                    | `GET /posts/{slug}`                                                   |
| `listPostCategories({ locale, page, pageSize, slug })`         | `GET /post-categories`                                                |
| `listTags({ locale, page, pageSize, slug })`                   | `GET /tags`                                                           |
| `listAuthors({ locale, page, pageSize })`                      | `GET /authors`                                                        |
| `getAuthor(slug, { locale })`                                  | `GET /authors/{slug}`                                                 |
| `getBlockSchemas()`                                            | `GET /schema/blocks`                                                  |
| `getPreview(token)`                                            | `GET /preview/{token}` (never cached)                                 |
| `getOpenApi()`                                                 | `GET /openapi.json` (no token)                                        |

Every method takes `{ signal }` as its last argument. `cms.withFetch(fetch)` returns a client that
uses another `fetch` (SvelteKit's `event.fetch`, a test double) with the same settings and cache.

### Errors

Every failure is a `CmsError` with `kind` (`bad_request`, `unauthorized` 401, `forbidden` 403,
`not_found` 404, `gone` 410, `rate_limited` 429, `http`, `server` 5xx, `network`, `timeout`,
`invalid_response`), `status`, the API's `code`, `message` and `details`, `retryAfter` in seconds
and the request `url`.

```ts
try {
  await cms.getPage('about', { locale: 'en' });
} catch (error) {
  if (isCmsError(error) && error.kind === 'not_found') {
    // render the 404 page
  }
  throw error;
}
```

### Helpers

- `verifyPreviewToken(previewSecret, token)`: checks a preview link's token with the preview
  secret (Web Crypto) before calling the CMS; the CMS checks it again.
- `jsonLdScript(seo.jsonLd)`: a `<script type="application/ld+json">` element that cannot be
  closed by the data (`<`, `>` and `&` are escaped).
- `routePath(template, { locale, slug })`: fills a route template from `site.frontend.routes`.
- `knownBlock(block)`: the block with its data typed by `@bluepax/cms-blocks`, or null for a type
  this version does not know (ignore and log it).
- `@bluepax/cms-client/contract`: the Zod schemas of every response, e.g. to validate responses.

`verifyWebhook()` follows with the webhooks (M2).

## License

MIT
