// Starts the built CMS (apps/cms/build, run `pnpm build` first) for the end-to-end tests: an
// empty database `<TEST_DATABASE_URL's database>_e2e`, temporary upload and backup folders and
// throw-away secrets, so every run begins at the setup wizard (chapter 12, docs/adr/0016).
//   TEST_DATABASE_URL=postgres://… node e2e/serve.ts
import { randomBytes } from 'node:crypto';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { freshTestDatabase } from '../packages/db/src/testing.ts';
import { E2E } from './config.ts';

const base = process.env.TEST_DATABASE_URL;
if (!base) {
  console.error(
    'e2e/serve.ts needs TEST_DATABASE_URL, e.g. postgres://bluepax:bluepax@127.0.0.1:5432/bluepax_test',
  );
  process.exit(1);
}

const temp = await mkdtemp(join(tmpdir(), 'bluepax-e2e-'));
Object.assign(process.env, {
  NODE_ENV: 'production',
  DATABASE_URL: await freshTestDatabase(base, 'e2e'),
  APP_SECRET: randomBytes(48).toString('base64'),
  ENCRYPTION_KEY: randomBytes(32).toString('base64'),
  BLUEPAX_INSTALL_TOKEN: E2E.installToken,
  BLUEPAX_UPLOADS_DIR: join(temp, 'uploads'),
  BLUEPAX_BACKUPS_DIR: join(temp, 'backups'),
  BLUEPAX_MIGRATIONS_DIR: resolve('packages/db/migrations'),
  // As in deploy/docker-compose.yml: above the largest upload limit.
  BODY_SIZE_LIMIT: '256M',
  HOST: '127.0.0.1',
  PORT: String(E2E.cmsPort),
  ORIGIN: E2E.cms,
});

// A variable keeps TypeScript from resolving the build output, which does not exist before
// `pnpm build`.
const server = '../apps/cms/build/index.js';
await import(server);
