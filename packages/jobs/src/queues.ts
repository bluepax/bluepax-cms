// The queues and what their jobs carry, see docs/spec/README.md chapter 9 ("接口与后台任务")
// and docs/adr/0019. Every background task is a pg-boss job on one of these queues; the
// handlers only ever receive the job, never a request.
import type { Queue } from 'pg-boss';

/** The backup kinds a job can take; the backup before migrations runs during startup instead. */
export type BackupJobKind = 'daily' | 'manual';

/** Data of each queue's jobs. */
export interface JobData {
  backup: { kind: BackupJobKind };
}

export type QueueName = keyof JobData;

/** How long one backup may run before pg-boss stops it (its `job.signal` aborts) and retries. */
export const BACKUP_TIMEOUT_SECONDS = 4 * 60 * 60;

/**
 * Retry and retention per queue. A failed job is retried with exponential backoff
 * (`retryDelay × 2^retryCount` with jitter, capped by `retryDelayMax`).
 */
export const QUEUES = {
  backup: {
    name: 'backup',
    // At most one job per singleton key (the kind) waiting or running: a daily backup that is
    // still running when the next one comes due, or a second click on "back up now", adds none.
    policy: 'exclusive',
    retryLimit: 2,
    retryDelay: 5 * 60,
    retryBackoff: true,
    retryDelayMax: 60 * 60,
    expireInSeconds: BACKUP_TIMEOUT_SECONDS,
    // Finished jobs are kept for a month; the results live in `backup_runs` anyway.
    deleteAfterSeconds: 30 * 24 * 60 * 60,
  },
} as const satisfies Record<QueueName, Queue & { name: QueueName }>;
