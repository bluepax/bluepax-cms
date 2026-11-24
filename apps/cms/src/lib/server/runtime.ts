// Process startup, see docs/spec/README.md chapter 9 ("启动顺序"): take the advisory
// lock, apply pending migrations, release the lock, then start the configured roles.
// Any failure throws, so the process exits instead of serving traffic.
import { resolve } from 'node:path';
import {
  createDatabase,
  createPool,
  migrationSets,
  runMigrations,
  type Database,
  type Pool,
} from '@bluepax/db';
import {
  APP_SECRET,
  BLUEPAX_MIGRATIONS_DIR,
  BLUEPAX_ROLES,
  DATABASE_URL,
  ENCRYPTION_KEY,
} from '$app/env/private';
import { log } from './log.ts';
import { migrationSetNames } from './modules.ts';
import type { Role } from './roles.ts';
import { deriveKey, parseEncryptionKey } from './security/crypto.ts';

let pool: Pool | undefined;
let database: Database | undefined;

export function getPool(): Pool {
  if (!DATABASE_URL) throw new Error('DATABASE_URL is not set');
  pool ??= createPool(DATABASE_URL);
  return pool;
}

export function getDatabase(): Database {
  database ??= createDatabase(getPool());
  return database;
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

export async function startup(): Promise<void> {
  // Fail before serving when a required secret is missing.
  signingKey('startup-check');
  encryptionKey();
  const root = BLUEPAX_MIGRATIONS_DIR ?? resolve('../../packages/db/migrations');
  const applied = await runMigrations(getPool(), migrationSets(root, migrationSetNames()));
  // TODO(M2): take a full database backup in `beforeMigrate` once backups exist.
  if (applied.length > 0) log('info', 'migrations applied', { sets: applied });
  log('info', 'started', { roles: [...BLUEPAX_ROLES], build: __BLUEPAX_BUILD_INFO__ });
}
