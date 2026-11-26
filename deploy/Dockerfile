# syntax=docker/dockerfile:1
# BluePax CMS image (ghcr.io/bluepax/bluepax-cms), see docs/spec/README.md chapters 9–11 and
# docs/adr/0015. Build from the repository root:
#   docker build -f deploy/Dockerfile -t bluepax-cms:local \
#     --build-arg BLUEPAX_BUILD="$(git rev-list --count --first-parent HEAD)" \
#     --build-arg BLUEPAX_COMMIT="$(git rev-parse HEAD)" .
# The release and edge workflows also pass BLUEPAX_VERSION and BLUEPAX_BUILT_AT.

# The Node.js image is named in each FROM line so that Dependabot can update it; pnpm matches
# packageManager in package.json.
ARG PNPM_VERSION=12.23.0

# ---- build: the app is plain JavaScript once built, so it is built once, on the build machine's
# own platform, also for multi-platform images.
FROM --platform=$BUILDPLATFORM node:26-alpine3.24 AS build
ARG PNPM_VERSION
ENV HUSKY=0
RUN npm install --global --no-audit --no-fund pnpm@${PNPM_VERSION}
WORKDIR /src
COPY . .
# Online install: pnpm checks the lockfile against its supply-chain policy (minimumReleaseAge,
# docs/adr/0004) with the registry's metadata.
RUN --mount=type=cache,id=bluepax-pnpm,target=/pnpm,sharing=locked \
    pnpm install --frozen-lockfile --store-dir /pnpm/store --cache-dir /pnpm/cache
# Build information (chapter 11): shown on the admin's About page and by GET /api/health.
ARG BLUEPAX_VERSION BLUEPAX_BUILD BLUEPAX_COMMIT BLUEPAX_BUILT_AT
RUN pnpm --filter @bluepax/cms build

# ---- deps: production dependencies only (chapter 10), installed for the target platform: sharp
# and argon2 ship prebuilt native binaries per platform and C library.
FROM node:26-alpine3.24 AS deps
ARG PNPM_VERSION
ENV HUSKY=0
RUN npm install --global --no-audit --no-fund pnpm@${PNPM_VERSION}
WORKDIR /src
COPY . .
RUN --mount=type=cache,id=bluepax-pnpm,target=/pnpm,sharing=locked \
    pnpm --filter @bluepax/cms deploy --prod --store-dir /pnpm/store --cache-dir /pnpm/cache /app
RUN node scripts/third-party-notices.ts /app /app/THIRD_PARTY_NOTICES.md

# ---- runtime
FROM node:26-alpine3.24
# pg_dump for the backup before migrations: the PostgreSQL 18 client dumps servers 16–18
# (pg_dump must not be older than the server). tini reaps pg_dump and forwards signals.
RUN apk add --no-cache postgresql18-client tini
WORKDIR /app
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3001 \
    BODY_SIZE_LIMIT=256M \
    BLUEPAX_UPLOADS_DIR=/data/uploads \
    BLUEPAX_BACKUPS_DIR=/data/backups \
    BLUEPAX_MIGRATIONS_DIR=/app/migrations
COPY --from=deps /app/package.json /app/THIRD_PARTY_NOTICES.md ./
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /src/apps/cms/build ./build
COPY --from=build /src/packages/db/migrations ./migrations
COPY LICENSE ./
COPY deploy/licenses ./licenses
# The uploads and backups volumes take this ownership when they are first mounted.
RUN mkdir -p /data/uploads /data/backups && chown node:node /data/uploads /data/backups
USER node
EXPOSE 3001
# Startup backs up and migrates before it listens, which can take a while on a large database.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10m --start-interval=5s --retries=3 \
    CMD ["node", "-e", "fetch(`http://127.0.0.1:${process.env.PORT}/api/health`).then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
LABEL org.opencontainers.image.title="BluePax CMS" \
      org.opencontainers.image.description="Open-source headless CMS for corporate websites and blogs" \
      org.opencontainers.image.source="https://github.com/bluepax/bluepax-cms" \
      org.opencontainers.image.licenses="MIT"
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "build/index.js"]
