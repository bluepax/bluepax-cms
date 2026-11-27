// Tables of the api module, see docs/spec/README.md chapters 3, 4 and 6 and docs/adr/0012.
// One instance serves one frontend: its base URL is configuration (`frontend.baseUrl`), its
// secrets live here. Tokens are stored as hashes only and shown once (chapter 9).
import { sql } from 'drizzle-orm';
import {
  check,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { users } from './core.ts';

const timestamptz = (name: string) => timestamp(name, { withTimezone: true });

/** Scopes of a Delivery Token (chapter 6). */
export const DELIVERY_SCOPES = ['delivery:read', 'events:write'] as const;
export type DeliveryScope = (typeof DELIVERY_SCOPES)[number];

/**
 * The frontend's secrets; at most one row. The preview secret signs preview links (encrypted
 * with ENCRYPTION_KEY, since the CMS signs with it). The webhook URL and secret follow with
 * webhooks (M2), the form key with `inquiries` (M4).
 */
export const frontends = pgTable(
  'frontends',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** Always `default`: one frontend per instance (chapter 1). */
    key: text('key').notNull().default('default'),
    previewSecret: text('preview_secret'),
    previewSecretChangedAt: timestamptz('preview_secret_changed_at'),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
    updatedAt: timestamptz('updated_at').notNull().defaultNow(),
  },
  (t) => [uniqueIndex('frontends_key_unique').on(t.key)],
);

/** API tokens. Only Delivery Tokens in M1; Management Tokens follow with the Management API. */
export const apiTokens = pgTable(
  'api_tokens',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** `delivery`. */
    kind: text('kind').notNull(),
    /** Label chosen by the admin, e.g. `production`. */
    name: text('name').notNull(),
    /** The first characters of the token, shown in lists to tell tokens apart. */
    prefix: text('prefix').notNull(),
    /** SHA-256 of the token, hex; the token itself is never stored. */
    tokenHash: text('token_hash').notNull(),
    scopes: jsonb('scopes').$type<string[]>().notNull(),
    expiresAt: timestamptz('expires_at'),
    /** Updated at most once a minute. */
    lastUsedAt: timestamptz('last_used_at'),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
    revokedAt: timestamptz('revoked_at'),
    revokedBy: uuid('revoked_by').references(() => users.id, { onDelete: 'set null' }),
  },
  (t) => [
    uniqueIndex('api_tokens_hash_unique').on(t.tokenHash),
    index('api_tokens_kind_idx').on(t.kind, t.createdAt.desc()),
    check('api_tokens_kind_check', sql`${t.kind} in ('delivery')`),
  ],
);
