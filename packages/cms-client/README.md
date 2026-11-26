# @bluepax/cms-client

[简体中文](README.zh-CN.md)

Typed client of the [BluePax CMS](https://github.com/bluepax/bluepax-cms) Delivery API v1. Its
types come from the same Zod schemas the CMS generates its OpenAPI document from.

**Server-side only.** The Delivery Token must never reach a browser: create the client in server
code (SvelteKit `+page.server.ts` / `hooks.server.ts`, a Node.js server, an edge function).

## Install

GitHub Packages needs a token even for public packages: locally a personal access token (classic)
with `read:packages`, in GitHub Actions the workflow's `GITHUB_TOKEN` (grant the repository read
access in the package settings first).

```ini
# .npmrc
@bluepax:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=${NODE_AUTH_TOKEN}
```

```bash
pnpm add @bluepax/cms-client @bluepax/cms-blocks
```

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
