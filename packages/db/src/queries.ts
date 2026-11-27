import { is } from 'drizzle-orm';
import { PgTransaction } from 'drizzle-orm/pg-core';
import type { Executor } from './index.ts';

/**
 * `Promise.all` for independent reads on a database or a transaction: side by side on the
 * database, whose pool gives every query its own client, but one after another in a
 * transaction, which holds a single client. pg 8 queues overlapping queries on one client and
 * warns that this is deprecated; pg 9 refuses them.
 *
 * Takes functions rather than queries, because a drizzle query only starts when awaited.
 */
export async function allQueries<const T extends readonly unknown[]>(
  db: Executor,
  queries: { readonly [K in keyof T]: () => PromiseLike<T[K]> },
): Promise<T> {
  if (!is(db, PgTransaction)) return (await Promise.all(queries.map((q) => q()))) as unknown as T;
  const results: unknown[] = [];
  for (const query of queries) results.push(await query());
  return results as unknown as T;
}
