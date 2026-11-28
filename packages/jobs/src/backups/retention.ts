// Retention of the daily backups (chapter 9, "备份与可观测"; chapter 13 defaults): keep the
// latest 7 daily backups and, besides them, the Sunday backups of the 4 weeks before, at most
// 11 in all. Days and weekdays are those of the site's time zone, the zone the 03:00 schedule
// runs in. Only daily backups are removed; manual and pre-migration backups stay until an admin
// deletes them (docs/adr/0019).
import type { BackupKind } from './files.ts';

export interface RetentionPolicy {
  /** Latest daily backups to keep, one per day. */
  keepDaily: number;
  /** Sunday backups to keep besides the daily ones, one per week. */
  keepWeekly: number;
  /** IANA time zone the days are counted in, e.g. `Asia/Shanghai`. */
  timeZone: string;
}

export interface RetainedFile {
  name: string;
  kind: BackupKind;
  takenAt: Date;
}

/** `2026-11-29` and whether that day is a Sunday, in `timeZone`. */
export function localDay(at: Date, timeZone: string): { date: string; sunday: boolean } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'short',
  }).formatToParts(at);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? '';
  return {
    date: `${part('year')}-${part('month')}-${part('day')}`,
    sunday: part('weekday') === 'Sun',
  };
}

/**
 * Names of the daily backups the rules no longer keep. Of several daily backups on one day
 * only the newest counts; the latest `keepDaily` days are kept, then the latest `keepWeekly`
 * Sundays before them.
 */
export function dailyBackupsToRemove(
  files: readonly RetainedFile[],
  policy: RetentionPolicy,
): string[] {
  const daily = files
    .filter((f) => f.kind === 'daily')
    .sort((a, b) => b.takenAt.getTime() - a.takenAt.getTime());
  const keep = new Set<string>();
  const seenDays = new Set<string>();
  let days = 0;
  let sundays = 0;
  for (const file of daily) {
    const { date, sunday } = localDay(file.takenAt, policy.timeZone);
    if (seenDays.has(date)) continue;
    seenDays.add(date);
    if (days < policy.keepDaily) {
      days += 1;
      keep.add(file.name);
    } else if (sunday && sundays < policy.keepWeekly) {
      sundays += 1;
      keep.add(file.name);
    }
  }
  return daily.filter((f) => !keep.has(f.name)).map((f) => f.name);
}
