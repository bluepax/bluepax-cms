import { describe, expect, it } from 'vitest';
import type { DeliveredBlock } from './contract.ts';
import {
  jsonLdScript,
  knownBlock,
  routePath,
  serializeJsonLd,
  verifyPreviewToken,
} from './index.ts';

const SECRET = 'bpxp_preview-secret-for-tests';

function base64url(bytes: Uint8Array): string {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}

/** Signs like the CMS: base64url JSON, then HMAC-SHA256 of that string with the secret. */
async function sign(data: unknown, secret = SECRET): Promise<string> {
  const encoder = new TextEncoder();
  const payload = base64url(encoder.encode(JSON.stringify(data)));
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(payload)));
  return `${payload}.${base64url(signature)}`;
}

const now = new Date('2026-11-26T10:00:00Z');
const exp = Math.floor(now.getTime() / 1000) + 3600;
const id = '11111111-1111-4111-8111-111111111111';

describe('verifyPreviewToken', () => {
  it('accepts a token signed with the preview secret', async () => {
    const token = await sign({ v: 1, type: 'post', id, locale: 'zh-CN', exp });
    await expect(verifyPreviewToken(SECRET, token, now)).resolves.toEqual({
      ok: true,
      target: { type: 'post', id, locale: 'zh-CN' },
      expiresAt: new Date(exp * 1000),
    });
  });

  it('reports expired tokens', async () => {
    const token = await sign({ v: 1, type: 'page', id, locale: 'en', exp });
    await expect(verifyPreviewToken(SECRET, token, new Date(exp * 1000))).resolves.toEqual({
      ok: false,
      reason: 'expired',
    });
  });

  it('refuses other secrets, changed payloads and malformed tokens', async () => {
    const good = await sign({ v: 1, type: 'page', id, locale: 'en', exp });
    const [payload, signature] = good.split('.') as [string, string];
    const other = await sign({ v: 1, type: 'page', id: id.replace('1', '2'), locale: 'en', exp });
    const invalid = { ok: false, reason: 'invalid' };
    for (const token of [
      `${other.split('.')[0]}.${signature}`,
      `${payload}.${signature}x`,
      `${payload}.${signature}.x`,
      `${payload}`,
      `${payload}.***`,
      '',
      `${payload}.${signature}`.padEnd(2001, 'a'),
      await sign({ v: 2, type: 'page', id, locale: 'en', exp }),
      await sign({ v: 1, type: 'tag', id, locale: 'en', exp }),
      await sign({ v: 1, type: 'page', id, locale: 'en', exp: 'later' }),
      await sign([1, 2]),
    ]) {
      await expect(verifyPreviewToken(SECRET, token, now), token).resolves.toEqual(invalid);
    }
    await expect(verifyPreviewToken('another-secret', good, now)).resolves.toEqual(invalid);
    await expect(verifyPreviewToken('', good, now)).resolves.toEqual(invalid);
  });
});

describe('JSON-LD', () => {
  it('cannot close the script element or start markup', () => {
    const value = { name: '</script><script>alert(1)</script>', note: 'a & b > c ' };
    const script = jsonLdScript(value);
    expect(script.startsWith('<script type="application/ld+json">')).toBe(true);
    expect(script.endsWith('</script>')).toBe(true);
    const inner = script.slice('<script type="application/ld+json">'.length, -'</script>'.length);
    expect(inner).not.toContain('<');
    expect(inner).not.toContain('>');
    expect(inner).not.toContain('&');
    expect(JSON.parse(inner)).toEqual(value);
    expect(serializeJsonLd(undefined)).toBe('null');
  });
});

describe('helpers', () => {
  it('fills route templates in lowercase', () => {
    expect(routePath('/{locale}/blog/{slug}', { locale: 'zh-CN', slug: 'hello' })).toBe(
      '/zh-cn/blog/hello',
    );
    expect(routePath('/{locale}', { locale: 'EN' })).toBe('/en');
  });

  it('types standard blocks and leaves unknown ones out', () => {
    const block = (type: string): DeliveredBlock => ({ id, type, data: {}, html: {} });
    const hero = knownBlock(block('hero'));
    expect(hero?.type).toBe('hero');
    expect(knownBlock(block('custom-carousel'))).toBeNull();
  });
});
