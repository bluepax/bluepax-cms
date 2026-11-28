// When the daily backup runs (chapter 13: every day at 03:00 in the site's time zone). The
// schedule is a pg-boss schedule row; any role may write it, only worker processes act on it.
import type { Jobs } from '../jobs.ts';

/** Key of the daily backup's schedule (and singleton key of its jobs). */
export const DAILY_BACKUP = 'daily';

export interface BackupSchedule {
  /** `HH:MM`, 24-hour clock. */
  time: string;
  /** IANA time zone, e.g. `Asia/Shanghai`. */
  timeZone: string;
}

/** `03:00` → `0 3 * * *`. */
export function dailyCron(time: string): string {
  const match = /^([01][0-9]|2[0-3]):([0-5][0-9])$/.exec(time);
  if (!match) throw new Error(`"${time}" is not a time of day (HH:MM)`);
  return `${Number(match[2])} ${Number(match[1])} * * *`;
}

/**
 * Creates or updates the daily backup's schedule. A backup that came due while no worker was
 * running is taken once when one runs again (`missed: 'once'`).
 */
export async function scheduleDailyBackup(jobs: Jobs, schedule: BackupSchedule): Promise<void> {
  const cron = dailyCron(schedule.time);
  const current = await jobs.getSchedule('backup', DAILY_BACKUP);
  if (current?.cron === cron && current.tz === schedule.timeZone) return;
  await jobs.schedule(
    'backup',
    cron,
    { kind: 'daily' },
    { key: DAILY_BACKUP, tz: schedule.timeZone, singletonKey: DAILY_BACKUP, missed: 'once' },
  );
}

/** When the daily backup runs next after `from`. */
export function nextDailyBackup(jobs: Jobs, schedule: BackupSchedule, from: Date): Date | null {
  return jobs.previewSchedule(dailyCron(schedule.time), schedule.timeZone, from)[0] ?? null;
}
