// Account and role management (chapter 3): accounts are created by admins only, a role is a
// set of permission points, and the instance always keeps at least one active admin.
import { schema, type Database } from '@bluepax/db';
import { and, asc, count, eq, isNull } from 'drizzle-orm';
import { decrypt, encrypt } from '../../security/crypto.ts';
import {
  checkPassword,
  hashPassword,
  verifyPassword,
  type PasswordProblem,
} from '../../security/password.ts';
import { generateTotpSecret, verifyTotp } from '../../security/totp.ts';
import { ADMIN_ROLE, EDITOR_ROLE, revokeUserSessions, type AdminLocale } from './auth.ts';

export type AccountErrorCode =
  | 'email_taken'
  | 'invalid_email'
  | 'password_too_short'
  | 'password_too_long'
  | 'last_admin'
  | 'self'
  | 'not_found'
  | 'role_key_taken'
  | 'invalid_role_key'
  | 'role_in_use'
  | 'system_role'
  | 'totp_invalid';

export class AccountError extends Error {
  override name = 'AccountError';
  readonly code: AccountErrorCode;

  constructor(code: AccountErrorCode) {
    super(code);
    this.code = code;
  }
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ROLE_KEY = /^[a-z][a-z0-9_-]{1,31}$/;

function passwordError(problem: PasswordProblem): AccountError {
  return new AccountError(problem === 'too_short' ? 'password_too_short' : 'password_too_long');
}

function isUniqueViolation(error: unknown): boolean {
  const cause = (error as { cause?: { code?: string } }).cause ?? error;
  return (cause as { code?: string }).code === '23505';
}

// ---------------------------------------------------------------- roles

/** Creates the default roles if they are missing; the editor gets `editorPermissions`. */
export async function seedDefaultRoles(db: Database, editorPermissions: string[]): Promise<void> {
  await db
    .insert(schema.roles)
    .values([
      { key: ADMIN_ROLE, name: 'Administrator', system: true },
      { key: EDITOR_ROLE, name: 'Editor', system: true },
    ])
    .onConflictDoNothing({ target: schema.roles.key });
  const [editor] = await db
    .select({ id: schema.roles.id })
    .from(schema.roles)
    .where(eq(schema.roles.key, EDITOR_ROLE));
  if (editor && editorPermissions.length > 0) {
    await db
      .insert(schema.rolePermissions)
      .values(editorPermissions.map((permission) => ({ roleId: editor.id, permission })))
      .onConflictDoNothing();
  }
}

export async function listRoles(db: Database) {
  const roles = await db
    .select({
      id: schema.roles.id,
      key: schema.roles.key,
      name: schema.roles.name,
      system: schema.roles.system,
      users: count(schema.users.id),
    })
    .from(schema.roles)
    .leftJoin(schema.users, eq(schema.users.roleId, schema.roles.id))
    .groupBy(schema.roles.id)
    .orderBy(asc(schema.roles.createdAt), asc(schema.roles.key));
  const permissions = await db.select().from(schema.rolePermissions);
  return roles.map((r) => ({
    ...r,
    permissions: permissions
      .filter((p) => p.roleId === r.id)
      .map((p) => p.permission)
      .sort(),
  }));
}

async function setRolePermissions(db: Database, roleId: string, permissions: string[]) {
  await db.transaction(async (tx) => {
    await tx.delete(schema.rolePermissions).where(eq(schema.rolePermissions.roleId, roleId));
    if (permissions.length > 0) {
      await tx
        .insert(schema.rolePermissions)
        .values([...new Set(permissions)].map((permission) => ({ roleId, permission })));
    }
  });
}

export async function createRole(
  db: Database,
  input: { key: string; name: string; permissions: string[] },
): Promise<string> {
  if (!ROLE_KEY.test(input.key)) throw new AccountError('invalid_role_key');
  try {
    const [role] = await db
      .insert(schema.roles)
      .values({ key: input.key, name: input.name.trim() || input.key })
      .returning({ id: schema.roles.id });
    await setRolePermissions(db, role!.id, input.permissions);
    return role!.id;
  } catch (error) {
    if (isUniqueViolation(error)) throw new AccountError('role_key_taken');
    throw error;
  }
}

export async function updateRole(
  db: Database,
  id: string,
  input: { name: string; permissions: string[] },
): Promise<void> {
  const [role] = await db.select().from(schema.roles).where(eq(schema.roles.id, id));
  if (!role) throw new AccountError('not_found');
  await db
    .update(schema.roles)
    .set({ name: input.name.trim() || role.name, updatedAt: new Date() })
    .where(eq(schema.roles.id, id));
  // The admin role always holds every permission; its list is not stored.
  if (role.key !== ADMIN_ROLE) await setRolePermissions(db, id, input.permissions);
}

export async function deleteRole(db: Database, id: string): Promise<void> {
  const [role] = await db.select().from(schema.roles).where(eq(schema.roles.id, id));
  if (!role) throw new AccountError('not_found');
  if (role.system) throw new AccountError('system_role');
  const [used] = await db
    .select({ n: count() })
    .from(schema.users)
    .where(eq(schema.users.roleId, id));
  if ((used?.n ?? 0) > 0) throw new AccountError('role_in_use');
  await db.delete(schema.roles).where(eq(schema.roles.id, id));
}

// ---------------------------------------------------------------- users

async function activeAdminIds(db: Database): Promise<string[]> {
  const rows = await db
    .select({ id: schema.users.id })
    .from(schema.users)
    .innerJoin(schema.roles, eq(schema.roles.id, schema.users.roleId))
    .where(and(eq(schema.roles.key, ADMIN_ROLE), isNull(schema.users.disabledAt)));
  return rows.map((r) => r.id);
}

async function roleKeyOf(db: Database, roleId: string): Promise<string> {
  const [role] = await db
    .select({ key: schema.roles.key })
    .from(schema.roles)
    .where(eq(schema.roles.id, roleId));
  if (!role) throw new AccountError('not_found');
  return role.key;
}

export async function listUsers(db: Database) {
  return db
    .select({
      id: schema.users.id,
      email: schema.users.email,
      displayName: schema.users.displayName,
      roleName: schema.roles.name,
      roleKey: schema.roles.key,
      locale: schema.users.locale,
      disabledAt: schema.users.disabledAt,
      lockedUntil: schema.users.lockedUntil,
      totpEnabledAt: schema.users.totpEnabledAt,
      lastLoginAt: schema.users.lastLoginAt,
    })
    .from(schema.users)
    .innerJoin(schema.roles, eq(schema.roles.id, schema.users.roleId))
    .orderBy(asc(schema.users.createdAt));
}

export async function getUser(db: Database, id: string) {
  const [user] = await db
    .select({
      id: schema.users.id,
      email: schema.users.email,
      displayName: schema.users.displayName,
      roleId: schema.users.roleId,
      locale: schema.users.locale,
      disabledAt: schema.users.disabledAt,
      lockedUntil: schema.users.lockedUntil,
      totpEnabledAt: schema.users.totpEnabledAt,
      lastLoginAt: schema.users.lastLoginAt,
      createdAt: schema.users.createdAt,
    })
    .from(schema.users)
    .where(eq(schema.users.id, id));
  return user ?? null;
}

export interface NewUser {
  email: string;
  displayName: string;
  password: string;
  roleId: string;
  locale: AdminLocale;
}

export async function createUser(db: Database, input: NewUser): Promise<string> {
  const email = input.email.trim();
  if (!EMAIL.test(email)) throw new AccountError('invalid_email');
  const problem = checkPassword(input.password);
  if (problem) throw passwordError(problem);
  await roleKeyOf(db, input.roleId);
  try {
    const [user] = await db
      .insert(schema.users)
      .values({
        email,
        displayName: input.displayName.trim() || email,
        passwordHash: await hashPassword(input.password),
        roleId: input.roleId,
        locale: input.locale,
      })
      .returning({ id: schema.users.id });
    return user!.id;
  } catch (error) {
    if (isUniqueViolation(error)) throw new AccountError('email_taken');
    throw error;
  }
}

export async function updateUser(
  db: Database,
  actorId: string,
  id: string,
  input: { displayName: string; roleId: string; locale: AdminLocale },
): Promise<void> {
  const user = await getUser(db, id);
  if (!user) throw new AccountError('not_found');
  if (input.roleId !== user.roleId) {
    if (id === actorId) throw new AccountError('self');
    const admins = await activeAdminIds(db);
    const newKey = await roleKeyOf(db, input.roleId);
    if (newKey !== ADMIN_ROLE && admins.length === 1 && admins[0] === id) {
      throw new AccountError('last_admin');
    }
  }
  await db
    .update(schema.users)
    .set({
      displayName: input.displayName.trim() || user.email,
      roleId: input.roleId,
      locale: input.locale,
      updatedAt: new Date(),
    })
    .where(eq(schema.users.id, id));
}

/** Disabling ends every session of the account at once. */
export async function setUserDisabled(
  db: Database,
  actorId: string,
  id: string,
  disabled: boolean,
): Promise<void> {
  const user = await getUser(db, id);
  if (!user) throw new AccountError('not_found');
  if (disabled) {
    if (id === actorId) throw new AccountError('self');
    const admins = await activeAdminIds(db);
    if (admins.length === 1 && admins[0] === id) throw new AccountError('last_admin');
  }
  await db
    .update(schema.users)
    .set({ disabledAt: disabled ? new Date() : null, updatedAt: new Date() })
    .where(eq(schema.users.id, id));
  if (disabled) await revokeUserSessions(db, id);
}

/** Sets a new password and ends every session except `keepSessionId` (the caller's own). */
export async function setPassword(
  db: Database,
  id: string,
  password: string,
  keepSessionId?: string,
): Promise<void> {
  const problem = checkPassword(password);
  if (problem) throw passwordError(problem);
  const result = await db
    .update(schema.users)
    .set({
      passwordHash: await hashPassword(password),
      passwordChangedAt: new Date(),
      failedLoginCount: 0,
      failedLoginAt: null,
      lockedUntil: null,
      updatedAt: new Date(),
    })
    .where(eq(schema.users.id, id))
    .returning({ id: schema.users.id });
  if (result.length === 0) throw new AccountError('not_found');
  await revokeUserSessions(db, id, keepSessionId);
}

export async function unlockUser(db: Database, id: string): Promise<void> {
  await db
    .update(schema.users)
    .set({ lockedUntil: null, failedLoginCount: 0, failedLoginAt: null })
    .where(eq(schema.users.id, id));
}

export async function setOwnProfile(
  db: Database,
  id: string,
  input: { displayName: string; locale: AdminLocale },
): Promise<void> {
  const displayName = input.displayName.trim();
  await db
    .update(schema.users)
    .set({ ...(displayName ? { displayName } : {}), locale: input.locale, updatedAt: new Date() })
    .where(eq(schema.users.id, id));
}

// ---------------------------------------------------------------- TOTP enrolment

/** Stores a new, not yet confirmed secret and returns it for the authenticator app. */
export async function beginTotp(db: Database, id: string, encryptionKey: Buffer): Promise<string> {
  const secret = generateTotpSecret();
  await db
    .update(schema.users)
    .set({ totpSecret: encrypt(secret, encryptionKey), totpEnabledAt: null, totpLastStep: null })
    .where(and(eq(schema.users.id, id), isNull(schema.users.totpEnabledAt)));
  return secret;
}

export async function pendingTotpSecret(
  db: Database,
  id: string,
  encryptionKey: Buffer,
): Promise<string | null> {
  const [user] = await db
    .select({ secret: schema.users.totpSecret, enabledAt: schema.users.totpEnabledAt })
    .from(schema.users)
    .where(eq(schema.users.id, id));
  if (!user?.secret || user.enabledAt) return null;
  return decrypt(user.secret, encryptionKey);
}

export async function confirmTotp(
  db: Database,
  id: string,
  code: string,
  encryptionKey: Buffer,
  now: Date,
): Promise<void> {
  const secret = await pendingTotpSecret(db, id, encryptionKey);
  const step = secret ? verifyTotp(secret, code, now, null) : null;
  if (step === null) throw new AccountError('totp_invalid');
  await db
    .update(schema.users)
    .set({ totpEnabledAt: now, totpLastStep: step })
    .where(eq(schema.users.id, id));
}

export async function disableTotp(db: Database, id: string): Promise<void> {
  await db
    .update(schema.users)
    .set({ totpSecret: null, totpEnabledAt: null, totpLastStep: null })
    .where(eq(schema.users.id, id));
}

/** Checks a user's own password, e.g. before changing it or turning off two-step verification. */
export async function verifyUserPassword(
  db: Database,
  id: string,
  password: string,
): Promise<boolean> {
  const [user] = await db
    .select({ hash: schema.users.passwordHash })
    .from(schema.users)
    .where(eq(schema.users.id, id));
  return user ? verifyPassword(user.hash, password) : false;
}
