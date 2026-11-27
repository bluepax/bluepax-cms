import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDatabase, createPool, type Database, type Executor, type Pool } from './index.ts';
import { allQueries } from './queries.ts';
import { freshTestDatabase } from './testing.ts';

// Integration test: needs a PostgreSQL server; TEST_DATABASE_URL names a database it may create others next to.
const baseUrl = process.env.TEST_DATABASE_URL;

/** The server process that answers, after a short pause so that overlapping queries do overlap. */
async function backend(db: Executor, label: string): Promise<{ label: string; pid: number }> {
  const result = await db.execute<{ pid: number }>(
    sql`select pg_backend_pid() as pid from pg_sleep(0.05)`,
  );
  return { label, pid: result.rows[0]!.pid };
}

describe.skipIf(!baseUrl)('allQueries', () => {
  let pool: Pool;
  let db: Database;

  beforeAll(async () => {
    pool = createPool(await freshTestDatabase(baseUrl!, 'queries'), 4);
    db = createDatabase(pool);
  });

  afterAll(async () => {
    await pool?.end();
  });

  it('runs the queries side by side on the pool, each on its own client', async () => {
    const [a, b] = await allQueries(db, [() => backend(db, 'a'), () => backend(db, 'b')]);
    expect([a.label, b.label]).toEqual(['a', 'b']);
    expect(a.pid).not.toBe(b.pid);
  });

  it('runs them one after another in a transaction, in order', async () => {
    const results = await db.transaction((tx) =>
      allQueries(tx, [() => backend(tx, 'a'), () => backend(tx, 'b'), () => backend(tx, 'c')]),
    );
    expect(results.map((r) => r.label)).toEqual(['a', 'b', 'c']);
    expect(new Set(results.map((r) => r.pid)).size).toBe(1);
  });

  it('makes tests fail on overlapping queries in a transaction, as pg 9 will', async () => {
    // Plain Promise.all on the pool is fine: every query gets a client.
    await Promise.all([backend(db, 'a'), backend(db, 'b')]);

    // Two queries, not three: pg 8 would warn about the third one (and the rollback) queuing.
    const failure = await db
      .transaction((tx) => Promise.all([backend(tx, 'a'), backend(tx, 'b')]))
      .then(
        () => null,
        (error: unknown) => error,
      );
    expect(failure).toMatchObject({
      cause: { message: expect.stringContaining('overlapping query on one pg client') },
    });

    // The rollback waited for the queries already sent, so the client went back clean.
    expect(pool.idleCount).toBeGreaterThan(0);
    const again = await db.transaction((tx) =>
      allQueries(tx, [() => backend(tx, 'a'), () => backend(tx, 'b')]),
    );
    expect(again.map((r) => r.label)).toEqual(['a', 'b']);
  });
});
