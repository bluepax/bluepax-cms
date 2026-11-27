// The one frontend of the instance (docs/spec/README.md chapter 6, "一个实例只对接一个前台";
// docs/adr/0012): its base URL is the `frontend.baseUrl` configuration item, edited on the
// "接入与 API" page; its preview secret is stored encrypted, shown once and rotated there.
import { httpUrl } from '@bluepax/presets';
import { schema, type Database, type Executor } from '@bluepax/db';
import { and, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { audit } from '../../audit.ts';
import { exportInstanceConfig, updateInstanceConfig } from '../../instance.ts';
import { decrypt, encrypt, randomToken } from '../../security/crypto.ts';
import { configInputError, InvalidInputError } from '../site/values.ts';
import { createPreviewToken, previewUrl, type PreviewTarget } from './preview.ts';
import type { Actor } from './tokens.ts';

const FRONTEND_KEY = 'default';
/** Preview secrets start with this, so they are easy to recognise. */
export const PREVIEW_SECRET_PREFIX = 'bpxp_';

export interface FrontendState {
  baseUrl: string;
  previewSecretSet: boolean;
  previewSecretChangedAt: Date | null;
}

async function frontendRow(db: Executor) {
  const [row] = await db
    .select()
    .from(schema.frontends)
    .where(eq(schema.frontends.key, FRONTEND_KEY));
  return row;
}

export async function frontendState(db: Executor): Promise<FrontendState> {
  const config = await exportInstanceConfig(db);
  const row = await frontendRow(db);
  return {
    baseUrl: config.frontend.baseUrl,
    previewSecretSet: Boolean(row?.previewSecret),
    previewSecretChangedAt: row?.previewSecretChangedAt ?? null,
  };
}

/** Changes the frontend base URL (configuration `frontend.baseUrl`), audited with both values. */
export async function saveFrontendBaseUrl(
  db: Database,
  baseUrl: string,
  actor: Actor,
): Promise<string> {
  if (!httpUrl.safeParse(baseUrl).success) throw new InvalidInputError(['baseUrl']);
  return db.transaction(async (tx) => {
    let result: Awaited<ReturnType<typeof updateInstanceConfig>>;
    try {
      result = await updateInstanceConfig(tx, (c) => ({
        ...c,
        frontend: { ...c.frontend, baseUrl },
      }));
    } catch (error) {
      configInputError(error, 'frontend');
    }
    const from = result.before.frontend.baseUrl;
    const to = result.after.frontend.baseUrl;
    if (from !== to) {
      await audit(tx, {
        action: 'api.frontend_update',
        actorId: actor.id,
        targetType: 'settings',
        targetId: 'frontend',
        details: { baseUrl: { from, to } },
        ip: actor.ip,
      });
    }
    return to;
  });
}

/**
 * Creates or replaces the preview secret and returns it; this is the only time it is shown.
 * Preview links signed with the old secret stop working.
 */
export async function rotatePreviewSecret(
  db: Database,
  key: Buffer,
  actor: Actor,
  now = new Date(),
): Promise<string> {
  const secret = PREVIEW_SECRET_PREFIX + randomToken(32);
  await db.transaction(async (tx) => {
    const value = { previewSecret: encrypt(secret, key), previewSecretChangedAt: now };
    const [row] = await tx
      .insert(schema.frontends)
      .values({ key: FRONTEND_KEY, ...value })
      .onConflictDoUpdate({
        target: schema.frontends.key,
        set: { ...value, updatedAt: sql`now()` },
      })
      .returning({ id: schema.frontends.id });
    await audit(tx, {
      action: 'api.preview_secret_rotate',
      actorId: actor.id,
      targetType: 'frontend',
      targetId: row!.id,
      ip: actor.ip,
    });
  });
  return secret;
}

/** The current preview secret, or null before the first one is created. */
export async function previewSecret(db: Executor, key: Buffer): Promise<string | null> {
  const row = await frontendRow(db);
  return row?.previewSecret ? decrypt(row.previewSecret, key) : null;
}

/** Thrown when a preview link is asked for before an admin has created the preview secret. */
export class PreviewUnavailableError extends Error {
  override name = 'PreviewUnavailableError';
}

/**
 * A signed preview link of a page or post language version (chapter 3, "带签名的预览链接"), to
 * the frontend's preview route. Null when that language version does not exist.
 */
export async function createPreviewLink(
  db: Executor,
  key: Buffer,
  target: PreviewTarget,
  now = new Date(),
): Promise<{ url: string; expiresAt: Date } | null> {
  if (!z.uuid().safeParse(target.id).success) return null;
  const t = target.type === 'page' ? schema.pagesTranslations : schema.postsTranslations;
  const [row] = await db
    .select({ id: t.id })
    .from(t)
    .where(and(eq(t.entityId, target.id), eq(t.locale, target.locale)));
  if (!row) return null;
  const secret = await previewSecret(db, key);
  if (!secret) throw new PreviewUnavailableError('no preview secret');
  const { baseUrl } = (await exportInstanceConfig(db)).frontend;
  const { token, expiresAt } = createPreviewToken(secret, target, now);
  return { url: previewUrl(baseUrl, token), expiresAt };
}
