// The backup job (chapter 9, "备份与可观测"; docs/adr/0019): a full pg_dump into the backups
// folder, recorded in `backup_runs`; after a successful daily backup the retention rules
// remove the daily backups they no longer keep. A failed dump throws, so pg-boss retries it,
// and never removes anything.
import { join } from 'node:path';
import {
  dumpDatabase,
  schema,
  type Database,
  type DumpOptions,
  type DumpResult,
  type Executor,
} from '@bluepax/db';
import { and, eq, lt } from 'drizzle-orm';
import { rm } from 'node:fs/promises';
import type { Logger } from '../jobs.ts';
import { BACKUP_TIMEOUT_SECONDS, type BackupJobKind } from '../queues.ts';
import { backupFileName, listBackups, removeStalePartials, type BackupKind } from './files.ts';
import { dailyBackupsToRemove, type RetentionPolicy } from './retention.ts';

/** Backup results older than this are deleted when a backup runs. */
export const BACKUP_RUNS_KEPT_DAYS = 90;
const DAY_MS = 86_400_000;

export interface BackupServices {
  db: Database;
  /** The backups folder (`BLUEPAX_BACKUPS_DIR`). */
  dir: string;
  databaseUrl: string;
  /** The retention rules and time zone as they are set now. */
  policy: () => Promise<RetentionPolicy>;
  log: Logger;
  dump?: (options: DumpOptions) => Promise<DumpResult>;
  now?: () => Date;
}

export interface BackupRequest {
  kind: BackupJobKind;
  /** The pg-boss job and its retry count. */
  jobId?: string;
  attempt?: number;
  /** Aborted when the job runs out of time or the process stops: pg_dump is stopped too. */
  signal?: AbortSignal;
}

export interface BackupResult {
  file: string;
  bytes: number;
  removed: string[];
}

const INTERRUPTED = 'interrupted: the process stopped while the backup was running';

/**
 * Marks results still `running` that cannot be running any more: an earlier attempt of the
 * same job (its process was killed before it could record the failure), or any attempt
 * older than the backup timeout.
 */
async function markInterrupted(db: Executor, now: Date, jobId?: string): Promise<void> {
  const set = { status: 'failed', error: INTERRUPTED, finishedAt: now };
  if (jobId) {
    await db
      .update(schema.backupRuns)
      .set(set)
      .where(and(eq(schema.backupRuns.status, 'running'), eq(schema.backupRuns.jobId, jobId)));
  }
  await db
    .update(schema.backupRuns)
    .set(set)
    .where(
      and(
        eq(schema.backupRuns.status, 'running'),
        lt(schema.backupRuns.startedAt, new Date(now.getTime() - BACKUP_TIMEOUT_SECONDS * 1000)),
      ),
    );
}

export async function runBackup(
  services: BackupServices,
  request: BackupRequest,
): Promise<BackupResult> {
  const now = services.now ?? (() => new Date());
  const startedAt = now();
  const { db, dir, log } = services;
  await markInterrupted(db, startedAt, request.jobId);
  await removeStalePartials(dir, new Date(startedAt.getTime() - BACKUP_TIMEOUT_SECONDS * 1000));

  const name = backupFileName(request.kind, startedAt);
  const [run] = await db
    .insert(schema.backupRuns)
    .values({
      kind: request.kind,
      status: 'running',
      file: name,
      jobId: request.jobId ?? null,
      attempt: request.attempt ?? 0,
      startedAt,
    })
    .returning({ id: schema.backupRuns.id });
  if (!run) throw new Error('could not record the backup run');

  try {
    const dump = services.dump ?? dumpDatabase;
    const result = await dump({
      databaseUrl: services.databaseUrl,
      file: join(dir, name),
      ...(request.signal ? { signal: request.signal } : {}),
    });
    const removed = request.kind === 'daily' ? await applyRetention(services) : [];
    await db
      .update(schema.backupRuns)
      .set({ status: 'succeeded', bytes: result.bytes, removed, finishedAt: now() })
      .where(eq(schema.backupRuns.id, run.id));
    await db
      .delete(schema.backupRuns)
      .where(
        lt(
          schema.backupRuns.startedAt,
          new Date(startedAt.getTime() - BACKUP_RUNS_KEPT_DAYS * DAY_MS),
        ),
      );
    log('info', 'backup created', { kind: request.kind, file: name, bytes: result.bytes, removed });
    return { file: name, bytes: result.bytes, removed };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await db
      .update(schema.backupRuns)
      .set({ status: 'failed', error: message.slice(0, 2000), finishedAt: now() })
      .where(eq(schema.backupRuns.id, run.id));
    throw error;
  }
}

/** Removes the daily backups the retention rules no longer keep; returns their names. */
async function applyRetention(services: BackupServices): Promise<string[]> {
  const policy = await services.policy();
  const files = await listBackups(services.dir);
  const remove = dailyBackupsToRemove(files, policy);
  const removed: string[] = [];
  for (const name of remove) {
    try {
      await rm(join(services.dir, name));
      removed.push(name);
    } catch (error) {
      services.log('warn', 'could not remove an old backup', {
        file: name,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return removed;
}

/**
 * Records the backup startup took before migrating, once the migrations created this table,
 * so the admin sees it next to the daily backups.
 */
export async function recordStartupBackup(
  db: Executor,
  backup: { file: string; bytes: number; takenAt: Date },
): Promise<void> {
  await db.insert(schema.backupRuns).values({
    kind: 'pre-migrate' satisfies BackupKind,
    status: 'succeeded',
    file: backup.file,
    bytes: backup.bytes,
    startedAt: backup.takenAt,
    finishedAt: backup.takenAt,
  });
}
