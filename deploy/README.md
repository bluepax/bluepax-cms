# Deploying BluePax CMS

English | [简体中文](README.zh-CN.md)

One instance per site: the `cms` container (admin UI, every API and the background roles in one
Node.js process) and PostgreSQL, run with docker compose. HTTPS ends at a gateway in front of it.
Background and decisions: chapter 9 of the [specification](../docs/spec/README.md) and
[ADR 0015](../docs/adr/0015-image-compose-and-startup.md).

| File                 | Purpose                                                    |
| -------------------- | ---------------------------------------------------------- |
| `docker-compose.yml` | `cms` + `postgres`, volumes `pgdata`, `uploads`, `backups` |
| `.env.example`       | every setting, copy to `.env`                              |
| `gateway/`           | Caddy, OpenResty and Cloudflare Tunnel examples            |
| `Dockerfile`         | the image `ghcr.io/bluepax/bluepax-cms`                    |
| `dev/`               | development database only, not for production              |

## Quick start

Needs Docker with the compose plugin. In an empty folder:

```bash
curl -fsSLO https://raw.githubusercontent.com/bluepax/bluepax-cms/main/deploy/docker-compose.yml
curl -fsSL -o .env https://raw.githubusercontent.com/bluepax/bluepax-cms/main/deploy/.env.example
```

Fill in `.env`: `ORIGIN` (the CMS's public URL; `http://localhost:3001` for a local try) and the
four secrets, each with the `openssl` command written next to it. Then:

```bash
docker compose up -d
```

The first start creates the database and applies every migration; `docker compose ps` shows the
`cms` service as `healthy` once it serves. Open `ORIGIN`, enter `BLUEPAX_INSTALL_TOKEN` in the setup
wizard, choose the corporate or blog preset and create the first administrator.

To initialise an empty instance unattended instead, put an instance config file in `./config/`,
uncomment the `./config:/config:ro` mount in `docker-compose.yml` and set
`BLUEPAX_CONFIG_FILE=/config/<file>.yaml` (examples in `examples/config/`).

## Settings

All settings are environment variables in `.env`; secrets live nowhere else.

| Variable                       | Notes                                                                                                                                                           |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ORIGIN`                       | Required. Public URL of the CMS. Media URLs in the Delivery API start with it and form submissions are checked against it; the CMS refuses to start without it. |
| `POSTGRES_PASSWORD`            | Required. Only used when the `pgdata` volume is created; changing it later does not change the database password.                                               |
| `APP_SECRET`, `ENCRYPTION_KEY` | Required. Keep a copy of `ENCRYPTION_KEY` outside the server: a restored backup needs the same key to read stored credentials.                                  |
| `BLUEPAX_INSTALL_TOKEN`        | Required. Asked for by the setup wizard.                                                                                                                        |
| `BLUEPAX_IMAGE`                | Image and tag. Pin a version in production and change it to upgrade.                                                                                            |
| `BLUEPAX_BIND`, `BLUEPAX_PORT` | Where the CMS listens on the host, `127.0.0.1:3001` by default.                                                                                                 |
| `ADDRESS_HEADER`, `XFF_DEPTH`  | Header with the visitor's IP, set by the gateway (see below).                                                                                                   |
| `BODY_SIZE_LIMIT`              | Largest request body, `256M`. Must exceed the largest upload limit (video 200 MB by default); other requests are held to 10 MB.                                 |
| `BLUEPAX_ROLES`                | `web`, `worker` or both (default). M1 has no background jobs yet.                                                                                               |
| `BLUEPAX_CONFIG_FILE`          | Optional instance config file for an unattended first start.                                                                                                    |

Volumes: `pgdata` (database), `uploads` (local media storage, `/data/uploads`) and `backups`
(`/data/backups`). Media files are not in the database backups: back up the `uploads` volume
yourself, or add R2 mirroring once it is available.

## Gateway

The CMS listens on `127.0.0.1` only; a gateway on the same host terminates HTTPS and forwards to
it. Examples:

- [`gateway/Caddyfile`](gateway/Caddyfile): automatic certificates. `.env`:
  `ADDRESS_HEADER=X-Forwarded-For`, `XFF_DEPTH=1`.
- [`gateway/openresty.conf`](gateway/openresty.conf): OpenResty or nginx. Same `.env` values;
  raise `client_max_body_size` (1 MB by default).
- [`gateway/cloudflared.yml`](gateway/cloudflared.yml): Cloudflare Tunnel, no open ports.
  `.env`: `ADDRESS_HEADER=CF-Connecting-IP`. Cloudflare caps request bodies by plan (100 MB on
  Free and Pro).

Both proxy examples overwrite `X-Forwarded-For` with the one address the gateway sees, so the CMS
trusts exactly one proxy. Behind Cloudflare's proxy, the gateway takes the visitor from
`CF-Connecting-IP` for Cloudflare's address ranges only (commented in the examples).

The CMS answers `X-Robots-Tag: noindex` on every response and serves a `robots.txt` that disallows
everything; do not block AI crawlers at the gateway. The admin UI may sit behind Cloudflare Access
or an IP allow list, but `/api/*` and `/uploads/*` must stay reachable for frontends.

## Startup, upgrades and backups

On every start, before it listens, the CMS:

1. takes a PostgreSQL advisory lock (several containers starting together migrate once);
2. checks for pending migrations and, if there are any, writes a full backup
   `/data/backups/pre-migrate-<UTC time>.dump` (`pg_dump` custom format; skipped for a new, empty
   database);
3. applies the migrations, releases the lock and starts.

If any step fails, the container exits and never serves: `docker compose ps` shows it restarting
and unhealthy, and `docker compose logs cms` ends with `startup failed, not serving`. While an
upgrade keeps failing, every restart reuses the backup of the first attempt instead of taking a
new one; the next successful start ends that.

To upgrade, change `BLUEPAX_IMAGE` and run `docker compose up -d`. Migrations only move forward:
going back to an older version means restoring the backup taken before the upgrade.

List the backups:

```bash
docker compose run --rm --no-deps --entrypoint ls cms -l /data/backups
```

Restore one (replaces the whole database) and go back to the previous image:

```bash
docker compose stop cms
docker compose exec postgres dropdb -U bluepax bluepax
docker compose exec postgres createdb -U bluepax bluepax
docker compose run --rm --no-deps -T --entrypoint cat cms /data/backups/pre-migrate-20261126-225400Z.dump \
  | docker compose exec -T postgres pg_restore -U bluepax -d bluepax
# set BLUEPAX_IMAGE back to the previous version in .env, then
docker compose up -d
```

Pre-migration backups are never deleted automatically; remove old ones by hand. Daily backups
with retention come later (milestone M2).

## Health and version

`GET /api/health` needs no login and returns the status, version, build number, build time and
commit, the same as the admin's About page. The image's health check calls it.

```bash
curl -s http://127.0.0.1:3001/api/health
```

## Building the image

From the repository root:

```bash
docker build -f deploy/Dockerfile -t bluepax-cms:local \
  --build-arg BLUEPAX_BUILD="$(git rev-list --count --first-parent HEAD)" \
  --build-arg BLUEPAX_COMMIT="$(git rev-parse HEAD)" .
```

Then set `BLUEPAX_IMAGE=bluepax-cms:local`. Published images: `X.Y.Z`, `X.Y`, `X` and `latest`
for releases, `X.0.0-beta.N` and `beta` for betas, and `edge` for every merge into dev.
