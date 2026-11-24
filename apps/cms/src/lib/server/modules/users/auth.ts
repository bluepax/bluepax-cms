// Login, lockout and sessions, see docs/spec/README.md chapters 3, 9 and 13:
// Argon2id passwords, optional TOTP, 5 failures in 15 minutes lock the account for 15 minutes,
// sessions are stored in the database and expire 7 days after the last activity.
import { schema, type Database } from '@bluepax/db';
import { and, asc, eq, gt, isNull, ne, sql } from 'drizzle-orm';
import { decrypt, randomToken, sha256Hex } from '../../security/crypto.ts';
import { verifyAgainstDummy, verifyPassword } from '../../security/password.ts';
import { verifyTotp } from '../../security/totp.ts';

export const ADMIN_ROLE = 'admin';
export const EDITOR_ROLE = 'editor';

export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
/** Sliding expiry is written at most this often, not on every request. */
const SESSION_REFRESH_MS = 60 * 60 * 1000;
export const LOCK_WINDOW_MS = 15 * 60 * 1000;
export const LOCK_THRESHOLD = 5;
export const LOCK_DURATION_MS = 15 * 60 * 1000;

export type AdminLocale = 'en' | 'zh';

export interface AuthUser {
  id: string;
  email: string;
  displayName: string;
  locale: AdminLocale;
  role: { id: string; key: string; name: string };
  permissions: ReadonlySet<string>;
  totpEnabled: boolean;
}

/** The admin role holds every permission, including those of modules added later. */
export function can(user: Pick<AuthUser, 'role' | 'permissions'>, permission: string): boolean {
  return user.role.key === ADMIN_ROLE || user.permissions.has(permission);
}

export async function loadAuthUser(db: Database, userId: string): Promise<AuthUser | null> {
  const [row] = await db
    .select({
      id: schema.users.id,
      email: schema.users.email,
      displayName: schema.users.displayName,
      locale: schema.users.locale,
      totpEnabledAt: schema.users.totpEnabledAt,
      roleId: schema.roles.id,
      roleKey: schema.roles.key,
      roleName: schema.roles.name,
    })
    .from(schema.users)
    .innerJoin(schema.roles, eq(schema.roles.id, schema.users.roleId))
    .where(and(eq(schema.users.id, userId), isNull(schema.users.disabledAt)));
  if (!row) return null;
  const permissions = await db
    .select({ permission: schema.rolePermissions.permission })
    .from(schema.rolePermissions)
    .where(eq(schema.rolePermissions.roleId, row.roleId));
  return {
    id: row.id,
    email: row.email,
    displayName: row.displayName,
    locale: row.locale === 'zh' ? 'zh' : 'en',
    role: { id: row.roleId, key: row.roleKey, name: row.roleName },
    permissions: new Set(permissions.map((p) => p.permission)),
    totpEnabled: row.totpEnabledAt !== null,
  };
}

export type LoginResult =
  | { kind: 'ok'; userId: string }
  | { kind: 'totp'; userId: string }
  | { kind: 'invalid' }
  | { kind: 'locked'; until: Date };

async function recordFailure(db: Database, userId: string, now: Date): Promise<void> {
  const windowStart = new Date(now.getTime() - LOCK_WINDOW_MS);
  const [row] = await db
    .update(schema.users)
    .set({
      failedLoginCount: sql`case when ${schema.users.failedLoginAt} > ${windowStart} then ${schema.users.failedLoginCount} + 1 else 1 end`,
      failedLoginAt: now,
    })
    .where(eq(schema.users.id, userId))
    .returning({ count: schema.users.failedLoginCount });
  if (row && row.count >= LOCK_THRESHOLD) {
    await db
      .update(schema.users)
      .set({
        lockedUntil: new Date(now.getTime() + LOCK_DURATION_MS),
        failedLoginCount: 0,
        failedLoginAt: null,
      })
      .where(eq(schema.users.id, userId));
  }
}

async function recordSuccess(db: Database, userId: string, now: Date): Promise<void> {
  await db
    .update(schema.users)
    .set({ failedLoginCount: 0, failedLoginAt: null, lockedUntil: null, lastLoginAt: now })
    .where(eq(schema.users.id, userId));
}

/** First step of a login. Unknown, disabled and wrong-password accounts all answer `invalid`. */
export async function checkCredentials(
  db: Database,
  email: string,
  password: string,
  now: Date,
): Promise<LoginResult> {
  const [user] = await db
    .select()
    .from(schema.users)
    .where(sql`lower(${schema.users.email}) = lower(${email.trim()})`);
  if (!user || user.disabledAt)
    return verifyAgainstDummy(password).then(() => ({ kind: 'invalid' }));
  if (user.lockedUntil && user.lockedUntil > now)
    return { kind: 'locked', until: user.lockedUntil };
  if (!(await verifyPassword(user.passwordHash, password))) {
    await recordFailure(db, user.id, now);
    return { kind: 'invalid' };
  }
  if (user.totpEnabledAt && user.totpSecret) return { kind: 'totp', userId: user.id };
  await recordSuccess(db, user.id, now);
  return { kind: 'ok', userId: user.id };
}

