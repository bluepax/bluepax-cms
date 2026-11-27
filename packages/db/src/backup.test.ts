import { chmod, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BackupError, dumpDatabase, pgDumpInvocation } from './backup.ts';

describe('pgDumpInvocation', () => {
  it('moves the password from the URL to PGPASSWORD', () => {
    const { args, env } = pgDumpInvocation(
      'postgres://blue%40pax:p%40ss%2Fword@db.internal:5432/bluepax?sslmode=require',
      '/data/backups/x.dump',
    );
    expect(args).toEqual([
      '--format=custom',
      '--no-password',
      '--file=/data/backups/x.dump',
      '--dbname=postgres://blue%40pax@db.internal:5432/bluepax?sslmode=require',
    ]);
    expect(env).toEqual({ PGPASSWORD: 'p@ss/word' });
    expect(args.join(' ')).not.toContain('p%40ss');
  });

  it('passes no password when the URL has none', () => {
    expect(pgDumpInvocation('postgresql://bluepax@127.0.0.1/bluepax', 'x').env).toEqual({});
  });

  it('refuses a value that is not a URL', () => {
    expect(() => pgDumpInvocation('host=db user=x', 'x')).toThrow(BackupError);
  });
});

// A stand-in for pg_dump: records its arguments and PGPASSWORD, then writes the --file target
// or fails like pg_dump does.
const FAKE = `#!/usr/bin/env node
const fs = require('node:fs');
const file = process.argv.find((a) => a.startsWith('--file=')).slice(7);
if (process.env.FAKE_FAIL) {
  fs.writeFileSync(file, 'half');
  process.stderr.write('pg_dump: error: connection to server failed\\n');
  process.exit(1);
}
fs.writeFileSync(file, JSON.stringify({ args: process.argv.slice(2), password: process.env.PGPASSWORD }));
`;

describe('dumpDatabase', () => {
  let dir: string;
  let command: string;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'bluepax-backup-'));
    command = join(dir, 'fake-pg-dump.cjs');
    await writeFile(command, FAKE);
    await chmod(command, 0o755);
  });

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
    delete process.env.FAKE_FAIL;
  });

  it('writes the dump through a partial file and reports its size', async () => {
    const file = join(dir, 'out', 'pre-migrate.dump');
    const result = await dumpDatabase({
      databaseUrl: 'postgres://bluepax:secret@db:5432/bluepax',
      file,
      command,
    });
    expect(result.file).toBe(file);
    expect(result.bytes).toBeGreaterThan(0);
    const written = JSON.parse(await readFile(file, 'utf8')) as {
      args: string[];
      password: string;
    };
    expect(written.password).toBe('secret');
    expect(written.args).toContain(`--file=${file}.partial`);
    expect(await readdir(join(dir, 'out'))).toEqual(['pre-migrate.dump']);
  });

  it('fails with pg_dump’s message and leaves no file behind', async () => {
    process.env.FAKE_FAIL = '1';
    const file = join(dir, 'failed', 'pre-migrate.dump');
    await expect(
      dumpDatabase({ databaseUrl: 'postgres://bluepax@db/bluepax', file, command }),
    ).rejects.toThrow(/exited with code 1: pg_dump: error: connection to server failed/);
    expect(await readdir(join(dir, 'failed'))).toEqual([]);
    delete process.env.FAKE_FAIL;
  });

  it('says so when pg_dump is not installed', async () => {
    await expect(
      dumpDatabase({
        databaseUrl: 'postgres://bluepax@db/bluepax',
        file: join(dir, 'missing', 'x.dump'),
        command: join(dir, 'no-such-pg-dump'),
      }),
    ).rejects.toThrow(/is not installed/);
  });
});
