// Startup migrations, see docs/spec/README.md chapter 9 ("启动顺序").
// Each module keeps its own migrations folder and its own migrations table; the
// infrastructure tables live in the `core` set, which always runs first.
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { drizzle } from 'drizzle-orm/node-postgres';
import { readMigrationFiles } from 'drizzle-orm/migrator';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import type { Pool, PoolClient } from 'pg';

export interface MigrationSet {
  /** `core` or a module ID. */
  name: string;
  /** Folder produced by drizzle-kit (SQL files plus `meta/_journal.json`). */
  folder: string;
}

export interface PendingMigrations {
  name: string;
  count: number;
}

const MIGRATIONS_SCHEMA = 'drizzle';
/** Fixed key so only one process migrates at a time ("bluepax" in ASCII). */
const ADVISORY_LOCK_KEY = '0x626c7565706178';

/** Builds the migration sets for `core` followed by the given names, skipping empty ones. */
export function migrationSets(root: string, names: readonly string[]): MigrationSet[] {
  return ['core', ...names.filter((n) => n !== 'core')]
    .map((name) => ({ name, folder: join(root, name) }))
    .filter((set) => existsSync(join(set.folder, 'meta', '_journal.json')));
}

function tableFor(set: MigrationSet): string {
  if (!/^[a-z][a-z0-9_]*$/.test(set.name)) throw new Error(`invalid migration set "${set.name}"`);
  return `__migrations_${set.name}`;
}

async function pendingFor(client: PoolClient, set: MigrationSet): Promise<number> {
  const files = readMigrationFiles({ migrationsFolder: set.folder });
  const table = tableFor(set);
  const exists = await client.query<{ exists: boolean }>(
    'select to_regclass($1) is not null as exists',
    [`${MIGRATIONS_SCHEMA}.${table}`],
  );
  if (!exists.rows[0]?.exists) return files.length;
  // Same rule as the drizzle migrator: apply files newer than the last applied one.
  const last = await client.query<{ created_at: string }>(
    `select created_at from "${MIGRATIONS_SCHEMA}"."${table}" order by created_at desc limit 1`,
  );
  const lastAt = last.rows[0] ? Number(last.rows[0].created_at) : -1;
  return files.filter((f) => f.folderMillis > lastAt).length;
}

/** True when none of the sets has its migrations table yet. */
async function isFresh(client: PoolClient, sets: readonly MigrationSet[]): Promise<boolean> {
  const names = sets.map((set) => `${MIGRATIONS_SCHEMA}.${tableFor(set)}`);
  const result = await client.query<{ fresh: boolean }>(
    'select bool_and(to_regclass(name) is null) as fresh from unnest($1::text[]) as name',
    [names],
  );
  return result.rows[0]?.fresh ?? true;
}

async function withLock<T>(pool: Pool, fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('select pg_advisory_lock($1::bigint)', [ADVISORY_LOCK_KEY]);
    try {
      return await fn(client);
    } finally {
      await client.query('select pg_advisory_unlock($1::bigint)', [ADVISORY_LOCK_KEY]);
    }
  } finally {
    client.release();
  }
}

export async function pendingMigrations(
  pool: Pool,
  sets: readonly MigrationSet[],
): Promise<PendingMigrations[]> {
  const client = await pool.connect();
  try {
    const result: PendingMigrations[] = [];
    for (const set of sets) result.push({ name: set.name, count: await pendingFor(client, set) });
    return result;
  } finally {
    client.release();
  }
}

export interface BeforeMigrateContext {
  /**
   * True when no migration set was ever applied: the database is new and holds nothing a
   * backup could protect (the first start of an instance).
   */
  fresh: boolean;
}

export interface RunMigrationsOptions {
  /**
   * Called while holding the lock, only when there is something to apply.
   * Used to take a full database backup before migrating; a throw stops the migration.
   */
  beforeMigrate?: (pending: PendingMigrations[], context: BeforeMigrateContext) => Promise<void>;
  /**
   * Called while still holding the lock once the database is up to date, also when nothing was
   * pending. Used to install or upgrade the job queue's own schema after the migrations, so it
   * never runs against tables a pending migration is about to change (docs/adr/0019).
   */
  afterMigrate?: () => Promise<void>;
}

/**
 * Takes the advisory lock, applies every pending migration set in order and
 * returns what was pending. Migrations only move forward.
 */
export async function runMigrations(
  pool: Pool,
  sets: readonly MigrationSet[],
  options: RunMigrationsOptions = {},
): Promise<PendingMigrations[]> {
  return withLock(pool, async (client) => {
    const pending: PendingMigrations[] = [];
    for (const set of sets) {
      const count = await pendingFor(client, set);
      if (count > 0) pending.push({ name: set.name, count });
    }
    if (pending.length > 0) await apply(client, sets, pending, options);
    await options.afterMigrate?.();
    return pending;
  });
}

async function apply(
  client: PoolClient,
  sets: readonly MigrationSet[],
  pending: PendingMigrations[],
  options: RunMigrationsOptions,
): Promise<void> {
  await options.beforeMigrate?.(pending, { fresh: await isFresh(client, sets) });
  const db = drizzle({ client });
  for (const set of sets) {
    if (!pending.some((p) => p.name === set.name)) continue;
    await migrate(db, {
      migrationsFolder: set.folder,
      migrationsSchema: MIGRATIONS_SCHEMA,
      migrationsTable: tableFor(set),
    });
  }
}
