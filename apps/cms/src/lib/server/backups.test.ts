import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DumpOptions } from '@bluepax/db';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  backupBeforeMigrate,
  preMigrateBackupName,
  finishPendingUpgrade,
  PENDING_UPGRADE_FILE,
} from './backups.ts';

const databaseUrl = 'postgres://bluepax:secret@postgres:5432/bluepax';
const pending = [{ name: 'pages', count: 1 }];
const now = new Date('2026-11-26T22:54:00.123Z');

describe('preMigrateBackupName', () => {
  it('sorts by time and contains no characters that need quoting', () => {
    expect(preMigrateBackupName(now)).toBe('pre-migrate-20261126-225400Z.dump');
  });
});

describe('backupBeforeMigrate', () => {
  let dir: string;
  const dump = vi.fn(async (options: DumpOptions) => {
    await writeFile(options.file, 'dump');
    return { file: options.file, bytes: 4 };
  });

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'bluepax-backups-'));
    dump.mockClear();
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('skips the backup of a new database', async () => {
    const result = await backupBeforeMigrate({ dir, databaseUrl, pending, fresh: true, dump });
    expect(result).toEqual({ action: 'skipped', reason: 'fresh_database' });
    expect(dump).not.toHaveBeenCalled();
    expect(await readdir(dir)).toEqual([]);
  });

  it('takes a full backup and remembers it until the start completes', async () => {
    const result = await backupBeforeMigrate({
      dir,
      databaseUrl,
      pending,
      fresh: false,
      now,
      dump,
    });
    const file = join(dir, 'pre-migrate-20261126-225400Z.dump');
    expect(result).toEqual({
      action: 'created',
      file,
      bytes: 4,
      takenAt: '2026-11-26T22:54:00.123Z',
    });
    expect(dump).toHaveBeenCalledWith({ databaseUrl, file });
    const record = JSON.parse(await readFile(join(dir, PENDING_UPGRADE_FILE), 'utf8'));
    expect(record).toEqual({
      file: 'pre-migrate-20261126-225400Z.dump',
      takenAt: '2026-11-26T22:54:00.123Z',
      pending,
    });
  });

  it('reuses the backup while the upgrade keeps failing, and takes a new one after a start', async () => {
    await backupBeforeMigrate({ dir, databaseUrl, pending, fresh: false, now, dump });
    const later = new Date('2026-11-26T22:55:00Z');
    const retry = await backupBeforeMigrate({
      dir,
      databaseUrl,
      pending,
      fresh: false,
      now: later,
      dump,
    });
    expect(retry).toEqual({
      action: 'reused',
      file: join(dir, 'pre-migrate-20261126-225400Z.dump'),
      takenAt: '2026-11-26T22:54:00.123Z',
    });
    expect(dump).toHaveBeenCalledTimes(1);

    await finishPendingUpgrade(dir);
    const next = await backupBeforeMigrate({
      dir,
      databaseUrl,
      pending,
      fresh: false,
      now: later,
      dump,
    });
    expect(next).toMatchObject({
      action: 'created',
      file: join(dir, 'pre-migrate-20261126-225500Z.dump'),
    });
    expect((await readdir(dir)).filter((f) => f.endsWith('.dump'))).toHaveLength(2);
  });

  it('takes a new backup when the remembered one is gone or the record is broken', async () => {
    await writeFile(
      join(dir, PENDING_UPGRADE_FILE),
      JSON.stringify({ file: 'pre-migrate-20261120-000000Z.dump', takenAt: 'x' }),
    );
    expect(
      await backupBeforeMigrate({ dir, databaseUrl, pending, fresh: false, now, dump }),
    ).toMatchObject({ action: 'created' });
    await writeFile(
      join(dir, PENDING_UPGRADE_FILE),
      JSON.stringify({ file: '../etc/passwd', takenAt: 'x' }),
    );
    expect(
      await backupBeforeMigrate({ dir, databaseUrl, pending, fresh: false, now, dump }),
    ).toMatchObject({ action: 'created' });
  });

  it('fails when the dump fails, so the migrations do not run', async () => {
    const failing = vi.fn(async () => {
      throw new Error('pg_dump exited with code 1');
    });
    await expect(
      backupBeforeMigrate({ dir, databaseUrl, pending, fresh: false, now, dump: failing }),
    ).rejects.toThrow('pg_dump exited with code 1');
    expect(await readdir(dir)).toEqual([]);
  });
});
