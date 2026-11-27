import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import {
  createDatabase,
  createPool,
  migrationSets,
  runMigrations,
  type Database,
} from '@bluepax/db';
import { freshTestDatabase } from '@bluepax/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { audit, listAudit } from '../../audit.ts';
import { totpCode, totpStep } from '../../security/totp.ts';
import {
  AccountError,
  beginTotp,
  confirmTotp,
  createRole,
  createUser,
  deleteRole,
  isEmailAddress,
  listRoles,
  seedDefaultRoles,
  setPassword,
  setUserDisabled,
  updateUser,
} from './accounts.ts';
import {
  can,
  checkCredentials,
  checkTotpLogin,
  createSession,
  loadAuthUser,
  LOCK_DURATION_MS,
  validateSession,
} from './auth.ts';

// Integration test: needs a PostgreSQL server (TEST_DATABASE_URL).
const baseUrl = process.env.TEST_DATABASE_URL;
const migrations = fileURLToPath(
  new URL('../../../../../../../packages/db/migrations', import.meta.url),
);
const PASSWORD = 'correct horse battery staple';
const minutes = (n: number) => n * 60 * 1000;

describe('isEmailAddress', () => {
  // The rule the check replaces; fine for short strings, quadratic on long ones.
  const pattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  it('accepts what the old pattern accepted', () => {
    const samples = [
      'admin@example.com',
      'a@b.c',
      'first.last+tag@sub.example.co',
      'admin@example.COM',
      'a@.b.c',
      'a@b..c',
      'a@b.c.',
      'a@...',
      'nope',
      '@example.com',
      'a@example',
      'a@example.',
      'a@.c',
      'a@@example.com',
      'a@b@example.com',
      'a b@example.com',
      'a@exa mple.com',
      'a@example.com\n',
      '',
    ];
    for (const sample of samples) expect(isEmailAddress(sample), sample).toBe(pattern.test(sample));
  });

  it('refuses addresses longer than 254 characters', () => {
    expect(isEmailAddress(`${'a'.repeat(240)}@example.com`)).toBe(true);
    expect(isEmailAddress(`${'a'.repeat(250)}@example.com`)).toBe(false);
  });

  it('stays fast on long hostile input', () => {
    const started = performance.now();
    expect(isEmailAddress(`a@${'.'.repeat(200_000)} `)).toBe(false);
    expect(isEmailAddress(`a@${'a.'.repeat(100_000)}`)).toBe(false);
    expect(performance.now() - started).toBeLessThan(500);
  });
});

