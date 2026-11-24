# Contributing to BluePax CMS

Thanks for your interest in BluePax CMS. The [specification](docs/spec/README.md) is the
single source of truth: when a change affects behaviour, the specification is updated first,
then the code. Code, comments, commit messages and issues are written in English.

## Development setup

Requirements: Node.js 26 (see `.nvmrc`), pnpm 12 (see `packageManager` in `package.json`)
and Docker.

```bash
pnpm install   # also installs the git hooks
pnpm check     # lint, typecheck and unit tests
```

Git hooks (installed by `pnpm install`):

- `commit-msg` checks the commit message with commitlint.
- `pre-push` runs lint, typecheck and unit tests.

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

## Commit messages

```
<type>[(scope)][!]: <description> [#issue]

[optional body]

Signed-off-by: Your Name <you@example.com>
```

- Types: `feat`, `fix`, `perf`, `refactor`, `docs`, `test`, `build`, `ci`, `revert`, `chore`.
- Scope is a module ID or a package name, for example `feat(storage): add R2 backfill #42`.
- The description is an imperative sentence in English, lowercase, without a trailing period.
- `!` or a `BREAKING CHANGE:` footer marks a breaking change.

Every commit in a pull request is checked by commitlint in CI.

## Developer Certificate of Origin

By contributing you certify the [Developer Certificate of Origin](https://developercertificate.org/).
Sign off every commit with `git commit -s`; commits without a `Signed-off-by` line fail the check.

## Code of conduct

This project follows the [Contributor Covenant](CODE_OF_CONDUCT.md).
