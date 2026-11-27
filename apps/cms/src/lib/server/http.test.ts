import { describe, expect, it } from 'vitest';
import {
  FORM_BODY_LIMIT,
  isCrossSiteWrite,
  isOversizedBody,
  isPublicPath,
  isUploadPath,
  parseBodySizeLimit,
} from './http.ts';

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

describe('request body limits', () => {
  const post = (path: string, length?: number) => {
    const target = new URL(path, 'https://cms.example.com');
    const headers: Record<string, string> =
      length === undefined ? {} : { 'content-length': String(length) };
    return [new Request(target, { method: 'POST', headers }), target] as const;
  };

  it('only lets the media library and a media item take uploads', () => {
    expect(isUploadPath('/media')).toBe(true);
    expect(isUploadPath('/media/3f1c2a9e-0000-4000-8000-000000000000')).toBe(true);
    expect(isUploadPath('/media/')).toBe(false);
    expect(isUploadPath('/media/a/b')).toBe(false);
    expect(isUploadPath('/mediax')).toBe(false);
    expect(isUploadPath('/login')).toBe(false);
  });

  it('refuses large declared bodies outside the upload forms', () => {
    expect(isOversizedBody(...post('/login', FORM_BODY_LIMIT + 1))).toBe(true);
    expect(isOversizedBody(...post('/api/delivery/v1/site', FORM_BODY_LIMIT + 1))).toBe(true);
    expect(isOversizedBody(...post('/login', FORM_BODY_LIMIT))).toBe(false);
    expect(isOversizedBody(...post('/media', 200 * 1024 * 1024))).toBe(false);
    expect(isOversizedBody(...post('/media/abc', 200 * 1024 * 1024))).toBe(false);
    // Without Content-Length, adapter-node's BODY_SIZE_LIMIT still applies.
    expect(isOversizedBody(...post('/login'))).toBe(false);
  });

  it('reads BODY_SIZE_LIMIT like adapter-node', () => {
    expect(parseBodySizeLimit(undefined)).toBe(512 * 1024);
    expect(parseBodySizeLimit('256M')).toBe(256 * 1024 * 1024);
    expect(parseBodySizeLimit('1g')).toBe(1024 ** 3);
    expect(parseBodySizeLimit('1048576')).toBe(1024 * 1024);
    expect(parseBodySizeLimit('Infinity')).toBe(Infinity);
    expect(parseBodySizeLimit('lots')).toBeNaN();
  });
});
