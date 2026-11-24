import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as core from './schema/core.ts';

export * from './migrate.ts';
export * as schema from './schema/core.ts';

export const fullSchema = { ...core };
export type Database = NodePgDatabase<typeof fullSchema>;

export type Pool = pg.Pool;

export function createPool(connectionString: string, max = 10): Pool {
  return new pg.Pool({ connectionString, max });
}

export function createDatabase(pool: pg.Pool): Database {
  return drizzle({ client: pool, schema: fullSchema });
}

/** Returns true when the database answers a trivial query. */
export async function ping(pool: pg.Pool): Promise<boolean> {
  try {
    await pool.query('select 1');
    return true;
  } catch {
    return false;
  }
}
