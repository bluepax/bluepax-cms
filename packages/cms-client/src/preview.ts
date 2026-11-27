// Checks a preview link's token before calling the CMS (docs/spec/README.md chapter 6, docs/adr/0012,
// 0013). The token is `<payload>.<signature>`: base64url JSON `{ v: 1, type, id, locale, exp }`
// and its HMAC-SHA256 with the preview secret (base64url). The CMS checks it again in
// `GET /preview/{token}`, so this check is optional: it lets a frontend that holds the preview
// secret refuse forged or expired links without a request. Web Crypto only, so it runs in
// Node.js, Deno, Bun and edge runtimes.

export const PREVIEW_TYPES = ['page', 'post'] as const;
export type PreviewType = (typeof PREVIEW_TYPES)[number];

export interface PreviewTarget {
  type: PreviewType;
  id: string;
  locale: string;
}

export type PreviewCheck =
  | { ok: true; target: PreviewTarget; expiresAt: Date }
  | { ok: false; reason: 'invalid' | 'expired' };

/** Longest token accepted, like the CMS. */
export const PREVIEW_TOKEN_MAX_LENGTH = 2000;

const BASE64URL = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

function fromBase64Url(value: string): Uint8Array<ArrayBuffer> | null {
  if (value === '' || value.length % 4 === 1) return null;
  for (const c of value) if (!BASE64URL.includes(c)) return null;
  const base64 = value.replaceAll('-', '+').replaceAll('_', '/');
  const binary = atob(base64 + '='.repeat((4 - (base64.length % 4)) % 4));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

const invalid: PreviewCheck = { ok: false, reason: 'invalid' };

/**
 * Whether `token` was signed with `secret` (the preview secret from the CMS's "接入与 API" page)
 * and has not expired. The signature is compared by Web Crypto in constant time.
 */
export async function verifyPreviewToken(
  secret: string,
  token: string,
  now: Date = new Date(),
): Promise<PreviewCheck> {
  if (!secret || typeof token !== 'string' || token.length > PREVIEW_TOKEN_MAX_LENGTH) {
    return invalid;
  }
  const parts = token.split('.');
  if (parts.length !== 2) return invalid;
  const [payload, signature] = parts as [string, string];
  const signatureBytes = fromBase64Url(signature);
  const payloadBytes = fromBase64Url(payload);
  if (!signatureBytes || !payloadBytes) return invalid;

  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['verify'],
  );
  const valid = await crypto.subtle.verify('HMAC', key, signatureBytes, encoder.encode(payload));
  if (!valid) return invalid;

  let data: unknown;
  try {
    data = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(payloadBytes));
  } catch {
    return invalid;
  }
  if (typeof data !== 'object' || data === null) return invalid;
  const { v, type, id, locale, exp } = data as Record<string, unknown>;
  if (
    v !== 1 ||
    !PREVIEW_TYPES.includes(type as PreviewType) ||
    typeof id !== 'string' ||
    typeof locale !== 'string' ||
    typeof exp !== 'number' ||
    !Number.isFinite(exp)
  ) {
    return invalid;
  }
  if (exp * 1000 <= now.getTime()) return { ok: false, reason: 'expired' };
  return {
    ok: true,
    target: { type: type as PreviewType, id, locale },
    expiresAt: new Date(exp * 1000),
  };
}
