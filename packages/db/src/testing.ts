// Test helpers: every test suite gets its own empty database next to TEST_DATABASE_URL,
// so suites running in parallel never see each other's tables.
import pg from 'pg';

/** Drops and recreates `<base database>_<name>` and returns its connection string. */
export async function freshTestDatabase(baseUrl: string, name: string): Promise<string> {
  if (!/^[a-z][a-z0-9_]*$/.test(name)) throw new Error(`invalid test database name "${name}"`);
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
