// Signed preview links (docs/spec/README.md chapters 3 and 6, docs/adr/0012). An editor creates
// a link to the frontend's preview route, `{baseUrl}/preview?token=<token>`; the frontend's
// server calls `GET /api/delivery/v1/preview/{token}` and renders the language version as it is
// now, whatever its status (pages and posts have no working copies before M2). The token is
// `<payload>.<signature>`: base64url JSON and its HMAC-SHA256 with the preview secret, so the
// frontend can check it with the same secret. It is valid for one hour (chapter 13).
import { sign, verifySigned } from '../../security/crypto.ts';

export const PREVIEW_TTL_SECONDS = 60 * 60;
export const PREVIEW_TYPES = ['page', 'post'] as const;
export type PreviewType = (typeof PREVIEW_TYPES)[number];

export interface PreviewTarget {
  type: PreviewType;
  id: string;
  locale: string;
}

interface PreviewPayload extends PreviewTarget {
  v: 1;
  /** Expiry, Unix seconds. */
  exp: number;
}

const keyOf = (secret: string) => Buffer.from(secret, 'utf8');

export function createPreviewToken(
  secret: string,
  target: PreviewTarget,
  now = new Date(),
): { token: string; expiresAt: Date } {
  const exp = Math.floor(now.getTime() / 1000) + PREVIEW_TTL_SECONDS;
  const payload: PreviewPayload = {
    v: 1,
    type: target.type,
    id: target.id,
    locale: target.locale,
    exp,
  };
  return { token: sign(payload, keyOf(secret)), expiresAt: new Date(exp * 1000) };
}

export type PreviewCheck =
  | { ok: true; target: PreviewTarget; expiresAt: Date }
  | { ok: false; reason: 'invalid' | 'expired' };

export function verifyPreviewToken(secret: string, token: string, now = new Date()): PreviewCheck {
  if (token.length > 2000) return { ok: false, reason: 'invalid' };
  const payload = verifySigned<Partial<PreviewPayload>>(token, keyOf(secret));
  if (
    !payload ||
    payload.v !== 1 ||
    !PREVIEW_TYPES.includes(payload.type as PreviewType) ||
    typeof payload.id !== 'string' ||
    typeof payload.locale !== 'string' ||
    typeof payload.exp !== 'number'
  ) {
    return { ok: false, reason: 'invalid' };
  }
  if (payload.exp * 1000 <= now.getTime()) return { ok: false, reason: 'expired' };
  return {
    ok: true,
    target: { type: payload.type as PreviewType, id: payload.id, locale: payload.locale },
    expiresAt: new Date(payload.exp * 1000),
  };
}

/** The frontend's preview route for a token. */
export function previewUrl(baseUrl: string, token: string): string {
  return `${baseUrl}/preview?token=${encodeURIComponent(token)}`;
}
