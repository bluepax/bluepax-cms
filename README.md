# BluePax CMS

English | [简体中文](README.zh-CN.md)

An open-source, general-purpose headless CMS for corporate websites and blogs.
It provides an admin UI and APIs only and never renders public pages: every site
builds its own frontend and talks to the CMS through the versioned Delivery API,
webhooks, preview tokens and the block JSON Schema.

- **Docker image:** `ghcr.io/bluepax/bluepax-cms` on the GitHub Container Registry.
- **npm packages, published on npmjs:**
  [`@bluepax/cms-client`](https://www.npmjs.com/package/@bluepax/cms-client), the typed Delivery
  API client, and [`@bluepax/cms-blocks`](https://www.npmjs.com/package/@bluepax/cms-blocks), the
  block and rich text schemas. Both are public and install without a token.

> **Status:** beta, under active development. The first beta was `1.0.0-beta.34` (codename
> swift); until 1.0.0 the image and the npm packages are published with the tag `beta`.

## Highlights

- One instance per site: its own database, domain, storage and accounts; no multi-tenancy.
- Two presets, corporate and blog, on a single codebase; optional modules can be switched on or off.
- Structured content plus pages assembled from 13 standard blocks.
- Multilingual content (BCP 47 locales, RTL support); admin UI in English and Chinese.
- Local storage by default, with optional Cloudflare R2 mirroring and delivery.
- SvelteKit + Node.js + PostgreSQL, shipped as a container with docker compose. No Redis.

## Quick start

Needs Docker with the compose plugin. In an empty folder, fetch the compose file and the settings:

```bash
curl -fsSLO https://raw.githubusercontent.com/bluepax/bluepax-cms/main/deploy/docker-compose.yml
curl -fsSL -o .env https://raw.githubusercontent.com/bluepax/bluepax-cms/main/deploy/.env.example
```

Fill in `ORIGIN` (the CMS's public URL, `http://localhost:3001` for a local try) and the four secrets
in `.env`, each with the command that generates it. Then start the instance with one command:

```bash
docker compose up -d
```

Open `ORIGIN` and finish the setup wizard with `BLUEPAX_INSTALL_TOKEN`. Gateways (HTTPS), upgrades,
backups and every setting are described in the [deployment guide](deploy/README.md).

## Frontend integration

Frontends install the typed SDK `@bluepax/cms-client` from npmjs (it brings the block schema
package `@bluepax/cms-blocks` along), or generate a client from the OpenAPI document. No token or
`.npmrc` is needed. Install the version of the CMS you run; until 1.0.0, `@beta` is the newest beta:

```bash
pnpm add @bluepax/cms-client@beta
```

See the [SDK's README](packages/cms-client/README.md), the
[minimal SvelteKit frontend](examples/minimal-site/README.md) that only uses it, and chapter 6 of
the [specification](docs/spec/README.md).

## Documentation

- [Specification](docs/spec/README.md) (Chinese): the single source of truth for the implementation.
- [Architecture decisions](docs/adr/README.md) (Chinese): how the implementation interprets the specification.
- [Contributing](CONTRIBUTING.md): development setup, branches and commit rules.
- [Security policy](SECURITY.md)

## License

[MIT](LICENSE)
