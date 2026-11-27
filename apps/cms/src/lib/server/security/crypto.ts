// Small crypto helpers on top of node:crypto, see docs/spec/README.md chapter 9:
// APP_SECRET signs (sessions, short-lived tokens), ENCRYPTION_KEY encrypts stored secrets.
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

export function sha256Hex(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

/** Derives a separate key per purpose so one secret never signs two kinds of data. */
export function deriveKey(secret: string, purpose: string): Buffer {
  return createHmac('sha256', secret).update(`bluepax:${purpose}`).digest();
}

/** `<payload>.<signature>`; the payload is base64url JSON. */
export function sign(data: unknown, key: Buffer): string {
  const payload = Buffer.from(JSON.stringify(data)).toString('base64url');
  const signature = createHmac('sha256', key).update(payload).digest('base64url');
  return `${payload}.${signature}`;
}

export function verifySigned<T>(token: string, key: Buffer): T | null {
  const [payload, signature, ...rest] = token.split('.');
  if (!payload || !signature || rest.length > 0) return null;
  const expected = createHmac('sha256', key).update(payload).digest();
  const given = Buffer.from(signature, 'base64url');
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as T;
  } catch {
    return null;
  }
}

/** Parses ENCRYPTION_KEY: 32 bytes, base64. */
export function parseEncryptionKey(value: string): Buffer {
  const key = Buffer.from(value, 'base64');
  if (key.length !== 32) throw new Error('ENCRYPTION_KEY must be 32 bytes encoded as base64');
  return key;
}

/** AES-256-GCM; output `v1.<iv>.<tag>.<ciphertext>` in base64url. */
export function encrypt(plaintext: string, key: Buffer): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const data = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ['v1', iv, tag, data]
    .map((p) => (typeof p === 'string' ? p : p.toString('base64url')))
    .join('.');
}

export function decrypt(value: string, key: Buffer): string {
  const [version, iv, tag, data] = value.split('.');
  if (version !== 'v1' || !iv || !tag || data === undefined) throw new Error('invalid ciphertext');
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64url'));
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([
    decipher.update(Buffer.from(data, 'base64url')),
    decipher.final(),
  ]).toString('utf8');
}
