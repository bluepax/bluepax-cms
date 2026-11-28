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
  type DumpOptions,
  type Pool,
} from '@bluepax/db';
import { freshTestDatabase } from '@bluepax/db/testing';
import { desc } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { backupFileName } from './files.ts';
import { recordStartupBackup, runBackup, type BackupServices } from './run.ts';

// Integration test: needs a PostgreSQL server; TEST_DATABASE_URL names a database it may create others next to.
const baseUrl = process.env.TEST_DATABASE_URL;
const root = fileURLToPath(new URL('../../../db/migrations', import.meta.url));

describe.skipIf(!baseUrl)('runBackup', { timeout: 30_000 }, () => {
  let pool: Pool;
  let db: Database;
  let dir: string;
  let now: Date;
  const log = vi.fn();
  const dump = vi.fn(async (options: DumpOptions) => {
    await writeFile(options.file, 'dump');
    return { file: options.file, bytes: 4 };
  });
  const services = (): BackupServices => ({
    db,
    dir,
    databaseUrl: 'postgres://bluepax:secret@postgres/bluepax',
    policy: async () => ({ keepDaily: 7, keepWeekly: 4, timeZone: 'UTC' }),
    log,
    dump,
    now: () => now,
  });
  const runs = () => db.select().from(schema.backupRuns).orderBy(desc(schema.backupRuns.startedAt));

  beforeAll(async () => {
    const url = await freshTestDatabase(baseUrl!, 'jobs_backup');
    pool = createPool(url, 2);
    await runMigrations(pool, migrationSets(root, []));
    db = createDatabase(pool);
  });

  afterAll(async () => {
    await pool.end();
  });

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'bluepax-jobs-run-'));
    now = new Date('2026-11-29T03:00:00Z');
    dump.mockClear();
    await db.delete(schema.backupRuns);
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('dumps into the folder and records the result', async () => {
    const result = await runBackup(services(), { kind: 'manual', jobId: 'job-1', attempt: 0 });
    expect(result).toEqual({ file: 'manual-20261129-030000Z.dump', bytes: 4, removed: [] });
    expect(dump).toHaveBeenCalledWith({
      databaseUrl: 'postgres://bluepax:secret@postgres/bluepax',
      file: join(dir, 'manual-20261129-030000Z.dump'),
    });
    const [run] = await runs();
    expect(run).toMatchObject({
      kind: 'manual',
      status: 'succeeded',
      file: 'manual-20261129-030000Z.dump',
      bytes: 4,
      jobId: 'job-1',
      attempt: 0,
      error: null,
    });
    expect(run?.finishedAt).toBeInstanceOf(Date);
  });

  it('applies the retention rules after a daily backup, never after a failed one', async () => {
    // 40 days of daily backups before today and an old manual one.
    for (let i = 1; i <= 40; i++) {
      await writeFile(
        join(dir, backupFileName('daily', new Date(now.getTime() - i * 86_400_000))),
        'x',
      );
    }
    await writeFile(join(dir, 'manual-20260101-120000Z.dump'), 'x');

    dump.mockRejectedValueOnce(new Error('pg_dump exited with code 1: disk full'));
    await expect(runBackup(services(), { kind: 'daily' })).rejects.toThrow('disk full');
    expect(await readdir(dir)).toHaveLength(41);
    expect((await runs())[0]).toMatchObject({
      status: 'failed',
      error: 'pg_dump exited with code 1: disk full',
      removed: [],
    });

    // The retry a few minutes later.
    now = new Date(now.getTime() + 5 * 60_000);
    const result = await runBackup(services(), { kind: 'daily' });
    // Today plus 6 days before, then 4 Sundays: 11 daily backups and the manual one remain.
    expect(result.removed).toHaveLength(30);
    const left = (await readdir(dir)).sort();
    expect(left).toHaveLength(12);
    expect(left).toContain('manual-20260101-120000Z.dump');
    expect(left).toContain('daily-20261129-030500Z.dump');
    expect((await runs())[0]?.removed).toHaveLength(30);
  });

  it('marks earlier attempts that never finished as interrupted', async () => {
    await db.insert(schema.backupRuns).values([
      {
        kind: 'daily',
        status: 'running',
        jobId: 'job-2',
        startedAt: new Date(now.getTime() - 60_000),
      },
      {
        kind: 'manual',
        status: 'running',
        jobId: 'job-3',
        startedAt: new Date(now.getTime() - 5 * 3600_000),
      },
      {
        kind: 'manual',
        status: 'running',
        jobId: 'job-4',
        startedAt: new Date(now.getTime() - 60_000),
      },
    ]);
    await runBackup(services(), { kind: 'daily', jobId: 'job-2', attempt: 1 });
    const byJob = Object.groupBy(await runs(), (r) => r.jobId ?? '');
    expect(byJob['job-2']?.map((r) => r.status).sort()).toEqual(['failed', 'succeeded']);
    expect(byJob['job-2']?.find((r) => r.status === 'failed')?.error).toMatch(/^interrupted/);
    // Older than the backup timeout.
    expect(byJob['job-3']?.[0]?.status).toBe('failed');
    // Possibly still running in another process.
    expect(byJob['job-4']?.[0]?.status).toBe('running');
  });

  it('forgets results after 90 days', async () => {
    await db.insert(schema.backupRuns).values([
      { kind: 'daily', status: 'succeeded', startedAt: new Date('2026-08-01T03:00:00Z') },
      { kind: 'daily', status: 'succeeded', startedAt: new Date('2026-09-15T03:00:00Z') },
    ]);
    await runBackup(services(), { kind: 'daily' });
    expect((await runs()).map((r) => r.startedAt.toISOString())).toEqual([
      '2026-11-29T03:00:00.000Z',
      '2026-09-15T03:00:00.000Z',
    ]);
  });

  it('passes the job signal to pg_dump', async () => {
    const controller = new AbortController();
    await runBackup(services(), { kind: 'manual', signal: controller.signal });
    expect(dump.mock.calls[0]?.[0].signal).toBe(controller.signal);
  });

  it('records the backup taken before migrating', async () => {
    await recordStartupBackup(db, {
      file: 'pre-migrate-20261129-010000Z.dump',
      bytes: 123,
      takenAt: new Date('2026-11-29T01:00:00Z'),
    });
    expect((await runs())[0]).toMatchObject({
      kind: 'pre-migrate',
      status: 'succeeded',
      file: 'pre-migrate-20261129-010000Z.dump',
      bytes: 123,
    });
  });
});
