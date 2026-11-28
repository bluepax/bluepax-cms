// Full database dumps with pg_dump, see docs/spec/README.md chapter 9 ("启动顺序",
// "备份与可观测") and docs/adr/0015. The image ships the PostgreSQL 18 client, which can dump
// servers from 16 on (pg_dump must not be older than the server).
import { spawn } from 'node:child_process';
import { mkdir, rename, rm, stat } from 'node:fs/promises';
import { dirname } from 'node:path';

export class BackupError extends Error {
  override name = 'BackupError';
}

export interface PgDumpInvocation {
  args: string[];
  /** Extra environment for pg_dump: the password never goes on the command line. */
  env: Record<string, string>;
}

/**
 * Arguments for a full dump in pg_dump's custom format (compressed, restored with
 * pg_restore). The connection comes from DATABASE_URL, which libpq reads as a URI; the
 * password moves to PGPASSWORD so it does not show up in the process list.
 */
export function pgDumpInvocation(databaseUrl: string, file: string): PgDumpInvocation {
  let url: URL;
  try {
    url = new URL(databaseUrl);
  } catch {
    throw new BackupError('DATABASE_URL is not a valid URL');
  }
  const password = url.password ? decodeURIComponent(url.password) : '';
  url.password = '';
  return {
    args: ['--format=custom', '--no-password', `--file=${file}`, `--dbname=${url.href}`],
    env: password ? { PGPASSWORD: password } : {},
  };
}

export interface DumpOptions {
  databaseUrl: string;
  /** Target file; written as `<file>.partial` first and renamed once pg_dump succeeded. */
  file: string;
  /** The pg_dump executable, `pg_dump` on PATH by default. */
  command?: string;
  /** Stops pg_dump (SIGTERM) and fails the dump, e.g. when a job runs out of time. */
  signal?: AbortSignal;
  /** How long pg_dump may take to exit after SIGTERM before it is killed (SIGKILL); 5 s. */
  killAfterMs?: number;
}

export interface DumpResult {
  file: string;
  bytes: number;
}

const STDERR_LIMIT = 4096;
const KILL_AFTER_MS = 5_000;

/**
 * Runs the command and settles only once it has exited, also when the signal stops it: until
 * then it may still create or write its output file, which the caller removes afterwards.
 */
function run(
  command: string,
  args: string[],
  env: Record<string, string>,
  signal: AbortSignal | undefined,
  killAfterMs: number,
): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new BackupError(`${command} was not started: the backup was cancelled`));
      return;
    }
    const child = spawn(command, args, {
      env: { ...process.env, ...env },
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    let stderr = '';
    let stopped: BackupError | undefined;
    let killTimer: NodeJS.Timeout | undefined;
    let settled = false;
    const stop = () => {
      stopped = new BackupError(`${command} was stopped: the backup was cancelled`);
      child.kill('SIGTERM');
      killTimer = setTimeout(() => child.kill('SIGKILL'), killAfterMs);
    };
    const settle = (error?: Error) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener('abort', stop);
      clearTimeout(killTimer);
      if (error) reject(error);
      else resolve();
    };
    signal?.addEventListener('abort', stop, { once: true });
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => {
      stderr = (stderr + chunk).slice(-STDERR_LIMIT);
    });
    child.on('error', (error: NodeJS.ErrnoException) => {
      // Only a process that never started has nothing to wait for; 'close' follows otherwise.
      if (child.pid !== undefined) return;
      settle(
        error.code === 'ENOENT'
          ? new BackupError(`${command} is not installed (it comes with the PostgreSQL client)`)
          : error,
      );
    });
    child.on('close', (code, killedBy) => {
      if (stopped) settle(stopped);
      else if (code === 0) settle();
      else {
        const reason = killedBy ? `was killed by ${killedBy}` : `exited with code ${code}`;
        settle(new BackupError(`${command} ${reason}: ${stderr.trim() || 'no output'}`));
      }
    });
  });
}

/** Writes a full dump of the database; a failed dump leaves no file behind. */
export async function dumpDatabase(options: DumpOptions): Promise<DumpResult> {
  const partial = `${options.file}.partial`;
  await mkdir(dirname(options.file), { recursive: true });
  const { args, env } = pgDumpInvocation(options.databaseUrl, partial);
  try {
    await run(
      options.command ?? 'pg_dump',
      args,
      env,
      options.signal,
      options.killAfterMs ?? KILL_AFTER_MS,
    );
    await rename(partial, options.file);
  } catch (error) {
    await rm(partial, { force: true });
    throw error;
  }
  return { file: options.file, bytes: (await stat(options.file)).size };
}
