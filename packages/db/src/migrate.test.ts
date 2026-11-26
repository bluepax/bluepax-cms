import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { migrationSets, pendingMigrations, runMigrations } from './migrate.ts';
import { freshTestDatabase } from './testing.ts';

// Integration test: needs a PostgreSQL server; TEST_DATABASE_URL names a database it may create others next to.
const baseUrl = process.env.TEST_DATABASE_URL;
const root = fileURLToPath(new URL('../migrations', import.meta.url));

describe.skipIf(!baseUrl)('runMigrations', () => {
  let url: string;
  const pools: pg.Pool[] = [];
  const pool = (): pg.Pool => {
    const p = new pg.Pool({ connectionString: url, max: 2 });
    pools.push(p);
    return p;
  };

  beforeAll(async () => {
    url = await freshTestDatabase(baseUrl!, 'migrate');
  });

  afterAll(async () => {
    await Promise.all(pools.map((p) => p.end()));
  });

  it('only builds sets that have a journal and always starts with core', () => {
    // `catalog` has no migrations yet (it is built in M4); `pages` has.
    expect(migrationSets(root, ['catalog', 'core']).map((s) => s.name)).toEqual(['core']);
    expect(migrationSets(root, ['pages', 'core']).map((s) => s.name)).toEqual(['core', 'pages']);
  });

  it('applies pending migrations once, even when two processes start together', async () => {
    const sets = migrationSets(root, []);
    const beforeMigrate = vi.fn(async () => {});

    const [a, b] = await Promise.all([
      runMigrations(pool(), sets, { beforeMigrate }),
      runMigrations(pool(), sets, { beforeMigrate }),
    ]);

    const applied = [a, b].filter((r) => r.length > 0);
    expect(applied).toHaveLength(1);
    expect(applied[0]).toEqual([{ name: 'core', count: 2 }]);
    expect(beforeMigrate).toHaveBeenCalledTimes(1);
    // Nothing was applied before: a new database needs no backup.
    expect(beforeMigrate).toHaveBeenCalledWith([{ name: 'core', count: 2 }], { fresh: true });

    const p = pool();
    expect(await pendingMigrations(p, sets)).toEqual([{ name: 'core', count: 0 }]);
    const tables = await p.query<{ tablename: string }>(
      "select tablename from pg_tables where schemaname = 'public' order by tablename",
    );
    expect(tables.rows.map((r) => r.tablename)).toEqual([
      'audit_log',
      'instance_modules',
      'role_permissions',
      'roles',
      'sessions',
      'settings',
      'users',
    ]);
  });

  it('tells the backup that a database with applied migrations is not fresh', async () => {
    // `media` comes right after `core` and only depends on it.
    const beforeMigrate = vi.fn(async () => {});
    const applied = await runMigrations(pool(), migrationSets(root, ['media']), { beforeMigrate });
    expect(applied.map((p) => p.name)).toEqual(['media']);
    expect(beforeMigrate).toHaveBeenCalledWith(applied, { fresh: false });
  });

  it('stops before migrating when the backup fails', async () => {
    const sets = migrationSets(root, ['media', 'pages']);
    const beforeMigrate = vi.fn(async () => {
      throw new Error('disk full');
    });
    const before = await pendingMigrations(pool(), sets);
    expect(before.find((p) => p.name === 'pages')?.count).toBeGreaterThan(0);
    await expect(runMigrations(pool(), sets, { beforeMigrate })).rejects.toThrow('disk full');
    expect(await pendingMigrations(pool(), sets)).toEqual(before);
  });

  it('does nothing when the database is up to date', async () => {
    const beforeMigrate = vi.fn(async () => {});
    expect(await runMigrations(pool(), migrationSets(root, []), { beforeMigrate })).toEqual([]);
    expect(beforeMigrate).not.toHaveBeenCalled();
  });
});
