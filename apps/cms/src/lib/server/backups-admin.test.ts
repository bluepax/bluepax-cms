import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createDatabase,
  createPool,
  migrationSets,
  runMigrations,
  schema,
  type Database,
  type Pool,
} from '@bluepax/db';
import { freshTestDatabase } from '@bluepax/db/testing';
import { Jobs } from '@bluepax/jobs';
import { configFromPreset } from '@bluepax/presets';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  backupOverview,
  deleteBackup,
  readBackupSettings,
  requestBackup,
  syncBackupSchedule,
} from './backups.ts';
import { exportInstanceConfig, initializeInstance } from './instance.ts';
import { migrationSetNames, registry } from './modules.ts';
import { saveBackupSettings } from './modules/site/settings.ts';
import { InvalidInputError } from './modules/site/values.ts';

// Integration test: needs a PostgreSQL server (TEST_DATABASE_URL).
const baseUrl = process.env.TEST_DATABASE_URL;
const migrations = fileURLToPath(new URL('../../../../../packages/db/migrations', import.meta.url));

describe.skipIf(!baseUrl)('backups in the admin', { timeout: 30_000 }, () => {
  let pool: Pool;
  let db: Database;
  let jobs: Jobs;
  let dir: string;
  const actor = { id: '', ip: '127.0.0.1' };

  beforeAll(async () => {
    const url = await freshTestDatabase(baseUrl!, 'cms_backups');
    pool = createPool(url, 4);
    await runMigrations(pool, migrationSets(migrations, migrationSetNames()));
    db = createDatabase(pool);
    jobs = new Jobs({ connectionString: url, worker: false, name: 'web', log: () => {} });
    await jobs.start();
    dir = await mkdtemp(join(tmpdir(), 'bluepax-cms-backups-'));
  });

  afterAll(async () => {
    await jobs.stop(1000);
    await pool.end();
    await rm(dir, { recursive: true, force: true });
  });

  it('schedules nothing before the instance is initialised', async () => {
    expect(await readBackupSettings(db)).toBeNull();
    await syncBackupSchedule(db, jobs);
    expect(await jobs.getSchedule('backup', 'daily')).toBeNull();
  });

  it('uses the chapter 13 defaults and the site time zone once initialised', async () => {
    const config = configFromPreset({
      type: 'blog',
      name: 'Example Blog',
      contentLanguages: ['en'],
      primaryLanguage: 'en',
      adminLocale: 'en',
      frontendBaseUrl: 'https://www.example.com',
    });
    const { adminId } = await initializeInstance(
      db,
      { ...config, site: { ...config.site, timezone: 'Asia/Shanghai' } },
      {
        registry,
        source: 'wizard',
        admin: {
          email: 'admin@example.com',
          displayName: 'Admin',
          password: 'a long enough password',
          locale: 'en',
        },
      },
    );
    actor.id = adminId!;
    expect(await readBackupSettings(db)).toEqual({
      time: '03:00',
      keepDaily: 7,
      keepWeekly: 4,
      timeZone: 'Asia/Shanghai',
    });
    await syncBackupSchedule(db, jobs);
    expect(await jobs.getSchedule('backup', 'daily')).toEqual({
      cron: '0 3 * * *',
      tz: 'Asia/Shanghai',
    });
    // The section is part of the exported configuration.
    expect((await exportInstanceConfig(db)).backups).toEqual({
      time: '03:00',
      keepDaily: 7,
      keepWeekly: 4,
    });
  });

  it('saves the schedule and retention, refuses invalid values and audits the change', async () => {
    await saveBackupSettings(db, { time: '04:30', keepDaily: 3, keepWeekly: 1 }, actor);
    await syncBackupSchedule(db, jobs);
    expect(await jobs.getSchedule('backup', 'daily')).toEqual({
      cron: '30 4 * * *',
      tz: 'Asia/Shanghai',
    });
    const error = await saveBackupSettings(
      db,
      { time: '25:00', keepDaily: 0, keepWeekly: Number.NaN },
      actor,
    ).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(InvalidInputError);
    expect((error as InvalidInputError).fields.sort()).toEqual(['keepDaily', 'keepWeekly', 'time']);
    expect((await readBackupSettings(db))?.time).toBe('04:30');
    const [entry] = await db
      .select()
      .from(schema.auditLog)
      .where(eq(schema.auditLog.targetId, 'backups'));
    expect(entry).toMatchObject({ action: 'site.update', actorId: actor.id });
  });

  it('queues one manual backup at a time', async () => {
    expect(await requestBackup(db, jobs, actor)).toBe(true);
    expect(await requestBackup(db, jobs, actor)).toBe(false);
    const entries = await db
      .select()
      .from(schema.auditLog)
      .where(eq(schema.auditLog.action, 'site.backup_start'));
    expect(entries).toHaveLength(1);
  });

  it('deletes backup files by name only, and audits it', async () => {
    await writeFile(join(dir, 'manual-20261128-120000Z.dump'), 'x');
    await writeFile(join(dir, 'secret.txt'), 'x');
    expect(await deleteBackup(db, dir, '../secret.txt', actor)).toBe(false);
    expect(await deleteBackup(db, dir, 'secret.txt', actor)).toBe(false);
    expect(await deleteBackup(db, dir, 'manual-20261128-120000Z.dump', actor)).toBe(true);
    expect(await deleteBackup(db, dir, 'manual-20261128-120000Z.dump', actor)).toBe(false);
    expect(await readdir(dir)).toEqual(['secret.txt']);
    const entries = await db
      .select()
      .from(schema.auditLog)
      .where(eq(schema.auditLog.action, 'site.backup_delete'));
    expect(entries.map((e) => e.targetId)).toEqual(['manual-20261128-120000Z.dump']);
  });

  it('shows the files, the results and the next run', async () => {
    await writeFile(join(dir, 'daily-20261128-203000Z.dump'), 'dump');
    await db.insert(schema.backupRuns).values({
      kind: 'daily',
      status: 'failed',
      error: 'pg_dump exited with code 1',
      startedAt: new Date('2026-11-27T20:30:00Z'),
      finishedAt: new Date('2026-11-27T20:30:01Z'),
    });
    const overview = await backupOverview(db, jobs, dir, new Date('2026-11-28T12:00:00Z'));
    expect(overview).toMatchObject({
      enabled: true,
      settings: { time: '04:30', keepDaily: 3, keepWeekly: 1, timeZone: 'Asia/Shanghai' },
      // 04:30 in Shanghai is 20:30 UTC the day before.
      next: '2026-11-28T20:30:00.000Z',
      scheduled: true,
      files: [{ name: 'daily-20261128-203000Z.dump', kind: 'daily', bytes: 4 }],
      runs: [{ kind: 'daily', status: 'failed', error: 'pg_dump exited with code 1' }],
      // This process has no worker role.
      workers: [],
    });
    expect((await backupOverview(db, jobs, undefined)).enabled).toBe(false);
  });
});
