// Process startup, see docs/spec/README.md chapter 9 ("启动顺序") and docs/adr/0015: take
// the advisory lock, back up the database when migrations are pending, apply them, release
// the lock, then start the configured roles. Any failure throws, so the process exits
// before adapter-node listens and never serves traffic.
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  createDatabase,
  createPool,
  migrationSets,
  runMigrations,
  type Database,
  type Pool,
} from '@bluepax/db';
import { parseConfigYaml } from '@bluepax/presets';
import { dev } from '$app/env';
import { createLocalDriver, DEFAULT_LOCAL_ROOT, type StorageDriver } from '@bluepax/storage';
import {
  APP_SECRET,
  BLUEPAX_BACKUPS_DIR,
  BLUEPAX_CONFIG_FILE,
  BLUEPAX_MIGRATIONS_DIR,
  BLUEPAX_ROLES,
  BLUEPAX_UPLOADS_DIR,
  BODY_SIZE_LIMIT,
  DATABASE_URL,
  ENCRYPTION_KEY,
  ORIGIN,
} from '$app/env/private';
import { backupBeforeMigrate, DEFAULT_BACKUPS_DIR, finishPendingUpgrade } from './backups.ts';
import { parseBodySizeLimit } from './http.ts';
import { initializeInstance, instanceState } from './instance.ts';
import { log } from './log.ts';
import { migrationSetNames, registry } from './modules.ts';
import { UPLOADS_PATH } from './modules/media/files.ts';
import type { Role } from './roles.ts';
import { deriveKey, parseEncryptionKey } from './security/crypto.ts';

let pool: Pool | undefined;
let database: Database | undefined;
let storage: StorageDriver | undefined;
/** Becomes true once the instance is initialised and has an admin; it never turns back. */
let ready = false;

export function getPool(): Pool {
  if (!DATABASE_URL) throw new Error('DATABASE_URL is not set');
  pool ??= createPool(DATABASE_URL);
  return pool;
}

export function getDatabase(): Database {
  database ??= createDatabase(getPool());
  return database;
}

/** Local media storage (chapter 5); the primary copy of every media file. */
export function getStorage(): StorageDriver {
  storage ??= createLocalDriver({
    root: BLUEPAX_UPLOADS_DIR ?? DEFAULT_LOCAL_ROOT,
    publicBaseUrl: UPLOADS_PATH,
  });
  return storage;
}

export function hasRole(role: Role): boolean {
  return BLUEPAX_ROLES.has(role);
}

/** Key for one kind of signed data, derived from APP_SECRET. */
export function signingKey(purpose: string): Buffer {
  if (!APP_SECRET) throw new Error('APP_SECRET is not set');
  return deriveKey(APP_SECRET, purpose);
}

export function encryptionKey(): Buffer {
  if (!ENCRYPTION_KEY) throw new Error('ENCRYPTION_KEY is not set');
  return parseEncryptionKey(ENCRYPTION_KEY);
}

/** True when the setup wizard is done: the instance is initialised and has an admin. */
export async function isReady(): Promise<boolean> {
  if (ready) return true;
  const state = await instanceState(getDatabase());
  ready = state.initialized && state.hasAdmin;
  return ready;
}

/** Initialises an empty instance from BLUEPAX_CONFIG_FILE; import only happens once. */
async function initializeFromConfigFile(): Promise<void> {
  if (!BLUEPAX_CONFIG_FILE) return;
  const db = getDatabase();
  if ((await instanceState(db)).initialized) {
    log('info', 'instance already initialised, config file ignored', { file: BLUEPAX_CONFIG_FILE });
    return;
  }
  const config = parseConfigYaml(await readFile(BLUEPAX_CONFIG_FILE, 'utf8'));
  await initializeInstance(db, config, { registry, source: 'config-file' });
  log('info', 'instance initialised from config file', {
    file: BLUEPAX_CONFIG_FILE,
    type: config.site.type,
  });
}

/** Smallest BODY_SIZE_LIMIT that fits the default video upload limit (chapter 13). */
const MIN_BODY_SIZE_LIMIT = 200 * 1024 * 1024;

/** Settings adapter-node reads itself and a production instance cannot do without. */
function checkDeployment(): void {
  if (dev) return;
  if (!ORIGIN) {
    // Without it adapter-node trusts the Host header: media URLs in the Delivery API would
    // point at whatever host a request names (docs/adr/0012, 0015).
    throw new Error(
      'ORIGIN is not set: set it to the public URL of the CMS, e.g. https://cms.example.com',
    );
  }
  const limit = parseBodySizeLimit(BODY_SIZE_LIMIT);
  if (!(limit >= MIN_BODY_SIZE_LIMIT)) {
    log('warn', 'BODY_SIZE_LIMIT is below 200 MB: larger media uploads will fail', {
      BODY_SIZE_LIMIT: BODY_SIZE_LIMIT ?? '512K (adapter-node default)',
    });
  }
}

/** Where pre-migration backups go; `vite dev` only backs up when the folder is set. */
function backupsDir(): string | undefined {
  return BLUEPAX_BACKUPS_DIR ?? (dev ? undefined : DEFAULT_BACKUPS_DIR);
}

async function migrate(): Promise<void> {
  const root = BLUEPAX_MIGRATIONS_DIR ?? resolve('../../packages/db/migrations');
  const dir = backupsDir();
  const applied = await runMigrations(getPool(), migrationSets(root, migrationSetNames()), {
    beforeMigrate: async (pending, { fresh }) => {
      if (!dir) {
        log('warn', 'migrating without a backup: BLUEPAX_BACKUPS_DIR is not set', { pending });
        return;
      }
      log('info', 'migrations pending, backing up the database first', { pending });
      const backup = await backupBeforeMigrate({
        dir,
        databaseUrl: DATABASE_URL ?? '',
        pending,
        fresh,
      });
      log('info', `backup before migrating: ${backup.action}`, { ...backup });
    },
  });
  if (applied.length > 0) log('info', 'migrations applied', { sets: applied });
}

export async function startup(): Promise<void> {
  try {
    checkDeployment();
    // Fail before serving when a required secret is missing.
    signingKey('startup-check');
    encryptionKey();
    await migrate();
    await initializeFromConfigFile();
    const dir = backupsDir();
    if (dir) await finishPendingUpgrade(dir);
  } catch (error) {
    // Drizzle wraps the database's own message (e.g. a failed migration) in `cause`.
    const cause = error instanceof Error && error.cause instanceof Error ? error.cause.message : '';
    log('error', 'startup failed, not serving', {
      error: error instanceof Error ? error.message : String(error),
      ...(cause ? { cause } : {}),
    });
    throw error;
  }
  // The worker role has no jobs yet: packages/jobs and pg-boss come with the first one (M2).
  log('info', 'started', { roles: [...BLUEPAX_ROLES], build: __BLUEPAX_BUILD_INFO__ });
}
