// The worker role (chapter 9, "接口与后台任务"; docs/adr/0019): registers the job handlers of
// @bluepax/jobs with the services they need and keeps the schedules in line with the
// settings. Started only after the migrations and only in processes whose BLUEPAX_ROLES
// include `worker`; it never sees a request.
import type { Database } from '@bluepax/db';
import { runBackup, type Jobs } from '@bluepax/jobs';
import { readBackupSettings, retentionPolicy, syncBackupSchedule } from './backups.ts';
import { log } from './log.ts';

/** How often the worker re-reads the settings the schedules depend on. */
const SYNC_INTERVAL_MS = 60_000;

export interface WorkerOptions {
  jobs: Jobs;
  db: Database;
  /** Without a backups folder (`vite dev`) the backup jobs are not taken. */
  backupsDir: string | undefined;
  databaseUrl: string;
}

export interface Worker {
  stop(): Promise<void>;
}

export async function startWorker(options: WorkerOptions): Promise<Worker> {
  const { jobs, db, backupsDir: dir } = options;
  const timers: NodeJS.Timeout[] = [];

  if (dir) {
    await jobs.work('backup', (job) =>
      runBackup(
        {
          db,
          dir,
          databaseUrl: options.databaseUrl,
          policy: async () => {
            const settings = await readBackupSettings(db);
            if (!settings) throw new Error('the instance is not initialised');
            return retentionPolicy(settings);
          },
          log,
        },
        { kind: job.data.kind, jobId: job.id, attempt: job.retryCount, signal: job.signal },
      ),
    );
    const sync = async () => {
      try {
        await syncBackupSchedule(db, jobs);
      } catch (error) {
        log('error', 'could not update the backup schedule', {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    };
    await sync();
    const timer = setInterval(() => void sync(), SYNC_INTERVAL_MS);
    timer.unref();
    timers.push(timer);
  } else {
    log('warn', 'backups are off in this process: BLUEPAX_BACKUPS_DIR is not set');
  }

  log('info', 'worker started', { queues: dir ? ['backup'] : [] });
  return {
    async stop() {
      for (const timer of timers) clearInterval(timer);
    },
  };
}
