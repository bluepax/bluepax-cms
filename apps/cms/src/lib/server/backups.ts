// Backups, see docs/spec/README.md chapter 9 ("启动顺序", "备份与可观测") and docs/adr/0015.
// M1 takes the full backup before migrations; daily backups, retention, downloads and the
// off-site copy come with the M2 backup item.
import { readFile, rm, stat, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import {
  dumpDatabase,
  type DumpOptions,
  type DumpResult,
  type PendingMigrations,
} from '@bluepax/db';

/** The `backups` volume in the image. */
export const DEFAULT_BACKUPS_DIR = '/data/backups';

/**
 * Names the pre-migration backup of an upgrade that has not finished yet. It is written right
 * after the dump and removed once a start completes, so a container that keeps failing to
 * migrate reuses that one backup instead of taking a new one on every restart: until a start
 * completes nothing has served traffic, so the database cannot have changed in between.
 */
export const PENDING_UPGRADE_FILE = '.pending-upgrade.json';

export type PreMigrateBackup =
  | { action: 'skipped'; reason: 'fresh_database' }
  | { action: 'reused'; file: string; takenAt: string }
  | { action: 'created'; file: string; bytes: number };

interface PendingUpgrade {
  file: string;
  takenAt: string;
  pending: PendingMigrations[];
}

/** `pre-migrate-20261126-225400Z.dump` for 2026-11-26T22:54:00Z. */
export function backupFileName(now: Date): string {
  const iso = now.toISOString();
  const date = iso.slice(0, 10).replaceAll('-', '');
  const time = iso.slice(11, 19).replaceAll(':', '');
  return `pre-migrate-${date}-${time}Z.dump`;
}

async function readPendingUpgrade(dir: string): Promise<PendingUpgrade | null> {
  let text: string;
  try {
    text = await readFile(join(dir, PENDING_UPGRADE_FILE), 'utf8');
  } catch {
    return null;
  }
  try {
    const value = JSON.parse(text) as Partial<PendingUpgrade>;
    if (typeof value.file !== 'string' || basename(value.file) !== value.file) return null;
    if (typeof value.takenAt !== 'string') return null;
    await stat(join(dir, value.file));
    return { file: value.file, takenAt: value.takenAt, pending: value.pending ?? [] };
  } catch {
    // Unreadable, or its backup was removed: take a new one.
    return null;
  }
}

export interface BackupBeforeMigrateOptions {
  dir: string;
  databaseUrl: string;
  pending: PendingMigrations[];
  /** No migration was ever applied: a new database has nothing to back up. */
  fresh: boolean;
  now?: Date;
  dump?: (options: DumpOptions) => Promise<DumpResult>;
}

/** Takes (or reuses) the full backup before pending migrations run; throws when it fails. */
export async function backupBeforeMigrate(
  options: BackupBeforeMigrateOptions,
): Promise<PreMigrateBackup> {
  if (options.fresh) return { action: 'skipped', reason: 'fresh_database' };
  const pending = await readPendingUpgrade(options.dir);
  if (pending) {
    return { action: 'reused', file: join(options.dir, pending.file), takenAt: pending.takenAt };
  }
  const now = options.now ?? new Date();
  const file = join(options.dir, backupFileName(now));
  const result = await (options.dump ?? dumpDatabase)({ databaseUrl: options.databaseUrl, file });
  const record: PendingUpgrade = {
    file: basename(file),
    takenAt: now.toISOString(),
    pending: options.pending,
  };
  await writeFile(join(options.dir, PENDING_UPGRADE_FILE), JSON.stringify(record, null, 2) + '\n');
  return { action: 'created', file: result.file, bytes: result.bytes };
}

/** Called once a start completed: the next upgrade takes a new backup. */
export async function finishPendingUpgrade(dir: string): Promise<void> {
  await rm(join(dir, PENDING_UPGRADE_FILE), { force: true });
}
