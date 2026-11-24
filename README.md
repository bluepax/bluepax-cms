# BluePax CMS

English | [简体中文](README.zh-CN.md)

An open-source, general-purpose headless CMS for corporate websites and blogs.
It provides an admin UI and APIs only and never renders public pages: every site
builds its own frontend and talks to the CMS through the versioned Delivery API,
webhooks, preview tokens and the block JSON Schema.

> **Status:** under development, not released yet. The first preview will be
> `1.0.0-beta.1`.

## Highlights

- One instance per site: its own database, domain, storage and accounts; no multi-tenancy.
- Two presets, corporate and blog, on a single codebase; optional modules can be switched on or off.
- Structured content plus pages assembled from 13 standard blocks.
- Multilingual content (BCP 47 locales, RTL support); admin UI in English and Chinese.
- Local storage by default, with optional Cloudflare R2 mirroring and delivery.
- SvelteKit + Node.js + PostgreSQL, shipped as a container with docker compose. No Redis.

## Quick start

A `docker compose` quick start will be added with the first beta.

## Frontend integration

Frontends install the typed SDK `@bluepax/cms-client` and the block schema package
`@bluepax/cms-blocks` from GitHub Packages, or generate a client from the OpenAPI document.
GitHub Packages needs a token even for public packages: locally a personal access token
(classic) with `read:packages`, in GitHub Actions the workflow's `GITHUB_TOKEN`.

```ini
# .npmrc
@bluepax:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=${NODE_AUTH_TOKEN}
```

```bash
pnpm add @bluepax/cms-client @bluepax/cms-blocks
```

See chapter 6 of the [specification](docs/spec/README.md).

## Documentation

- [Specification](docs/spec/README.md) (Chinese): the single source of truth for the implementation.
- [Contributing](CONTRIBUTING.md): development setup, branches and commit rules.
- [Security policy](SECURITY.md)

## License

[MIT](LICENSE)
