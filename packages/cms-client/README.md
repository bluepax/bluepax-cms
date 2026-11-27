# @bluepax/cms-client

[简体中文说明（含安装步骤）](https://github.com/bluepax/bluepax-cms/blob/dev/packages/cms-client/README.zh-CN.md)

Typed client of the [BluePax CMS](https://github.com/bluepax/bluepax-cms) Delivery API v1. Its
types come from the same Zod schemas the CMS generates its OpenAPI document from.

**Server-side only.** The Delivery Token must never reach a browser: create the client in server
code (SvelteKit `+page.server.ts` / `hooks.server.ts`, a Node.js server, an edge function).

## Install from GitHub Packages

This package is published to the GitHub Packages npm registry (`npm.pkg.github.com`), not to
npmjs.com. GitHub Packages asks for a token even for public packages.

1. **Get a token.** On your machine: a personal access token (classic) with the `read:packages`
   scope (GitHub → Settings → Developer settings → Personal access tokens → Tokens (classic)). In
   GitHub Actions: the workflow's own `GITHUB_TOKEN`, after you open this package's settings
   ("Manage Actions access") and give your frontend repository read access.
2. **Point the `@bluepax` scope at GitHub Packages** in the project's `.npmrc`. The file holds no
   secret and can be committed:

   ```ini
   @bluepax:registry=https://npm.pkg.github.com
   //npm.pkg.github.com/:_authToken=${NODE_AUTH_TOKEN}
   ```

3. **Install** with the token in `NODE_AUTH_TOKEN` (never commit the token):

   ```bash
   export NODE_AUTH_TOKEN=<your token>
   pnpm add @bluepax/cms-client@beta @bluepax/cms-blocks@beta
   ```

   Until 1.0.0 there are only betas (dist-tag `beta`); from 1.0.0 on, drop `@beta` (dist-tag
   `latest`). The packages share their version numbers with the CMS: install the version of the CMS
   you run (`GET /api/health` shows it). npm and Yarn work the same way (`npm install …@beta`).

In GitHub Actions:

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

In a Docker build, pass the token as a build secret (`docker build --secret id=npm,env=NODE_AUTH_TOKEN`)
so it never ends up in an image layer.

## 从 GitHub Packages 安装（简体中文）

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
