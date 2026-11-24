// Development only (docs/spec/README.md chapter 2): loads fictional data into the local
// database. It is not part of the image and never runs in a production deployment.
//   pnpm --filter @bluepax/cms seed:dev
import { resolve } from 'node:path';
import { createDatabase, createPool, migrationSets, runMigrations } from '@bluepax/db';
import { enabledModules, migrationSetNames, registry } from '../src/lib/server/modules.ts';
import {
  AccountError,
  createUser,
  listRoles,
  seedDefaultRoles,
} from '../src/lib/server/modules/users/accounts.ts';

const { DATABASE_URL, DEV_ADMIN_EMAIL, DEV_ADMIN_PASSWORD } = process.env;
if (!DATABASE_URL || !DEV_ADMIN_EMAIL || !DEV_ADMIN_PASSWORD) {
  console.error('set DATABASE_URL, DEV_ADMIN_EMAIL and DEV_ADMIN_PASSWORD (see .env.example)');
  process.exit(1);
}

const pool = createPool(DATABASE_URL, 2);
try {
  await runMigrations(
    pool,
    migrationSets(resolve('../../packages/db/migrations'), migrationSetNames()),
  );
  const db = createDatabase(pool);
  await seedDefaultRoles(db, registry.editorPermissions(enabledModules()));
  const admin = (await listRoles(db)).find((r) => r.key === 'admin')!;
  try {
    await createUser(db, {
      email: DEV_ADMIN_EMAIL,
      displayName: 'Dev Admin',
      password: DEV_ADMIN_PASSWORD,
      roleId: admin.id,
      locale: 'zh',
    });
    console.log(`created ${DEV_ADMIN_EMAIL}`);
  } catch (error) {
    if (!(error instanceof AccountError && error.code === 'email_taken')) throw error;
    console.log(`${DEV_ADMIN_EMAIL} already exists`);
  }
} finally {
  await pool.end();
}