describe.skipIf(!baseUrl)('users module', () => {
  let pool: ReturnType<typeof createPool>;
  let db: Database;
  let adminRoleId: string;
  let editorRoleId: string;
  let adminId: string;
  const key = randomBytes(32);

  beforeAll(async () => {
    pool = createPool(await freshTestDatabase(baseUrl!, 'users'), 4);
    await runMigrations(pool, migrationSets(migrations, []));
    db = createDatabase(pool);
    await seedDefaultRoles(db, ['pages.edit', 'posts.edit']);
    const roles = await listRoles(db);
    adminRoleId = roles.find((r) => r.key === 'admin')!.id;
    editorRoleId = roles.find((r) => r.key === 'editor')!.id;
    adminId = await createUser(db, {
      email: 'Admin@Example.com',
      displayName: 'Admin',
      password: PASSWORD,
      roleId: adminRoleId,
      locale: 'zh',
    });
  });

  afterAll(async () => {
    await pool.end();
  });

  it('seeds the admin and editor roles once', async () => {
    await seedDefaultRoles(db, ['pages.edit']);
    const roles = await listRoles(db);
    expect(roles.map((r) => [r.key, r.system, r.permissions])).toEqual([
      ['admin', true, []],
      ['editor', true, ['pages.edit', 'posts.edit']],
    ]);
  });

  it('validates new accounts and treats e-mail case-insensitively', async () => {
    const base = { displayName: 'X', roleId: editorRoleId, locale: 'en' as const };
    await expect(createUser(db, { ...base, email: 'nope', password: PASSWORD })).rejects.toThrow(
      'invalid_email',
    );
    await expect(
      createUser(db, { ...base, email: 'x@example.com', password: 'short' }),
    ).rejects.toThrow('password_too_short');
    await expect(
      createUser(db, { ...base, email: 'admin@example.COM', password: PASSWORD }),
    ).rejects.toThrow('email_taken');
  });

  it('logs in with the right password only', async () => {
    const now = new Date();
    expect(await checkCredentials(db, ' admin@example.com ', PASSWORD, now)).toEqual({
      kind: 'ok',
      userId: adminId,
    });
    expect(await checkCredentials(db, 'admin@example.com', 'wrong password!!', now)).toEqual({
      kind: 'invalid',
    });
    expect(await checkCredentials(db, 'nobody@example.com', PASSWORD, now)).toEqual({
      kind: 'invalid',
    });
  });

  it('locks an account after 5 failures within 15 minutes, for 15 minutes', async () => {
    const id = await createUser(db, {
      email: 'lock@example.com',
      displayName: 'Lock',
      password: PASSWORD,
      roleId: editorRoleId,
      locale: 'en',
    });
    const t0 = new Date('2026-11-24T10:00:00Z');
    for (let i = 0; i < 5; i++) {
      await checkCredentials(
        db,
        'lock@example.com',
        'wrong password!!',
        new Date(t0.getTime() + i),
      );
    }
    const locked = await checkCredentials(db, 'lock@example.com', PASSWORD, t0);
    expect(locked.kind).toBe('locked');
    const after = new Date(t0.getTime() + LOCK_DURATION_MS + minutes(1));
    expect(await checkCredentials(db, 'lock@example.com', PASSWORD, after)).toEqual({
      kind: 'ok',
      userId: id,
    });
  });

  it('starts counting failures again after the 15-minute window', async () => {
    await createUser(db, {
      email: 'window@example.com',
      displayName: 'Window',
      password: PASSWORD,
      roleId: editorRoleId,
      locale: 'en',
    });
    const t0 = new Date('2026-11-24T11:00:00Z');
    for (let i = 0; i < 4; i++) {
      await checkCredentials(db, 'window@example.com', 'wrong password!!', t0);
    }
    const later = new Date(t0.getTime() + minutes(16));
    await checkCredentials(db, 'window@example.com', 'wrong password!!', later);
    expect((await checkCredentials(db, 'window@example.com', PASSWORD, later)).kind).toBe('ok');
  });

  it('keeps sessions in the database with a sliding 7-day expiry', async () => {
    const t0 = new Date('2026-11-24T12:00:00Z');
    const { token } = await createSession(db, adminId, { ip: '127.0.0.1' }, t0);
    const fresh = await validateSession(db, token, new Date(t0.getTime() + minutes(5)));
    expect(fresh?.user.email).toBe('Admin@Example.com');
    expect(fresh?.refreshed).toBe(false);

    const sixDays = new Date(t0.getTime() + 6 * 24 * 3600 * 1000);
    const slid = await validateSession(db, token, sixDays);
    expect(slid?.refreshed).toBe(true);
    expect(slid?.expiresAt.getTime()).toBe(sixDays.getTime() + 7 * 24 * 3600 * 1000);

    const expired = new Date(sixDays.getTime() + 8 * 24 * 3600 * 1000);
    expect(await validateSession(db, token, expired)).toBeNull();
    expect(await validateSession(db, 'not-a-token', t0)).toBeNull();
  });

  it('ends all other sessions when the password changes or the account is disabled', async () => {
    const id = await createUser(db, {
      email: 'sessions@example.com',
      displayName: 'S',
      password: PASSWORD,
      roleId: editorRoleId,
      locale: 'en',
    });
    const now = new Date();
    const a = await createSession(db, id, {}, now);
    const b = await createSession(db, id, {}, now);
    const keep = (await validateSession(db, a.token, now))!.id;
    await setPassword(db, id, 'another long password', keep);
    expect(await validateSession(db, a.token, now)).not.toBeNull();
    expect(await validateSession(db, b.token, now)).toBeNull();

    await setUserDisabled(db, adminId, id, true);
    expect(await validateSession(db, a.token, now)).toBeNull();
    expect(
      (await checkCredentials(db, 'sessions@example.com', 'another long password', now)).kind,
    ).toBe('invalid');
  });

  it('asks for a TOTP code once enabled and accepts each code only once', async () => {
    const id = await createUser(db, {
      email: 'totp@example.com',
      displayName: 'T',
      password: PASSWORD,
      roleId: editorRoleId,
      locale: 'en',
    });
    const now = new Date('2026-11-24T13:00:00Z');
    const secret = await beginTotp(db, id, key);
    await expect(confirmTotp(db, id, '000000', key, now)).rejects.toThrow('totp_invalid');
    await confirmTotp(db, id, totpCode(secret, totpStep(now)), key, now);

    const later = new Date(now.getTime() + minutes(2));
    expect(await checkCredentials(db, 'totp@example.com', PASSWORD, later)).toEqual({
      kind: 'totp',
      userId: id,
    });
    const code = totpCode(secret, totpStep(later));
    expect(await checkTotpLogin(db, id, code, later, key)).toEqual({ kind: 'ok', userId: id });
    expect(await checkTotpLogin(db, id, code, later, key)).toEqual({ kind: 'invalid' });
    expect((await loadAuthUser(db, id))?.totpEnabled).toBe(true);
  });

  it('always keeps one active admin and never lets you disable or demote yourself', async () => {
    await expect(setUserDisabled(db, adminId, adminId, true)).rejects.toThrow('self');
    await expect(
      updateUser(db, adminId, adminId, { displayName: 'A', roleId: editorRoleId, locale: 'zh' }),
    ).rejects.toThrow('self');

    const second = await createUser(db, {
      email: 'admin2@example.com',
      displayName: 'Admin 2',
      password: PASSWORD,
      roleId: adminRoleId,
      locale: 'en',
    });
    await setUserDisabled(db, second, adminId, true);
    await setUserDisabled(db, second, adminId, false);
    await updateUser(db, adminId, second, {
      displayName: 'Admin 2',
      roleId: editorRoleId,
      locale: 'en',
    });
    await expect(setUserDisabled(db, second, adminId, true)).rejects.toThrow(AccountError);
  });

  it('builds roles from permission points; admin holds everything', async () => {
    const roleId = await createRole(db, {
      key: 'reviewer',
      name: 'Reviewer',
      permissions: ['pages.publish', 'pages.publish'],
    });
    await expect(
      createRole(db, { key: 'reviewer', name: 'Again', permissions: [] }),
    ).rejects.toThrow('role_key_taken');
    await expect(createRole(db, { key: 'Bad Key', name: 'x', permissions: [] })).rejects.toThrow(
      'invalid_role_key',
    );
    const userId = await createUser(db, {
      email: 'reviewer@example.com',
      displayName: 'R',
      password: PASSWORD,
      roleId,
      locale: 'en',
    });
    const reviewer = (await loadAuthUser(db, userId))!;
    expect(can(reviewer, 'pages.publish')).toBe(true);
    expect(can(reviewer, 'users.manage')).toBe(false);
    expect(can((await loadAuthUser(db, adminId))!, 'anything.at_all')).toBe(true);

    await expect(deleteRole(db, roleId)).rejects.toThrow('role_in_use');
    await expect(deleteRole(db, editorRoleId)).rejects.toThrow('system_role');
  });

  it('writes and lists audit entries, newest first', async () => {
    await audit(db, { action: 'auth.login', actorId: adminId, ip: '127.0.0.1' });
    await audit(db, {
      action: 'users.create',
      actorId: adminId,
      targetType: 'user',
      targetId: 'x',
    });
    const entries = await listAudit(db, { limit: 2 });
    expect(entries.map((e) => [e.action, e.actorName])).toEqual([
      ['users.create', 'Admin'],
      ['auth.login', 'Admin'],
    ]);
  });
});
