// Development only (docs/spec/README.md chapter 2): initialises the local database from the
// fictional example config and adds a fictional admin. It is not part of the image and never
// runs in a production deployment.
//   pnpm --filter @bluepax/cms seed:dev
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createDatabase, createPool, migrationSets, runMigrations } from '@bluepax/db';
import { parseConfigYaml } from '@bluepax/presets';
import {
  createInitialAdmin,
  initializeInstance,
  instanceState,
} from '../src/lib/server/instance.ts';
import { migrationSetNames, registry } from '../src/lib/server/modules.ts';

const { DATABASE_URL, DEV_ADMIN_EMAIL, DEV_ADMIN_PASSWORD } = process.env;
if (!DATABASE_URL || !DEV_ADMIN_EMAIL || !DEV_ADMIN_PASSWORD) {
  console.error('set DATABASE_URL, DEV_ADMIN_EMAIL and DEV_ADMIN_PASSWORD (see .env.example)');
  process.exit(1);
}
const configFile = resolve(process.argv[2] ?? '../../examples/config/corporate.yaml');

const pool = createPool(DATABASE_URL, 2);
try {
  await runMigrations(
    pool,
    migrationSets(resolve('../../packages/db/migrations'), migrationSetNames()),
  );
  const db = createDatabase(pool);
  const admin = {
    email: DEV_ADMIN_EMAIL,
    displayName: 'Dev Admin',
    password: DEV_ADMIN_PASSWORD,
    locale: 'zh' as const,
  };
  const state = await instanceState(db);
  if (!state.initialized) {
    const config = parseConfigYaml(await readFile(configFile, 'utf8'));
    await initializeInstance(db, config, { registry, source: 'config-file', admin });
    console.log(`initialised from ${configFile} with admin ${DEV_ADMIN_EMAIL}`);
  } else if (!state.hasAdmin) {
    await createInitialAdmin(db, admin);
    console.log(`created admin ${DEV_ADMIN_EMAIL}`);
  } else {
    console.log('already initialised with an admin');
  }
} finally {
  await pool.end();
}
