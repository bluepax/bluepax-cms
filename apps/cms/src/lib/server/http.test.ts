import { describe, expect, it } from 'vitest';
import { isCrossSiteWrite, isPublicPath } from './http.ts';

const url = new URL('https://cms.example.com/users/new');
const request = (method: string, headers: Record<string, string> = {}) =>
  new Request(url, { method, headers });

describe('isCrossSiteWrite', () => {
  it('allows reads and same-origin writes', () => {
    expect(isCrossSiteWrite(request('GET', { origin: 'https://evil.example' }), url)).toBe(false);
    expect(isCrossSiteWrite(request('POST', { origin: 'https://cms.example.com' }), url)).toBe(
      false,
    );
    expect(isCrossSiteWrite(request('POST', { 'sec-fetch-site': 'same-origin' }), url)).toBe(false);
  });

  it('blocks writes from other origins or without any origin information', () => {
    expect(isCrossSiteWrite(request('POST', { origin: 'https://evil.example' }), url)).toBe(true);
    expect(isCrossSiteWrite(request('DELETE', { 'sec-fetch-site': 'cross-site' }), url)).toBe(true);
    expect(isCrossSiteWrite(request('POST'), url)).toBe(true);
  });

  it('leaves token-authenticated APIs to their own checks', () => {
    const api = new URL('https://cms.example.com/api/inquiry/v1/inquiries');
    expect(isCrossSiteWrite(new Request(api, { method: 'POST' }), api)).toBe(false);
  });
});

describe('isPublicPath', () => {
  it('only opens login, setup, the health check, media files and token APIs', () => {
    expect(isPublicPath('/login')).toBe(true);
    expect(isPublicPath('/setup')).toBe(true);
    expect(isPublicPath('/api/health')).toBe(true);
    expect(isPublicPath('/api/delivery/v1/site')).toBe(true);
    expect(isPublicPath('/uploads/2026/11/file.webp')).toBe(true);
    expect(isPublicPath('/uploads')).toBe(false);
    expect(isPublicPath('/media')).toBe(false);
    expect(isPublicPath('/users')).toBe(false);
    expect(isPublicPath('/login/../users')).toBe(false);
  });
});
