import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { migrationSets, pendingMigrations, runMigrations } from './migrate.ts';

// Integration test: needs an empty PostgreSQL database in TEST_DATABASE_URL.
const url = process.env.TEST_DATABASE_URL;
const root = fileURLToPath(new URL('../migrations', import.meta.url));

describe.skipIf(!url)('runMigrations', () => {
  const pools: pg.Pool[] = [];
  const pool = (): pg.Pool => {
    const p = new pg.Pool({ connectionString: url, max: 2 });
    pools.push(p);
    return p;
  };

  beforeAll(async () => {
    await pool().query(
      'drop schema if exists drizzle cascade; drop schema public cascade; create schema public;',
    );
  });

  afterAll(async () => {
    await Promise.all(pools.map((p) => p.end()));
  });

  it('only builds sets that have a journal and always starts with core', () => {
    expect(migrationSets(root, ['pages', 'core']).map((s) => s.name)).toEqual(['core']);
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
    expect(applied[0]).toEqual([{ name: 'core', count: 1 }]);
    expect(beforeMigrate).toHaveBeenCalledTimes(1);

    const p = pool();
    expect(await pendingMigrations(p, sets)).toEqual([{ name: 'core', count: 0 }]);
    const tables = await p.query<{ tablename: string }>(
      "select tablename from pg_tables where schemaname = 'public' order by tablename",
    );
    expect(tables.rows.map((r) => r.tablename)).toEqual(['instance_modules', 'settings']);
  });

  it('does nothing when the database is up to date', async () => {
    const beforeMigrate = vi.fn(async () => {});
    expect(await runMigrations(pool(), migrationSets(root, []), { beforeMigrate })).toEqual([]);
    expect(beforeMigrate).not.toHaveBeenCalled();
  });
});
