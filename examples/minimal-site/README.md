# BluePax minimal site

[简体中文](README.zh-CN.md)

A minimal SvelteKit frontend for [BluePax CMS](../../README.md). It only depends on the public SDK
[`@bluepax/cms-client`](../../packages/cms-client/README.md) and renders the home page, block pages,
posts, categories, tags, authors, 404 pages and previews from the Delivery API. Styles are kept to a
minimum on purpose: copy it as a starting point, not as a theme.

- **Server-side only.** Pages render on the server (`csr = false`); the Delivery Token is read from
  `$app/env/private` in `src/lib/server/` and never reaches a browser. Server-side calls need no CORS.
- **One catch-all route.** Every path goes to `GET /routes/resolve`: a 301 redirects, a 404 renders
  the 404 page with HTTP 404, a 200 renders the page, post, category, tag or author it names. Addresses
  always come from the CMS's route templates.
- **`<head>` from the `seo` object**: title, description, canonical, robots, Open Graph, hreflang and
  JSON-LD (`jsonLdScript` escapes `<`, `>` and `&`, so the data cannot close the `<script>` element).
- **Blocks**: the standard blocks (`src/lib/components/blocks/`); rich text is the API's safe HTML.
  `{@html}` is only used for the API's `html` fields and for JSON-LD. Unknown block types are skipped
  and logged. Blocks 7, 8 and 10 wait for the catalog and regions endpoints (M4).
- **Preview** at `/preview?token=…` (the editors' "预览" button): `Cache-Control: no-store` and
  `X-Robots-Tag: noindex, nofollow`.
- **CMS unavailable**: responses are cached with their ETags; while the CMS cannot be reached, cached
  pages are still served and other requests get 503 with `Retry-After`.

## Run it in this repository

1. Start the CMS (see [CONTRIBUTING.md](../../CONTRIBUTING.md)), e.g. on `http://localhost:5173`.
2. In the CMS, open **接入与 API** (Integration & API, administrators only):
   - set **前台基础 URL** (frontend base URL) to `http://localhost:5180`: canonical URLs, hreflang and
     preview links point there;
   - **签发 Token**: issue a Delivery Token with the `delivery:read` scope. It is shown once;
   - optionally **更换预览密钥** (rotate the preview secret) and copy it, so `/preview` checks links itself.
3. `cp examples/minimal-site/.env.example examples/minimal-site/.env` and fill in
   `BLUEPAX_CMS_URL`, `BLUEPAX_DELIVERY_TOKEN` and, optionally, `BLUEPAX_PREVIEW_SECRET`.
4. `pnpm --filter @bluepax/minimal-site dev --port 5180` and open `http://localhost:5180`.

## Use it outside this repository

Copy the folder, then replace `"@bluepax/cms-client": "workspace:*"` in `package.json` with the CMS
version you run (both are released together) and run `pnpm install`. The SDK comes from npmjs and
is public: no token or `.npmrc` entry is needed.

## Production

```bash
pnpm build
ORIGIN=https://www.example.com BLUEPAX_CMS_URL=https://cms.example.com BLUEPAX_DELIVERY_TOKEN=… node build
```

`ORIGIN` is this frontend's public URL (adapter-node). Rotate the token in the CMS by issuing a new
one, switching to it and then revoking the old one.

## Not included yet

Sitemap, robots, RSS and llms.txt (`/seo/*`, M2), the webhook endpoint (`verifyWebhook()`, M2), 404
reports through the Event API (M2), inquiry forms, catalog, regions and tracking (M4).