/** Second step of a login with TOTP. A wrong code counts as a failed login. */
export async function checkTotpLogin(
  db: Database,
  userId: string,
  code: string,
  now: Date,
  encryptionKey: Buffer,
): Promise<LoginResult> {
  const [user] = await db.select().from(schema.users).where(eq(schema.users.id, userId));
  if (!user || user.disabledAt || !user.totpEnabledAt || !user.totpSecret) {
    return { kind: 'invalid' };
  }
  if (user.lockedUntil && user.lockedUntil > now)
    return { kind: 'locked', until: user.lockedUntil };
  const step = verifyTotp(decrypt(user.totpSecret, encryptionKey), code, now, user.totpLastStep);
  if (step === null) {
    await recordFailure(db, user.id, now);
    return { kind: 'invalid' };
  }
  await db.update(schema.users).set({ totpLastStep: step }).where(eq(schema.users.id, user.id));
  await recordSuccess(db, user.id, now);
  return { kind: 'ok', userId: user.id };
}

export interface SessionInfo {
  ip?: string | null;
  userAgent?: string | null;
}

export async function createSession(
  db: Database,
  userId: string,
  info: SessionInfo,
  now: Date,
): Promise<{ token: string; expiresAt: Date }> {
  const token = randomToken(32);
  const expiresAt = new Date(now.getTime() + SESSION_TTL_MS);
  await db.insert(schema.sessions).values({
    id: sha256Hex(token),
    userId,
    createdAt: now,
    lastSeenAt: now,
    expiresAt,
    ip: info.ip ?? null,
    userAgent: info.userAgent?.slice(0, 512) ?? null,
  });
  return { token, expiresAt };
}

export interface ValidSession {
  id: string;
  user: AuthUser;
  expiresAt: Date;
  /** True when the expiry moved and the cookie should be sent again. */
  refreshed: boolean;
}

export async function validateSession(
  db: Database,
  token: string,
  now: Date,
): Promise<ValidSession | null> {
  const id = sha256Hex(token);
  const [session] = await db.select().from(schema.sessions).where(eq(schema.sessions.id, id));
  if (!session) return null;
  if (session.expiresAt <= now) {
    await db.delete(schema.sessions).where(eq(schema.sessions.id, id));
    return null;
  }
  const user = await loadAuthUser(db, session.userId);
  if (!user) {
    await db.delete(schema.sessions).where(eq(schema.sessions.id, id));
    return null;
  }
  if (now.getTime() - session.lastSeenAt.getTime() < SESSION_REFRESH_MS) {
    return { id, user, expiresAt: session.expiresAt, refreshed: false };
  }
  const expiresAt = new Date(now.getTime() + SESSION_TTL_MS);
  await db
    .update(schema.sessions)
    .set({ lastSeenAt: now, expiresAt })
    .where(eq(schema.sessions.id, id));
  return { id, user, expiresAt, refreshed: true };
}

export async function revokeSession(db: Database, token: string): Promise<void> {
  await db.delete(schema.sessions).where(eq(schema.sessions.id, sha256Hex(token)));
}

export async function revokeSessionById(db: Database, userId: string, id: string): Promise<void> {
  await db
    .delete(schema.sessions)
    .where(and(eq(schema.sessions.id, id), eq(schema.sessions.userId, userId)));
}

/** Ends every session of a user, optionally keeping one (the caller's own). */
export async function revokeUserSessions(
  db: Database,
  userId: string,
  exceptId?: string,
): Promise<void> {
  await db
    .delete(schema.sessions)
    .where(
      and(
        eq(schema.sessions.userId, userId),
        exceptId ? ne(schema.sessions.id, exceptId) : undefined,
      ),
    );
}

export async function listSessions(db: Database, userId: string, now: Date) {
  return db
    .select({
      id: schema.sessions.id,
      createdAt: schema.sessions.createdAt,
      lastSeenAt: schema.sessions.lastSeenAt,
      expiresAt: schema.sessions.expiresAt,
      ip: schema.sessions.ip,
      userAgent: schema.sessions.userAgent,
    })
    .from(schema.sessions)
    .where(and(eq(schema.sessions.userId, userId), gt(schema.sessions.expiresAt, now)))
    .orderBy(asc(schema.sessions.createdAt));
}
