// Process startup, see docs/spec/README.md chapter 9 ("启动顺序"): take the advisory
// lock, apply pending migrations, release the lock, then start the configured roles.
// Any failure throws, so the process exits instead of serving traffic.
import { resolve } from 'node:path';
import { createPool, migrationSets, runMigrations, type Pool } from '@bluepax/db';
import { BLUEPAX_MIGRATIONS_DIR, BLUEPAX_ROLES, DATABASE_URL } from '$app/env/private';
import { log } from './log.ts';
import { migrationSetNames } from './modules.ts';
import type { Role } from './roles.ts';

let pool: Pool | undefined;

export function getPool(): Pool {
  if (!DATABASE_URL) throw new Error('DATABASE_URL is not set');
  pool ??= createPool(DATABASE_URL);
  return pool;
}

export function hasRole(role: Role): boolean {
  return BLUEPAX_ROLES.has(role);
}

export async function startup(): Promise<void> {
  const root = BLUEPAX_MIGRATIONS_DIR ?? resolve('../../packages/db/migrations');
  const applied = await runMigrations(getPool(), migrationSets(root, migrationSetNames()));
  // TODO(M2): take a full database backup in `beforeMigrate` once backups exist.
  if (applied.length > 0) log('info', 'migrations applied', { sets: applied });
  log('info', 'started', { roles: [...BLUEPAX_ROLES], build: __BLUEPAX_BUILD_INFO__ });
}
