import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as core from './schema/core.ts';
import * as media from './schema/media.ts';
import * as pages from './schema/pages.ts';
import * as posts from './schema/posts.ts';
import * as site from './schema/site.ts';

export * from './migrate.ts';
export * as schema from './schema/index.ts';
export type { ContentStatus, SeoFields } from './schema/pages.ts';
export type { PostSource, RichTextJson } from './schema/posts.ts';
export type { AddressLines, Localized } from './schema/site.ts';

export const fullSchema = { ...core, ...site, ...media, ...pages, ...posts };
export type Database = NodePgDatabase<typeof fullSchema>;
/** A database or a transaction on it; functions that write take this so callers can group writes. */
export type Executor = Database | Parameters<Parameters<Database['transaction']>[0]>[0];

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
