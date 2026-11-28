import { mkdtemp, readdir, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  backupFileName,
  listBackups,
  parseBackupFileName,
  removeStalePartials,
  type BackupKind,
} from './files.ts';
import { dailyBackupsToRemove, localDay, type RetentionPolicy } from './retention.ts';

const DEFAULT: RetentionPolicy = { keepDaily: 7, keepWeekly: 4, timeZone: 'UTC' };

describe('backup file names', () => {
  it('round trips kind and time', () => {
    const at = new Date('2026-11-29T03:00:07.456Z');
    expect(backupFileName('daily', at)).toBe('daily-20261129-030007Z.dump');
    expect(parseBackupFileName('daily-20261129-030007Z.dump')).toEqual({
      kind: 'daily',
      takenAt: new Date('2026-11-29T03:00:07Z'),
    });
    expect(parseBackupFileName('pre-migrate-20261126-225400Z.dump')?.kind).toBe('pre-migrate');
    expect(parseBackupFileName('manual-20261126-225400Z.dump')?.kind).toBe('manual');
  });

  it('rejects anything else, including paths and impossible dates', () => {
    for (const name of [
      '../daily-20261129-030007Z.dump',
      'daily-20261129-030007Z.dump.partial',
      'daily-20261329-030007Z.dump',
      'daily-20261129-250007Z.dump',
      'weekly-20261129-030007Z.dump',
      'daily-2026112-030007Z.dump',
      '.pending-upgrade.json',
      'daily-20261129-030007Z.sql',
    ]) {
      expect(parseBackupFileName(name), name).toBeNull();
    }
  });
});

describe('listBackups and removeStalePartials', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'bluepax-jobs-files-'));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('lists backup files newest first and ignores everything else', async () => {
    await writeFile(join(dir, 'daily-20261128-030000Z.dump'), 'aa');
    await writeFile(join(dir, 'pre-migrate-20261129-120000Z.dump'), 'bbb');
    await writeFile(join(dir, 'daily-20261129-030000Z.dump.partial'), 'x');
    await writeFile(join(dir, '.pending-upgrade.json'), '{}');
    await writeFile(join(dir, 'notes.txt'), 'x');
    const files = await listBackups(dir);
    expect(files.map((f) => [f.name, f.kind, f.bytes])).toEqual([
      ['pre-migrate-20261129-120000Z.dump', 'pre-migrate', 3],
      ['daily-20261128-030000Z.dump', 'daily', 2],
    ]);
    expect(await listBackups(join(dir, 'missing'))).toEqual([]);
  });

  it('removes only old partial backup files', async () => {
    const old = join(dir, 'daily-20261101-030000Z.dump.partial');
    await writeFile(old, 'x');
    await utimes(old, new Date('2026-11-01T03:00:00Z'), new Date('2026-11-01T03:00:00Z'));
    await writeFile(join(dir, 'daily-20261129-030000Z.dump.partial'), 'x');
    await writeFile(join(dir, 'other.partial'), 'x');
    const removed = await removeStalePartials(dir, new Date(Date.now() - 60_000));
    expect(removed).toEqual(['daily-20261101-030000Z.dump.partial']);
    expect((await readdir(dir)).sort()).toEqual([
      'daily-20261129-030000Z.dump.partial',
      'other.partial',
    ]);
  });
});

/** A daily backup taken at `iso`. */
function daily(iso: string, kind: BackupKind = 'daily') {
  const takenAt = new Date(iso);
  return { name: backupFileName(kind, takenAt), kind, takenAt };
}

/** One daily backup at 03:00 UTC on each of `count` days ending on `last` (YYYY-MM-DD). */
function dailies(last: string, count: number) {
  const end = new Date(`${last}T03:00:00Z`).getTime();
  return Array.from({ length: count }, (_, i) =>
    daily(new Date(end - i * 86_400_000).toISOString()),
  );
}

