// The job queue of one process, see docs/spec/README.md chapter 9 ("接口与后台任务", "队列：
// pg-boss") and docs/adr/0019. Every role sends jobs and writes schedules; only a process with
// the worker role runs the queue's maintenance and schedules and takes jobs.
import {
  PgBoss,
  type Clock,
  type DrainResult,
  type Job,
  type ScheduleOptions,
  type SendOptions,
} from 'pg-boss';
import { QUEUES, type JobData, type QueueName } from './queues.ts';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';
export type Logger = (level: LogLevel, message: string, fields?: Record<string, unknown>) => void;

/** The schema pg-boss installs its tables in (chapter 4, "任务队列表"). */
export const JOBS_SCHEMA = 'pgboss';

/** How long a stopping process waits for running jobs; the rest are failed and retried later. */
export const STOP_TIMEOUT_MS = 20_000;

export interface JobsOptions {
  connectionString: string;
  /**
   * The worker role: runs the queue's maintenance and its schedules, and may take jobs. A
   * web-only process only sends jobs and writes schedules.
   */
  worker: boolean;
  /** Name in pg-boss's instance registry, e.g. the roles `web,worker`. */
  name: string;
  log: Logger;
  /** Connections in pg-boss's own pool, apart from the application's. */
  poolSize?: number;
  /** Seconds between heartbeats in the instance registry (pg-boss default 30). */
  heartbeatSeconds?: number;
  /** pg-boss's `TestClock` in tests. */
  clock?: Clock;
}

/** A queue's options and how many of its jobs wait, run or failed recently. */
export interface QueueState {
  name: string;
  retryLimit: number;
  retryDelay: number;
  retryBackoff: boolean;
  expireInSeconds: number;
  queued: number;
  active: number;
  /** Failed jobs still kept (a rolling count, see the queue's retention). */
  failed: number;
}

/** One process seen in pg-boss's instance registry: its heartbeat and what it works on. */
export interface QueueInstance {
  id: string;
  name: string | null;
  host: string;
  pid: number;
  /** Not stopped, and heard from within three heartbeats. */
  live: boolean;
  /**
   * A process with the worker role: it runs the schedules and the maintenance. Known from its
   * first registry row, whereas `queues` only fills in with its first heartbeat (30 s).
   */
  worker: boolean;
  /** Queues it takes jobs from; empty for a web-only process. */
  queues: string[];
  startedAt: Date;
  heartbeatAt: Date;
  stoppedAt: Date | null;
}

export type JobHandler<N extends QueueName> = (job: Job<JobData[N]>) => Promise<unknown>;

export class Jobs {
  readonly #boss: PgBoss;
  readonly #log: Logger;
  readonly #worker: boolean;
  #started = false;

