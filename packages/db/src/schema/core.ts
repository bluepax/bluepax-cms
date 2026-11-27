// Core tables shared by all modules, see docs/spec/README.md chapter 4.
// Times are always stored as timestamptz (UTC).
import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

const timestamptz = (name: string) => timestamp(name, { withTimezone: true });

const timestamps = {
  createdAt: timestamptz('created_at').notNull().defaultNow(),
  updatedAt: timestamptz('updated_at').notNull().defaultNow(),
};

/** Instance settings, one row per key. */
export const settings = pgTable('settings', {
  key: text('key').primaryKey(),
  value: jsonb('value').notNull(),
  updatedAt: timestamptz('updated_at').notNull().defaultNow(),
});

/** Switch state of the optional modules. Core modules are always on and have no row. */
export const instanceModules = pgTable('instance_modules', {
  moduleId: text('module_id').primaryKey(),
  enabled: boolean('enabled').notNull(),
  updatedAt: timestamptz('updated_at').notNull().defaultNow(),
});

/**
 * A role is a set of permission points (chapter 3, "角色"). The system role `admin` holds
 * every permission implicitly, including those of modules added later.
 */
export const roles = pgTable('roles', {
  id: uuid('id').primaryKey().defaultRandom(),
  key: text('key').notNull().unique(),
  name: text('name').notNull(),
  /** Default roles (admin, editor) cannot be deleted. */
  system: boolean('system').notNull().default(false),
  ...timestamps,
});

export const rolePermissions = pgTable(
  'role_permissions',
  {
    roleId: uuid('role_id')
      .notNull()
      .references(() => roles.id, { onDelete: 'cascade' }),
    permission: text('permission').notNull(),
  },
  (t) => [primaryKey({ columns: [t.roleId, t.permission] })],
);

/** Admin accounts. Accounts are only created by admins; there is no sign-up. */
export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    email: text('email').notNull(),
    displayName: text('display_name').notNull(),
    /** Argon2id hash. */
    passwordHash: text('password_hash').notNull(),
    passwordChangedAt: timestamptz('password_changed_at').notNull().defaultNow(),
    roleId: uuid('role_id')
      .notNull()
      .references(() => roles.id),
    /** Admin UI language: `zh` or `en`. */
    locale: text('locale').notNull().default('en'),
    disabledAt: timestamptz('disabled_at'),
    /** Failed logins in the current window, see `failedLoginAt`. */
    failedLoginCount: integer('failed_login_count').notNull().default(0),
    failedLoginAt: timestamptz('failed_login_at'),
    lockedUntil: timestamptz('locked_until'),
    /** TOTP secret, encrypted with ENCRYPTION_KEY. */
    totpSecret: text('totp_secret'),
    totpEnabledAt: timestamptz('totp_enabled_at'),
    /** Last accepted TOTP time step, so a code cannot be used twice. */
    totpLastStep: bigint('totp_last_step', { mode: 'number' }),
    lastLoginAt: timestamptz('last_login_at'),
    ...timestamps,
  },
  (t) => [uniqueIndex('users_email_lower_unique').on(sql`lower(${t.email})`)],
);

/** Sessions are stored in the database; the cookie holds a random token, the row its hash. */
export const sessions = pgTable(
  'sessions',
  {
    /** SHA-256 of the session token, hex. */
    id: text('id').primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
    lastSeenAt: timestamptz('last_seen_at').notNull().defaultNow(),
    expiresAt: timestamptz('expires_at').notNull(),
    ip: text('ip'),
    userAgent: text('user_agent'),
  },
  (t) => [index('sessions_user_idx').on(t.userId), index('sessions_expires_idx').on(t.expiresAt)],
);

/** Audit log (chapter 9): logins, permissions, settings, publishing, deletions, tokens, storage. */
export const auditLog = pgTable(
  'audit_log',
  {
    id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    at: timestamptz('at').notNull().defaultNow(),
    actorId: uuid('actor_id').references(() => users.id, { onDelete: 'set null' }),
    /** `<area>.<event>`, for example `auth.login` or `users.create`. */
    action: text('action').notNull(),
    targetType: text('target_type'),
    targetId: text('target_id'),
    details: jsonb('details').notNull().default({}),
    ip: text('ip'),
  },
  (t) => [index('audit_log_at_idx').on(t.at.desc()), index('audit_log_actor_idx').on(t.actorId)],
);