describe('dailyBackupsToRemove', () => {
  it('keeps 7 daily backups and the 4 Sundays before them: 11 in all', () => {
    // 2026-11-29 is a Sunday; 60 days of backups up to it.
    const files = dailies('2026-11-29', 60);
    const removed = new Set(dailyBackupsToRemove(files, DEFAULT));
    const kept = files.filter((f) => !removed.has(f.name)).map((f) => f.name);
    expect(kept).toEqual([
      'daily-20261129-030000Z.dump',
      'daily-20261128-030000Z.dump',
      'daily-20261127-030000Z.dump',
      'daily-20261126-030000Z.dump',
      'daily-20261125-030000Z.dump',
      'daily-20261124-030000Z.dump',
      'daily-20261123-030000Z.dump',
      // Sundays before the 7 days.
      'daily-20261122-030000Z.dump',
      'daily-20261115-030000Z.dump',
      'daily-20261108-030000Z.dump',
      'daily-20261101-030000Z.dump',
    ]);
  });

  it('on a weekday the window holds one Sunday and four more come before it', () => {
    // 2026-12-02 is a Wednesday: the 7 days hold Sunday 11-29, then 11-22 … 11-01.
    const files = dailies('2026-12-02', 60);
    const removed = new Set(dailyBackupsToRemove(files, DEFAULT));
    const kept = files.filter((f) => !removed.has(f.name));
    expect(kept).toHaveLength(11);
    expect(kept.slice(7).map((f) => f.name)).toEqual([
      'daily-20261122-030000Z.dump',
      'daily-20261115-030000Z.dump',
      'daily-20261108-030000Z.dump',
      'daily-20261101-030000Z.dump',
    ]);
  });

  it('counts days and Sundays in the site time zone', () => {
    // 03:00 in Shanghai is 19:00 UTC the day before: the backup of Sunday 2026-11-22 in
    // Shanghai is taken on Saturday in UTC.
    const end = new Date('2026-11-28T19:00:00Z').getTime();
    const files = Array.from({ length: 30 }, (_, i) =>
      daily(new Date(end - i * 86_400_000).toISOString()),
    );
    const shanghai = { ...DEFAULT, timeZone: 'Asia/Shanghai' };
    expect(localDay(new Date('2026-11-21T19:00:00Z'), 'Asia/Shanghai')).toEqual({
      date: '2026-11-22',
      sunday: true,
    });
    const removed = new Set(dailyBackupsToRemove(files, shanghai));
    const kept = files.filter((f) => !removed.has(f.name)).map((f) => f.name);
    expect(kept.slice(7)).toEqual([
      'daily-20261121-190000Z.dump', // Sunday 11-22 in Shanghai
      'daily-20261114-190000Z.dump',
      'daily-20261107-190000Z.dump',
      'daily-20261031-190000Z.dump',
    ]);
    // In UTC those are Saturdays: the UTC rule keeps other files.
    expect(dailyBackupsToRemove(files, DEFAULT)).not.toEqual([...removed]);
  });

  it('keeps one backup per day, the newest', () => {
    const files = [
      daily('2026-11-29T14:00:00Z'),
      daily('2026-11-29T03:00:00Z'),
      ...dailies('2026-11-28', 10),
    ];
    const removed = dailyBackupsToRemove(files, DEFAULT);
    expect(removed).toContain('daily-20261129-030000Z.dump');
    expect(removed).not.toContain('daily-20261129-140000Z.dump');
  });

  it('counts the days that have a backup, so missed days keep older ones', () => {
    // Nothing between 11-20 and 11-27: the 7 latest backups reach back further.
    const files = [...dailies('2026-11-29', 3), ...dailies('2026-11-19', 20)];
    const removed = new Set(dailyBackupsToRemove(files, DEFAULT));
    const kept = files.filter((f) => !removed.has(f.name)).map((f) => f.name);
    expect(kept.slice(0, 7)).toEqual([
      'daily-20261129-030000Z.dump',
      'daily-20261128-030000Z.dump',
      'daily-20261127-030000Z.dump',
      'daily-20261119-030000Z.dump',
      'daily-20261118-030000Z.dump',
      'daily-20261117-030000Z.dump',
      'daily-20261116-030000Z.dump',
    ]);
    expect(kept.slice(7)).toEqual([
      'daily-20261115-030000Z.dump',
      'daily-20261108-030000Z.dump',
      'daily-20261101-030000Z.dump',
    ]);
  });

  it('never removes manual or pre-migration backups', () => {
    const files = [
      ...dailies('2026-11-29', 30),
      daily('2026-09-01T10:00:00Z', 'manual'),
      daily('2026-08-01T10:00:00Z', 'pre-migrate'),
    ];
    const removed = dailyBackupsToRemove(files, { ...DEFAULT, keepDaily: 1, keepWeekly: 0 });
    expect(removed).toHaveLength(29);
    expect(removed.some((n) => !n.startsWith('daily-'))).toBe(false);
  });

  it('follows changed counts', () => {
    const files = dailies('2026-11-29', 60);
    const keep = (policy: RetentionPolicy) =>
      files.length - dailyBackupsToRemove(files, policy).length;
    expect(keep({ ...DEFAULT, keepDaily: 3, keepWeekly: 0 })).toBe(3);
    expect(keep({ ...DEFAULT, keepDaily: 14, keepWeekly: 2 })).toBe(16);
    expect(keep({ ...DEFAULT, keepDaily: 1, keepWeekly: 52 })).toBe(1 + 8);
  });
});