  constructor(options: JobsOptions) {
    this.#log = options.log;
    this.#worker = options.worker;
    this.#boss = new PgBoss({
      connectionString: options.connectionString,
      schema: JOBS_SCHEMA,
      max: options.poolSize ?? 4,
      application_name: 'bluepax-jobs',
      migrate: true,
      supervise: options.worker,
      schedule: options.worker,
      instanceName: options.name,
      ...(options.heartbeatSeconds ? { instanceHeartbeatSeconds: options.heartbeatSeconds } : {}),
      ...(options.clock ? { clock: options.clock } : {}),
      // No OpenTelemetry SDK is registered; keep pg-boss from storing trace context on jobs.
      openTelemetry: { enabled: false },
    });
    this.#boss.on('error', (error) => {
      this.#log('error', 'job queue error', { error: error.message });
    });
    this.#boss.on('warning', (warning) => {
      this.#log('warn', 'job queue warning', { ...warning });
    });
  }

  get worker(): boolean {
    return this.#worker;
  }

  /**
   * Installs or upgrades pg-boss's own schema, then creates the queues or brings their retry
   * and retention options up to date. Startup calls it while holding the migration lock, after
   * the application's migrations (docs/adr/0019).
   */
  async start(): Promise<void> {
    await this.#boss.start();
    this.#started = true;
    for (const queue of Object.values(QUEUES)) {
      const { name, policy, ...options } = queue;
      const existing = await this.#boss.getQueue(name);
      if (!existing) await this.#boss.createQueue(name, { policy, ...options });
      else await this.#boss.updateQueue(name, options);
    }
  }

  async send<N extends QueueName>(
    name: N,
    data: JobData[N],
    options: SendOptions = {},
  ): Promise<string | null> {
    return this.#boss.send(name, data, options);
  }

  /** Creates or replaces the schedule `key` of a queue (a cron expression in `tz`). */
  async schedule<N extends QueueName>(
    name: N,
    cron: string,
    data: JobData[N],
    options: ScheduleOptions & { key: string },
  ): Promise<void> {
    await this.#boss.schedule(name, cron, data, options);
  }

  async unschedule(name: QueueName, key: string): Promise<void> {
    await this.#boss.unschedule(name, key);
  }

  /** The schedule `key` of a queue, or null. */
  async getSchedule(name: QueueName, key: string): Promise<{ cron: string; tz: string } | null> {
    const schedule = await this.#boss.getSchedule(name, key);
    return schedule ? { cron: schedule.cron, tz: schedule.timezone } : null;
  }

  /** The next times a cron expression comes due in a time zone, after `from`. */
  previewSchedule(cron: string, tz: string, from: Date, count = 1): Date[] {
    return this.#boss.previewSchedule(cron, { tz, from, count });
  }

  /**
   * Takes jobs from a queue, one at a time per worker; `concurrency` workers run side by side in
   * this process. A handler that throws fails the attempt: pg-boss retries it with backoff
   * until the queue's `retryLimit`. Only processes with the worker role may take jobs.
   */
  async work<N extends QueueName>(
    name: N,
    handler: JobHandler<N>,
    options: { concurrency?: number; pollingIntervalSeconds?: number } = {},
  ): Promise<void> {
    if (!this.#worker) throw new Error('only a process with the worker role takes jobs');
    await this.#boss.work<JobData[N]>(
      name,
      {
        batchSize: 1,
        localConcurrency: options.concurrency ?? 1,
        ...(options.pollingIntervalSeconds
          ? { pollingIntervalSeconds: options.pollingIntervalSeconds }
          : {}),
      },
      async ([job]) => {
        if (!job) return;
        const started = Date.now();
        try {
          const result = await handler(job);
          this.#log('info', 'job completed', {
            queue: name,
            job: job.id,
            attempt: job.retryCount,
            ms: Date.now() - started,
          });
          return result;
        } catch (error) {
          this.#log('error', 'job failed', {
            queue: name,
            job: job.id,
            attempt: job.retryCount,
            ms: Date.now() - started,
            error: error instanceof Error ? error.message : String(error),
          });
          throw error;
        }
      },
    );
  }

  async queue(name: QueueName): Promise<QueueState | null> {
    const queue = await this.#boss.getQueue(name);
    if (!queue) return null;
    return {
      name: queue.name,
      retryLimit: queue.retryLimit ?? 0,
      retryDelay: queue.retryDelay ?? 0,
      retryBackoff: queue.retryBackoff ?? false,
      expireInSeconds: queue.expireInSeconds ?? 0,
      queued: queue.queuedCount,
      active: queue.activeCount,
      failed: queue.failedCount,
    };
  }

  /** Every process in pg-boss's instance registry, newest heartbeat first. */
  async instances(): Promise<QueueInstance[]> {
    const instances = await this.#boss.getInstances();
    return instances
      .map((i) => ({
        id: i.id,
        name: i.name,
        host: i.host,
        pid: i.pid,
        live: i.live,
        worker: i.schedule && i.supervise,
        queues: [...new Set(i.workers.map((w) => w.queue))].sort(),
        startedAt: new Date(i.startedOn),
        heartbeatAt: new Date(i.heartbeatOn),
        stoppedAt: i.stoppedOn ? new Date(i.stoppedOn) : null,
      }))
      .sort((a, b) => b.heartbeatAt.getTime() - a.heartbeatAt.getTime());
  }

  /**
   * Stops taking jobs and waits up to `timeoutMs` for the running ones; those still running
   * then have their `job.signal` aborted and are failed, so they are retried later.
   */
  async stop(timeoutMs = STOP_TIMEOUT_MS): Promise<void> {
    if (!this.#started) return;
    this.#started = false;
    await this.#boss.stop({ graceful: true, timeout: timeoutMs });
  }

  /** Runs this process's workers of a queue until nothing is ready (tests). */
  async drain(name: QueueName): Promise<DrainResult> {
    return this.#boss.drain(name);
  }
}
