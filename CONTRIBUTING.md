# Contributing to BluePax CMS

Thanks for your interest in BluePax CMS. The [specification](docs/spec/README.md) is the
single source of truth: when a change affects behaviour, the specification is updated first,
then the code. Code, comments, commit messages and issues are written in English.

Decisions that interpret or deviate from the specification are recorded in
[docs/adr](docs/adr/README.md).

## Repository layout

```
apps/cms/            SvelteKit app: admin UI, all APIs and the startup entry
packages/core/       module manifests and registry, permissions, events (private)
packages/db/         Drizzle schema and migration sets (private)
packages/presets/    corporate and blog presets, instance config format (private)
packages/storage/    storage drivers: local (private)
packages/cms-blocks/ block and rich text schemas, published as @bluepax/cms-blocks
packages/cms-client/ typed Delivery API SDK and the API contract, published as @bluepax/cms-client
examples/config/     fictional instance config files
examples/minimal-site/ minimal SvelteKit frontend that only uses @bluepax/cms-client (private)
deploy/dev/          development database (docker compose)
docs/spec/           the specification
docs/adr/            architecture decision records
scripts/             repository tooling: license gate, release scripts
```

Packages that are not published are marked `"private": true`. Only `@bluepax/cms-client` and
`@bluepax/cms-blocks` are published, to GitHub Packages. In the workspace their `exports` point at
the TypeScript sources; `pnpm build` writes `dist/` and `publishConfig.exports` points the packed
package there (docs/adr/0013). The Delivery API's response schemas live in
`packages/cms-client/src/contract.ts`: the CMS generates its OpenAPI document from them.

## Development setup

Requirements: Node.js 26 (see `.nvmrc`), pnpm 12 (see `packageManager` in `package.json`)
and Docker.

```bash
pnpm install                                     # also installs the git hooks
docker compose -f deploy/dev/compose.yaml up -d  # PostgreSQL for development and tests
cp .env.example .env
pnpm --filter @bluepax/cms seed:dev              # fictional instance + admin from .env.example
pnpm --filter @bluepax/cms dev                   # runs pending migrations on first request
pnpm check                                       # lint, typecheck and unit tests
```

Integration tests run when `TEST_DATABASE_URL` is set and are skipped otherwise; they
wipe that database, so never point it at real data:

```bash
TEST_DATABASE_URL=postgres://bluepax:bluepax@127.0.0.1:5432/bluepax_test pnpm test
```

New migrations are generated per migration set (`core` or a module ID) from
`packages/db/src/schema/<set>.ts`:

```bash
pnpm --filter @bluepax/db generate <set> <label>
```

Git hooks (installed by `pnpm install`):

- `commit-msg` checks the commit message with commitlint.
- `pre-push` runs lint, typecheck, unit tests and the production build (`pnpm build`).

## Branches (BluePax Flow)

| Branch                   | Purpose                                                     |
| ------------------------ | ----------------------------------------------------------- |
| `main`                   | Releases only. Every commit is a release merged from `dev`. |
| `dev`                    | Default branch for development and hotfixes.                |
| `feature/xxx`, `fix/xxx` | Branch off `dev`, named after the main feature or fix.      |

1. Fork the repository and create `feature/xxx` or `fix/xxx` from the latest `dev`.
2. Before opening a pull request, merge the latest `dev` into your branch and make sure CI passes.
3. Open the pull request against `dev`. It is merged with a merge commit; squash and rebase
   merges are disabled, and history is never rewritten.

Hotfixes use `fix/xxx` branches too. The repository owner merges their own branches, hotfixes
included, locally with `git merge --no-ff` and pushes `dev` directly (the owner bypasses the
pull request rule); the `pre-push` hook replaces the CI pre-check, and CI still runs after the
push.

## Commit messages

```
<type>[(scope)][!]: <description> [#issue]

[optional body]

Signed-off-by: Your Name <you@example.com>
```

- Types: `feat`, `fix`, `perf`, `refactor`, `docs`, `test`, `build`, `ci`, `revert`, `chore`.
- Scope is optional. When given, it is a module ID or a package name, for example
  `feat(storage): add R2 backfill #42`. Allowed scopes:
  - core modules: `dashboard`, `site`, `pages`, `posts`, `media`, `seo`, `api`, `users`
  - optional modules: `catalog`, `inquiries`, `regions`, `tracking`, `insights`, `ai`
  - apps and packages: `cms`, `core`, `db`, `jobs`, `presets`, `storage`, `cms-blocks`,
    `cms-client`, `minimal-site`, `deploy`
  - housekeeping: `deps`, `release`
- The description is an imperative sentence in English, lowercase, without a trailing period.
- `!` or a `BREAKING CHANGE:` footer marks a breaking change.

CI checks every commit of a pull request and of every push to `dev` with commitlint, and runs
lint, typecheck, unit and integration tests (against PostgreSQL), the license gate and the
build; CodeQL runs alongside. Commits made by Dependabot are exempt from the commit message rules,
because its subject format cannot be configured.

## Developer Certificate of Origin

By contributing you certify the [Developer Certificate of Origin](https://developercertificate.org/).
Sign off every commit with `git commit -s`; commits without a `Signed-off-by` line fail the check.

## Code of conduct

This project follows the [Contributor Covenant](CODE_OF_CONDUCT.md).
