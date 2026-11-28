import { freshTestDatabase } from '@bluepax/db/testing';
import pg from 'pg';
import { TestClock } from 'pg-boss';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { scheduleDailyBackup, nextDailyBackup, dailyCron } from './backups/schedule.ts';
import { Jobs, JOBS_SCHEMA, type Logger } from './jobs.ts';

// Integration test: needs a PostgreSQL server; TEST_DATABASE_URL names a database it may create others next to.
const baseUrl = process.env.TEST_DATABASE_URL;

const log: Logger = () => {};

describe('dailyCron', () => {
  it('turns a time of day into a cron expression', () => {
    expect(dailyCron('03:00')).toBe('0 3 * * *');
    expect(dailyCron('23:45')).toBe('45 23 * * *');
    expect(() => dailyCron('3:00')).toThrow();
    expect(() => dailyCron('24:00')).toThrow();
  });
});

/** State and retry count of every job of a queue, read from pg-boss's table. */
async function jobStates(url: string): Promise<{ state: string; retryCount: number }[]> {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    const result = await client.query<{ state: string; retryCount: number }>(
      `select state, retry_count as "retryCount" from ${JOBS_SCHEMA}.job where name = 'backup' order by created_on`,
    );
    return result.rows;
  } finally {
    await client.end();
  }
}

