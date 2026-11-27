import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { decrypt, deriveKey, encrypt, parseEncryptionKey, sign, verifySigned } from './crypto.ts';
import { checkPassword, hashPassword, verifyPassword } from './password.ts';
import { SlidingWindowLimiter } from './rate-limit.ts';
import { base32Decode, base32Encode, totpCode, totpUri, verifyTotp } from './totp.ts';

describe('signing', () => {
  const key = deriveKey('a-secret-of-at-least-thirty-two-characters', 'test');

  it('round-trips and rejects tampering or another key', () => {
    const token = sign({ userId: 'u1', exp: 1 }, key);
    expect(verifySigned(token, key)).toEqual({ userId: 'u1', exp: 1 });
    const [payload] = token.split('.');
    const forged = `${Buffer.from('{"userId":"u2","exp":1}').toString('base64url')}.${token.split('.')[1]}`;
    expect(verifySigned(forged, key)).toBeNull();
    expect(verifySigned(`${payload}.`, key)).toBeNull();
    expect(
      verifySigned(token, deriveKey('a-secret-of-at-least-thirty-two-characters', 'other')),
    ).toBeNull();
  });
});

describe('encryption', () => {
  const key = randomBytes(32);

  it('round-trips and fails with a different key', () => {
    const value = encrypt('JBSWY3DPEHPK3PXP', key);
    expect(value.startsWith('v1.')).toBe(true);
    expect(decrypt(value, key)).toBe('JBSWY3DPEHPK3PXP');
    expect(() => decrypt(value, randomBytes(32))).toThrow();
  });

  it('requires a 32-byte key', () => {
    expect(() => parseEncryptionKey(Buffer.alloc(16).toString('base64'))).toThrow(/32 bytes/);
    expect(parseEncryptionKey(key.toString('base64'))).toHaveLength(32);
  });
});

describe('passwords', () => {
  it('needs at least 12 characters, counting characters not bytes', () => {
    expect(checkPassword('short')).toBe('too_short');
    expect(checkPassword('密码密码密码密码密码密码')).toBeNull();
    expect(checkPassword('x'.repeat(257))).toBe('too_long');
  });

  it('hashes with Argon2id and verifies', async () => {
    const hash = await hashPassword('correct horse battery');
    expect(hash.startsWith('$argon2id$')).toBe(true);
    expect(await verifyPassword(hash, 'correct horse battery')).toBe(true);
    expect(await verifyPassword(hash, 'wrong horse battery')).toBe(false);
    expect(await verifyPassword('not-a-hash', 'x')).toBe(false);
  });
});

describe('TOTP', () => {
  // RFC 6238 appendix B, SHA-1 secret "12345678901234567890"; codes truncated to 6 digits.
  const secret = base32Encode(Buffer.from('12345678901234567890'));

  it('matches the RFC 6238 test vectors', () => {
    expect(secret).toBe('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');
    expect(totpCode(secret, Math.floor(59 / 30))).toBe('287082');
    expect(totpCode(secret, Math.floor(1111111109 / 30))).toBe('081804');
    expect(totpCode(secret, Math.floor(2000000000 / 30))).toBe('279037');
  });

  it('accepts one step of drift, and each step only once', () => {
    const now = new Date(1111111109 * 1000);
    const step = Math.floor(1111111109 / 30);
    expect(verifyTotp(secret, '081804', now, null)).toBe(step);
    expect(verifyTotp(secret, '081804', now, step)).toBeNull();
    expect(verifyTotp(secret, totpCode(secret, step + 1), now, step)).toBe(step + 1);
    expect(verifyTotp(secret, totpCode(secret, step + 2), now, null)).toBeNull();
    expect(verifyTotp(secret, 'abcdef', now, null)).toBeNull();
  });

  it('round-trips base32 and builds an otpauth URI', () => {
    expect(base32Decode(secret).toString()).toBe('12345678901234567890');
    expect(totpUri(secret, 'a@example.com')).toBe(
      `otpauth://totp/BluePax%20CMS%3Aa%40example.com?secret=${secret}&issuer=BluePax+CMS&algorithm=SHA1&digits=6&period=30`,
    );
  });
});

describe('SlidingWindowLimiter', () => {
  it('allows the limit within the window, then reports when to retry', () => {
    const limiter = new SlidingWindowLimiter(2, 1000);
    expect(limiter.hit('ip', 0).allowed).toBe(true);
    expect(limiter.hit('ip', 100).allowed).toBe(true);
    expect(limiter.hit('ip', 200)).toEqual({ allowed: false, retryAfterMs: 800, remaining: 0 });
    expect(limiter.hit('other', 200).allowed).toBe(true);
    expect(limiter.hit('ip', 1001).allowed).toBe(true);
  });
});
