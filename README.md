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
