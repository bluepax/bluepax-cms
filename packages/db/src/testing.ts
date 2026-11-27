// Test helpers: every test suite gets its own empty database next to TEST_DATABASE_URL,
// so suites running in parallel never see each other's tables, and overlapping queries on one
// client fail the test that sends them (see refuseOverlappingQueries).
import pg from 'pg';

/** Drops and recreates `<base database>_<name>` and returns its connection string. */
export async function freshTestDatabase(baseUrl: string, name: string): Promise<string> {
  if (!/^[a-z][a-z0-9_]*$/.test(name)) throw new Error(`invalid test database name "${name}"`);
  refuseOverlappingQueries();
  const url = new URL(baseUrl);
  const database = `${url.pathname.slice(1)}_${name}`;
  const admin = new pg.Client({ connectionString: baseUrl });
  await admin.connect();
  try {
    await admin.query(`drop database if exists "${database}" with (force)`);
    await admin.query(`create database "${database}"`);
  } finally {
    await admin.end();
  }
  url.pathname = `/${database}`;
  return url.toString();
}

const installed = Symbol.for('bluepax.refuseOverlappingQueries');
const refused = Symbol('refused an overlapping query');

/** The parts of pg 8's Client that tell whether it is still busy with a query. */
interface ClientState {
  pipeline?: boolean;
  _activeQuery?: unknown;
  _queryQueue?: unknown[];
  [refused]?: boolean;
}

/**
 * Makes `client.query()` throw while another query is still running or waiting on the same
 * client. A transaction holds one client, so `Promise.all` over queries of a transaction does
 * this; pg 8 queues them and only logs a deprecation warning (once per process, and only from
 * the third overlapping query), pg 9 refuses them. A pool gives every query its own client, so
 * queries on the pool may overlap. Idempotent; patches `pg.Client` for the whole process.
 *
 * Only the first overlapping query is refused: until the client is idle again, the queries that
 * follow (e.g. the transaction's rollback) are queued as usual, so the test fails with the error
 * of the query at fault and the client goes back to the pool clean.
 */
export function refuseOverlappingQueries(): void {
  const proto = pg.Client.prototype as unknown as Record<PropertyKey, unknown>;
  if (proto[installed]) return;
  const query = proto['query'] as (this: ClientState, ...args: unknown[]) => unknown;
  proto['query'] = function (this: ClientState, ...args: unknown[]) {
    const busy = this._activeQuery != null || (this._queryQueue?.length ?? 0) > 0;
    if (!busy) this[refused] = false;
    else if (!this.pipeline && !this[refused]) {
      this[refused] = true;
      const [config] = args;
      const text = typeof config === 'string' ? config : (config as { text?: unknown })?.text;
      // Deep enough to get past drizzle's frames to the code that sent the query.
      const limit = Error.stackTraceLimit;
      Error.stackTraceLimit = 40;
      const error = new Error(
        `overlapping query on one pg client, which pg 9 refuses (await the previous one first): ${String(text)}`,
      );
      Error.stackTraceLimit = limit;
      throw error;
    }
    return query.apply(this, args);
  };
  proto[installed] = true;
}
