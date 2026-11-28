// Backup files in the backups folder (the `backups` volume, docs/adr/0015 and 0019). The name
// says what a file is and when it was taken, so the folder needs no index of its own:
// `<kind>-YYYYMMDD-HHMMSSZ.dump`, the time in UTC.
import { readdir, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';

export const BACKUP_KINDS = ['daily', 'manual', 'pre-migrate'] as const;
export type BackupKind = (typeof BACKUP_KINDS)[number];

/** Suffix pg_dump writes to first (`dumpDatabase`); renamed once the dump is complete. */
const PARTIAL = '.partial';
const STAMP = /^[0-9]{8}-[0-9]{6}Z\.dump$/;

export interface BackupFile {
  name: string;
  kind: BackupKind;
  takenAt: Date;
  bytes: number;
}

/** `daily-20261126-030000Z.dump` for a daily backup taken at 2026-11-26T03:00:00Z. */
export function backupFileName(kind: BackupKind, at: Date): string {
  const iso = at.toISOString();
  const date = iso.slice(0, 10).replaceAll('-', '');
  const time = iso.slice(11, 19).replaceAll(':', '');
  return `${kind}-${date}-${time}Z.dump`;
}

/** The kind and time of a backup file name, or null for anything else (the download check). */
export function parseBackupFileName(name: string): { kind: BackupKind; takenAt: Date } | null {
  for (const kind of BACKUP_KINDS) {
    if (!name.startsWith(`${kind}-`)) continue;
    const stamp = name.slice(kind.length + 1);
    if (!STAMP.test(stamp)) return null;
    const iso =
      `${stamp.slice(0, 4)}-${stamp.slice(4, 6)}-${stamp.slice(6, 8)}T` +
      `${stamp.slice(9, 11)}:${stamp.slice(11, 13)}:${stamp.slice(13, 15)}Z`;
    const takenAt = new Date(iso);
    // Rejects impossible dates such as month 13 and round trips exactly.
    if (Number.isNaN(takenAt.getTime()) || backupFileName(kind, takenAt) !== name) return null;
    return { kind, takenAt };
  }
  return null;
}

/** Backup files in the folder, newest first; a folder that does not exist yet has none. */
export async function listBackups(dir: string): Promise<BackupFile[]> {
  let names: string[];
  try {
    names = await readdir(dir);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
  const files: BackupFile[] = [];
  for (const name of names) {
    const parsed = parseBackupFileName(name);
    if (!parsed) continue;
    try {
      const info = await stat(join(dir, name));
      if (info.isFile()) files.push({ name, ...parsed, bytes: info.size });
    } catch {
      // Removed in the meantime.
    }
  }
  return files.sort((a, b) => b.takenAt.getTime() - a.takenAt.getTime());
}

/**
 * Removes `.partial` files that a dump killed with its process left behind (a graceful stop
 * removes its own), once they are older than `before`.
 */
export async function removeStalePartials(dir: string, before: Date): Promise<string[]> {
  let names: string[];
  try {
    names = await readdir(dir);
  } catch {
    return [];
  }
  const removed: string[] = [];
  for (const name of names) {
    if (!name.endsWith(PARTIAL) || !parseBackupFileName(name.slice(0, -PARTIAL.length))) continue;
    try {
      const info = await stat(join(dir, name));
      if (info.mtime < before) {
        await rm(join(dir, name), { force: true });
        removed.push(name);
      }
    } catch {
      // Gone already.
    }
  }
  return removed;
}