describe.skipIf(!baseUrl)('Jobs (pg-boss)', () => {
  // Every test gets its own database: jobs, schedules and the instance registry start empty.
  let url: string;
  let n = 0;
  const started: Jobs[] = [];
  const jobs = (options: Partial<ConstructorParameters<typeof Jobs>[0]> = {}): Jobs => {
    const instance = new Jobs({
      connectionString: url,
      worker: true,
      name: 'test',
      log,
      ...options,
    });
    started.push(instance);
    return instance;
  };

  beforeEach(async () => {
    n += 1;
    url = await freshTestDatabase(baseUrl!, `jobs_${n}`);
  });

  afterEach(async () => {
    await Promise.all(started.splice(0).map((j) => j.stop(1000)));
  });

  it('installs its schema and the queues, and starting again changes nothing', async () => {
    const first = jobs();
    await first.start();
    const second = jobs({ worker: false, name: 'web' });
    await second.start();
    const client = new pg.Client({ connectionString: url });
    await client.connect();
    try {
      const schemas = await client.query<{ n: string }>(
        'select nspname as n from pg_namespace where nspname = $1',
        [JOBS_SCHEMA],
      );
      expect(schemas.rows).toHaveLength(1);
    } finally {
      await client.end();
    }
    expect(await second.queue('backup')).toMatchObject({
      name: 'backup',
      retryLimit: 2,
      retryDelay: 300,
      retryBackoff: true,
      expireInSeconds: 4 * 3600,
      queued: 0,
    });
  });

  it('only lets a process with the worker role take jobs', async () => {
    const web = jobs({ worker: false });
    await web.start();
    await expect(web.work('backup', async () => {})).rejects.toThrow(/worker role/);
  });

  it('runs a job, retries a failed attempt and keeps one job per singleton key', async () => {
    const worker = jobs();
    await worker.start();
    const attempts: number[] = [];
    await worker.work('backup', async (job) => {
      attempts.push(job.retryCount);
      if (job.data.kind === 'manual' && job.retryCount === 0) {
        throw new Error('pg_dump exited with code 1');
      }
    });
    // Retried right away here; the queue itself waits 5 minutes, doubling each time.
    const id = await worker.send(
      'backup',
      { kind: 'manual' },
      { singletonKey: 'manual', retryDelay: 0, retryBackoff: false },
    );
    expect(id).toBeTruthy();
    // A second request while the first still waits adds nothing (exclusive policy).
    expect(await worker.send('backup', { kind: 'manual' }, { singletonKey: 'manual' })).toBeNull();
    // Another kind is a job of its own.
    const daily = await worker.send('backup', { kind: 'daily' }, { singletonKey: 'daily' });
    expect(daily).toBeTruthy();
    const result = await worker.drain('backup');
    expect(result.failed).toBe(1);
    expect(attempts.sort()).toEqual([0, 0, 1]);
    expect(await jobStates(url)).toEqual([
      { state: 'completed', retryCount: 1 },
      { state: 'completed', retryCount: 0 },
    ]);
  });

  it(
    'records a heartbeat per process with the queues it works on',
    { timeout: 15_000 },
    async () => {
      const worker = jobs({ name: 'web,worker', heartbeatSeconds: 1 });
      await worker.start();
      await worker.work('backup', async () => {});
      const web = jobs({ worker: false, name: 'web', heartbeatSeconds: 1 });
      await web.start();
      // The role is known from the first registry row, before any heartbeat.
      const first = (await web.instances()).filter((i) => i.pid === process.pid);
      expect(first.find((i) => i.name === 'web,worker')?.worker).toBe(true);
      expect(first.find((i) => i.name === 'web')?.worker).toBe(false);
      // The queues follow with the heartbeats.
      await vi.waitFor(
        async () => {
          const instances = await web.instances();
          const mine = instances.filter((i) => i.pid === process.pid && i.live);
          expect(mine.find((i) => i.name === 'web,worker')?.queues).toEqual(['backup']);
          expect(mine.find((i) => i.name === 'web')?.queues).toEqual([]);
        },
        { timeout: 10_000, interval: 250 },
      );
      await worker.stop(1000);
      const stopped = (await web.instances()).find(
        (i) => i.name === 'web,worker' && i.pid === process.pid,
      );
      expect(stopped?.live).toBe(false);
      expect(stopped?.stoppedAt).toBeInstanceOf(Date);
    },
  );

  it('stops gracefully: a job that outlives the timeout is aborted and retried later', async () => {
    const worker = jobs();
    await worker.start();
    let aborted = false;
    let running!: () => void;
    const isRunning = new Promise<void>((resolve) => (running = resolve));
    await worker.work(
      'backup',
      (job) =>
        new Promise((_resolve, reject) => {
          running();
          job.signal.addEventListener('abort', () => {
            aborted = true;
            reject(new Error('pg_dump was stopped: the backup was cancelled'));
          });
        }),
      { pollingIntervalSeconds: 0.5 },
    );
    await worker.send('backup', { kind: 'manual' }, { singletonKey: 'manual' });
    await isRunning;
    await worker.stop(1000);
    expect(aborted).toBe(true);
    // The attempt failed; the job waits for its next attempt (5 minutes later).
    expect(await jobStates(url)).toEqual([{ state: 'retry', retryCount: 0 }]);
  });

  it('sends the daily backup at 03:00 in the site time zone', async () => {
    // 2026-11-28 18:59:00 UTC is 02:59 on 11-29 in Shanghai.
    const clock = new TestClock(new Date('2026-11-28T18:59:00Z'));
    const worker = jobs({ clock, name: 'clock' });
    await worker.start();
    await scheduleDailyBackup(worker, { time: '03:00', timeZone: 'Asia/Shanghai' });
    expect(
      nextDailyBackup(worker, { time: '03:00', timeZone: 'Asia/Shanghai' }, new Date(clock.now())),
    ).toEqual(new Date('2026-11-28T19:00:00Z'));
    const kinds: string[] = [];
    await worker.work('backup', async (job) => {
      kinds.push(job.data.kind);
    });
    // Two minutes of simulated time: the cron pass after 03:00 sends the job, the worker takes it.
    for (let i = 0; i < 24 && kinds.length === 0; i++) await clock.tick(10_000);
    await worker.drain('backup');
    expect(kinds).toEqual(['daily']);
    // Writing the same schedule again leaves it alone; a new time replaces it.
    await scheduleDailyBackup(worker, { time: '03:00', timeZone: 'Asia/Shanghai' });
    await scheduleDailyBackup(worker, { time: '04:30', timeZone: 'Asia/Shanghai' });
    expect(await worker.getSchedule('backup', 'daily')).toEqual({
      cron: '30 4 * * *',
      tz: 'Asia/Shanghai',
    });
  });
});
