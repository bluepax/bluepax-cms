// Backups, see docs/spec/README.md chapter 9 ("启动顺序", "备份与可观测") and docs/adr/0015,
// 0019: the full backup before migrations (startup), the daily backup and backups an admin
// starts (jobs on the `backup` queue, handled in @bluepax/jobs), retention, and what
// "设置 → 备份" shows and does. Backup files can only be downloaded with `site.backups`.
import { readFile, rm, stat, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import {
  dumpDatabase,
  schema,
  type DumpOptions,
  type DumpResult,
  type Executor,
  type PendingMigrations,
} from '@bluepax/db';
import {
  backupFileName,
  DAILY_BACKUP,
  dailyCron,
  listBackups,
  nextDailyBackup,
  parseBackupFileName,
  scheduleDailyBackup,
  type BackupFile,
  type Jobs,
  type QueueInstance,
  type RetentionPolicy,
} from '@bluepax/jobs';
import { backupsConfigSchema, type BackupsConfig } from '@bluepax/presets';
import { desc, inArray } from 'drizzle-orm';
import { audit } from './audit.ts';
import type { Actor } from './modules/site/settings.ts';

/** The `backups` volume in the image. */
export const DEFAULT_BACKUPS_DIR = '/data/backups';

/** Downloading, starting and deleting backups; admin only (`kind: settings`). */
export const BACKUPS_PERMISSION = 'site.backups';

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
  | { action: 'created'; file: string; bytes: number; takenAt: string };

interface PendingUpgrade {
  file: string;
  takenAt: string;
  pending: PendingMigrations[];
}

/** `pre-migrate-20261126-225400Z.dump` for 2026-11-26T22:54:00Z. */
export function preMigrateBackupName(now: Date): string {
  return backupFileName('pre-migrate', now);
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
  const file = join(options.dir, preMigrateBackupName(now));
  const result = await (options.dump ?? dumpDatabase)({ databaseUrl: options.databaseUrl, file });
  const record: PendingUpgrade = {
    file: basename(file),
    takenAt: now.toISOString(),
    pending: options.pending,
  };
  await writeFile(join(options.dir, PENDING_UPGRADE_FILE), JSON.stringify(record, null, 2) + '\n');
  return { action: 'created', file: result.file, bytes: result.bytes, takenAt: record.takenAt };
}

/** Called once a start completed: the next upgrade takes a new backup. */
export async function finishPendingUpgrade(dir: string): Promise<void> {
  await rm(join(dir, PENDING_UPGRADE_FILE), { force: true });
}

// ---------------------------------------------------------------------------------------------
// Daily backups

export interface BackupSettings extends BackupsConfig {
  /** The site's time zone (`site.timezone`), which the time and the days are counted in. */
  timeZone: string;
}

/**
 * The `backups` section and the site's time zone, or null before the instance is initialised
 * (there is nothing to back up yet).
 */
export async function readBackupSettings(db: Executor): Promise<BackupSettings | null> {
  const rows = await db
    .select({ key: schema.settings.key, value: schema.settings.value })
    .from(schema.settings)
    .where(inArray(schema.settings.key, ['instance', 'site', 'backups']));
  const byKey = new Map(rows.map((r) => [r.key, r.value]));
  if (!byKey.has('instance')) return null;
  const site = byKey.get('site') as { timezone?: unknown } | undefined;
  return {
    ...backupsConfigSchema.parse(byKey.get('backups') ?? {}),
    timeZone: typeof site?.timezone === 'string' ? site.timezone : 'UTC',
  };
}

export function retentionPolicy(settings: BackupSettings): RetentionPolicy {
  return {
    keepDaily: settings.keepDaily,
    keepWeekly: settings.keepWeekly,
    timeZone: settings.timeZone,
  };
}

/**
 * Brings the daily backup's schedule in line with the settings. The worker calls it when it
 * starts and every minute, so a changed time zone or a fresh instance is picked up; saving
 * the backup settings calls it right away.
 */
export async function syncBackupSchedule(db: Executor, jobs: Jobs): Promise<void> {
  const settings = await readBackupSettings(db);
  if (!settings) return;
  await scheduleDailyBackup(jobs, { time: settings.time, timeZone: settings.timeZone });
}

/**
 * Queues a backup now; false when one is already waiting or running. It is not retried: the
 * admin sees the result and can start another one.
 */
export async function requestBackup(db: Executor, jobs: Jobs, actor: Actor): Promise<boolean> {
  const id = await jobs.send(
    'backup',
    { kind: 'manual' },
    { singletonKey: 'manual', retryLimit: 0 },
  );
  if (id) {
    await audit(db, {
      action: 'site.backup_start',
      actorId: actor.id,
      targetType: 'backup',
      targetId: id,
      ip: actor.ip,
    });
  }
  return id !== null;
}

/** A backup file name from a request, or null; never a path. */
export function backupName(value: string): string | null {
  return parseBackupFileName(value) ? value : null;
}

/** Deletes one backup file (any kind); false when it does not exist. */
export async function deleteBackup(
  db: Executor,
  dir: string,
  name: string,
  actor: Actor,
): Promise<boolean> {
  if (!backupName(name)) return false;
  try {
    await rm(join(dir, name));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
  await audit(db, {
    action: 'site.backup_delete',
    actorId: actor.id,
    targetType: 'backup',
    targetId: name,
    ip: actor.ip,
  });
  return true;
}

export interface BackupRunView {
  id: string;
  kind: string;
  status: 'running' | 'succeeded' | 'failed';
  file: string | null;
  bytes: number | null;
  error: string | null;
  attempt: number;
  removed: string[];
  startedAt: string;
  finishedAt: string | null;
}

export interface WorkerView {
  name: string | null;
  host: string;
  pid: number;
  live: boolean;
  queues: string[];
  startedAt: string;
  heartbeatAt: string;
}

export interface BackupOverview {
  /** False when this process has no backups folder (`vite dev` without BLUEPAX_BACKUPS_DIR). */
  enabled: boolean;
  settings: BackupSettings;
  /** When the daily backup runs next. */
  next: string | null;
  /** Whether the schedule in the queue matches the settings yet (the worker syncs it). */
  scheduled: boolean;
  files: (Omit<BackupFile, 'takenAt'> & { takenAt: string })[];
  runs: BackupRunView[];
  /** Running processes with the worker role, from the queue's instance registry. */
  workers: WorkerView[];
}

function workerView(instance: QueueInstance): WorkerView {
  return {
    name: instance.name,
    host: instance.host,
    pid: instance.pid,
    live: instance.live,
    queues: instance.queues,
    startedAt: instance.startedAt.toISOString(),
    heartbeatAt: instance.heartbeatAt.toISOString(),
  };
}

/** Everything "设置 → 备份" shows. */
export async function backupOverview(
  db: Executor,
  jobs: Jobs,
  dir: string | undefined,
  now = new Date(),
): Promise<BackupOverview> {
  const settings = (await readBackupSettings(db)) ?? {
    ...backupsConfigSchema.parse({}),
    timeZone: 'UTC',
  };
  const runs = await db
    .select()
    .from(schema.backupRuns)
    .orderBy(desc(schema.backupRuns.startedAt))
    .limit(20);
  const schedule = await jobs.getSchedule('backup', DAILY_BACKUP);
  const instances = await jobs.instances();
  const next = nextDailyBackup(jobs, settings, now);
  return {
    enabled: dir !== undefined,
    settings,
    next: next?.toISOString() ?? null,
    scheduled:
      schedule !== null &&
      schedule.tz === settings.timeZone &&
      schedule.cron === dailyCron(settings.time),
    files: dir
      ? (await listBackups(dir)).map((f) => ({ ...f, takenAt: f.takenAt.toISOString() }))
      : [],
    runs: runs.map((r) => ({
      id: r.id,
      kind: r.kind,
      status: r.status as BackupRunView['status'],
      file: r.file,
      bytes: r.bytes,
      error: r.error,
      attempt: r.attempt,
      removed: r.removed,
      startedAt: r.startedAt.toISOString(),
      finishedAt: r.finishedAt?.toISOString() ?? null,
    })),
    workers: instances.filter((i) => i.live && i.worker).map(workerView),
  };
}
