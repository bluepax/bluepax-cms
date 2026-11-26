// Delivery Tokens (docs/spec/README.md chapters 6 and 9, docs/adr/0012): issued on the "接入与
// API" page for the one frontend, scoped (`delivery:read`, `events:write`), stored as a SHA-256
// hash only and shown once. Rotating means issuing a new token, switching the frontend over and
// revoking the old one; both work in between. Issuing and revoking are audited.
import {
  DELIVERY_SCOPES,
  schema,
  type Database,
  type DeliveryScope,
  type Executor,
} from '@bluepax/db';
import { and, desc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { audit } from '../../audit.ts';
import { randomToken, sha256Hex } from '../../security/crypto.ts';
import { InvalidInputError, parseInput } from '../site/values.ts';

export interface Actor {
  id: string;
  ip: string | null;
}

/** Every Delivery Token starts with this, so a leaked one is easy to recognise. */
export const DELIVERY_TOKEN_PREFIX = 'bpxd_';
/** Characters of the token shown in lists (the prefix and a few random ones). */
const SHOWN_LENGTH = DELIVERY_TOKEN_PREFIX.length + 6;
/** Active tokens at the same time: enough for a rotation, few enough to keep track. */
export const MAX_ACTIVE_TOKENS = 10;
/** Expiry choices of the form, in days; null never expires. */
export const TOKEN_EXPIRY_DAYS = [30, 90, 365] as const;
/** By default a token can do what the frontend needs (chapter 6). */
export const DEFAULT_SCOPES: readonly DeliveryScope[] = DELIVERY_SCOPES;
/** `last_used_at` is written at most this often per token. */
const LAST_USED_INTERVAL_MS = 60_000;

const issueSchema = z.strictObject({
  name: z.string().trim().min(1).max(100),
  scopes: z
    .array(z.enum(DELIVERY_SCOPES))
    .min(1)
    .transform((values) => DELIVERY_SCOPES.filter((s) => values.includes(s))),
  expiresInDays: z.union([z.literal(TOKEN_EXPIRY_DAYS), z.null()]).default(null),
});

export type IssueTokenInput = z.input<typeof issueSchema>;

export interface TokenRecord {
  id: string;
  name: string;
  prefix: string;
  scopes: DeliveryScope[];
  createdAt: Date;
  createdBy: string | null;
  expiresAt: Date | null;
  lastUsedAt: Date | null;
  revokedAt: Date | null;
  status: 'active' | 'expired' | 'revoked';
}

function statusOf(
  row: { revokedAt: Date | null; expiresAt: Date | null },
  now: Date,
): TokenRecord['status'] {
  if (row.revokedAt) return 'revoked';
  if (row.expiresAt && row.expiresAt <= now) return 'expired';
  return 'active';
}

/** All Delivery Tokens, newest first, without their hashes. */
export async function listDeliveryTokens(db: Executor, now = new Date()): Promise<TokenRecord[]> {
  const rows = await db
    .select({
      id: schema.apiTokens.id,
      name: schema.apiTokens.name,
      prefix: schema.apiTokens.prefix,
      scopes: schema.apiTokens.scopes,
      createdAt: schema.apiTokens.createdAt,
      createdBy: schema.users.displayName,
      expiresAt: schema.apiTokens.expiresAt,
      lastUsedAt: schema.apiTokens.lastUsedAt,
      revokedAt: schema.apiTokens.revokedAt,
    })
    .from(schema.apiTokens)
    .leftJoin(schema.users, eq(schema.users.id, schema.apiTokens.createdBy))
    .where(eq(schema.apiTokens.kind, 'delivery'))
    .orderBy(desc(schema.apiTokens.createdAt));
  return rows.map((row) => ({
    ...row,
    scopes: row.scopes.filter((s): s is DeliveryScope =>
      (DELIVERY_SCOPES as readonly string[]).includes(s),
    ),
    status: statusOf(row, now),
  }));
}

/**
 * Issues a Delivery Token. The returned `token` is the only time it can be seen; the database
 * keeps its hash. At most MAX_ACTIVE_TOKENS may be active (`too_many_tokens`).
 */
export async function issueDeliveryToken(
  db: Database,
  input: IssueTokenInput,
  actor: Actor,
  now = new Date(),
): Promise<{ token: string; id: string }> {
  const value = parseInput(issueSchema, input);
  const token = DELIVERY_TOKEN_PREFIX + randomToken(32);
  const expiresAt = value.expiresInDays
    ? new Date(now.getTime() + value.expiresInDays * 86_400_000)
    : null;
  return db.transaction(async (tx) => {
    // Serialise issuing, so two requests cannot both pass the limit.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('bluepax:api:tokens'))`);
    const active = (await listDeliveryTokens(tx, now)).filter((t) => t.status === 'active');
    if (active.length >= MAX_ACTIVE_TOKENS) {
      throw new InvalidInputError(['form'], 'too many active tokens', 'too_many_tokens', {
        max: MAX_ACTIVE_TOKENS,
      });
    }
    const [row] = await tx
      .insert(schema.apiTokens)
      .values({
        kind: 'delivery',
        name: value.name,
        prefix: token.slice(0, SHOWN_LENGTH),
        tokenHash: sha256Hex(token),
        scopes: value.scopes,
        expiresAt,
        createdBy: actor.id,
        createdAt: now,
      })
      .returning({ id: schema.apiTokens.id });
    await audit(tx, {
      action: 'api.token_issue',
      actorId: actor.id,
      targetType: 'api_token',
      targetId: row!.id,
      details: {
        name: value.name,
        prefix: token.slice(0, SHOWN_LENGTH),
        scopes: value.scopes,
        expiresAt: expiresAt?.toISOString() ?? null,
      },
      ip: actor.ip,
    });
    return { token, id: row!.id };
  });
}

/** Revokes a token for good; requests with it get 401 from then on. */
export async function revokeDeliveryToken(
  db: Database,
  id: string,
  actor: Actor,
  now = new Date(),
): Promise<void> {
  if (!z.uuid().safeParse(id).success) throw new InvalidInputError(['not_found']);
  await db.transaction(async (tx) => {
    const [row] = await tx
      .select({
        name: schema.apiTokens.name,
        prefix: schema.apiTokens.prefix,
        revokedAt: schema.apiTokens.revokedAt,
      })
      .from(schema.apiTokens)
      .where(and(eq(schema.apiTokens.id, id), eq(schema.apiTokens.kind, 'delivery')))
      .for('update');
    if (!row) throw new InvalidInputError(['not_found']);
    if (row.revokedAt) return;
    await tx
      .update(schema.apiTokens)
      .set({ revokedAt: now, revokedBy: actor.id })
      .where(eq(schema.apiTokens.id, id));
    await audit(tx, {
      action: 'api.token_revoke',
      actorId: actor.id,
      targetType: 'api_token',
      targetId: id,
      details: { name: row.name, prefix: row.prefix },
      ip: actor.ip,
    });
  });
}

export interface AuthenticatedToken {
  id: string;
  scopes: ReadonlySet<string>;
}

const lastUsedWritten = new Map<string, number>();

/**
 * The active Delivery Token a request presents, or null when it is unknown, revoked or
 * expired. Looked up by its hash, so the stored value never meets the presented one.
 */
export async function authenticateDeliveryToken(
  db: Database,
  token: string,
  now = new Date(),
): Promise<AuthenticatedToken | null> {
  if (!token.startsWith(DELIVERY_TOKEN_PREFIX) || token.length > 200) return null;
  const [row] = await db
    .select({
      id: schema.apiTokens.id,
      scopes: schema.apiTokens.scopes,
      expiresAt: schema.apiTokens.expiresAt,
      revokedAt: schema.apiTokens.revokedAt,
    })
    .from(schema.apiTokens)
    .where(
      and(eq(schema.apiTokens.tokenHash, sha256Hex(token)), eq(schema.apiTokens.kind, 'delivery')),
    );
  if (!row || statusOf(row, now) !== 'active') return null;
  const last = lastUsedWritten.get(row.id) ?? 0;
  if (now.getTime() - last >= LAST_USED_INTERVAL_MS) {
    lastUsedWritten.set(row.id, now.getTime());
    await db
      .update(schema.apiTokens)
      .set({ lastUsedAt: now })
      .where(eq(schema.apiTokens.id, row.id));
  }
  return { id: row.id, scopes: new Set(row.scopes) };
}
