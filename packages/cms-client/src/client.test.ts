import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  CmsError,
  createCmsClient,
  isCmsError,
  memoryCache,
  parseRetryAfter,
  type CmsClientOptions,
  type FetchLike,
} from './index.ts';

const BASE = 'https://cms.example.test';
const API = `${BASE}/api/delivery/v1`;
const TOKEN = 'bpxd_test-token';

interface Call {
  url: string;
  init: RequestInit;
}

function json(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init.headers as Record<string, string>) },
  });
}

function apiError(
  status: number,
  code: string,
  headers: Record<string, string> = {},
  details?: object,
) {
  return json(
    { error: { code, message: `${code} message`, ...(details && { details }) } },
    { status, headers },
  );
}

/** A fetch double answering from a queue and recording each call. */
function mockFetch(...answers: (Response | Error | ((call: Call) => Promise<Response>))[]) {
  const calls: Call[] = [];
  const fn: FetchLike = async (url, init) => {
    const call = { url, init };
    calls.push(call);
    const next = answers.shift();
    if (next === undefined) throw new Error(`unexpected request ${url}`);
    if (next instanceof Error) throw next;
    if (typeof next === 'function') return next(call);
    return next;
  };
  return { fn, calls };
}

function client(fetch: FetchLike, options: Partial<CmsClientOptions> = {}) {
  return createCmsClient({ baseUrl: BASE, token: TOKEN, fetch, ...options });
}

function headersOf(call: Call | undefined): Record<string, string> {
  return (call?.init.headers ?? {}) as Record<string, string>;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('createCmsClient', () => {
  it('needs an http(s) base URL and a token', () => {
    const { fn } = mockFetch();
    expect(() => createCmsClient({ baseUrl: 'not a url', token: TOKEN, fetch: fn })).toThrow(
      TypeError,
    );
    expect(() =>
      createCmsClient({ baseUrl: 'ftp://cms.example.test', token: TOKEN, fetch: fn }),
    ).toThrow(TypeError);
    expect(() => createCmsClient({ baseUrl: BASE, token: ' ', fetch: fn })).toThrow(TypeError);
    expect(() => createCmsClient({ baseUrl: BASE, token: TOKEN, fetch: fn, timeout: -1 })).toThrow(
      RangeError,
    );
  });

  it('builds the API root from the base URL', () => {
    const { fn } = mockFetch();
    expect(client(fn).apiUrl).toBe(API);
    expect(client(fn, { baseUrl: `${BASE}//` }).apiUrl).toBe(API);
    expect(client(fn, { baseUrl: `${BASE}/cms/?x=1#y` }).apiUrl).toBe(
      `${BASE}/cms/api/delivery/v1`,
    );
  });

  it('refuses to run in a browser unless explicitly allowed', () => {
    vi.stubGlobal('window', {});
    vi.stubGlobal('document', {});
    const { fn } = mockFetch();
    expect(() => client(fn)).toThrow(/server only/);
    expect(() => client(fn, { dangerouslyAllowBrowser: true })).not.toThrow();
  });
});

describe('requests', () => {
  it('sends the token and returns the parsed body', async () => {
    const site = { name: 'Example', locale: 'en' };
    const { fn, calls } = mockFetch(json(site));
    await expect(client(fn).getSite({ locale: 'en' })).resolves.toEqual(site);
    expect(calls[0]?.url).toBe(`${API}/site?locale=en`);
    expect(calls[0]?.init.method).toBe('GET');
    expect(headersOf(calls[0])).toMatchObject({
      Accept: 'application/json',
      Authorization: `Bearer ${TOKEN}`,
    });
  });

  it('builds paths and query strings for every endpoint', async () => {
    const answers = Array.from({ length: 11 }, () => json({}));
    const { fn, calls } = mockFetch(...answers);
    const cms = client(fn);
    await cms.getSite();
    await cms.resolveRoute('/zh-cn/blog/a b?c');
    await cms.getPage('about/us', { locale: 'zh-CN' });
    await cms.listPosts({
      locale: 'en',
      page: 2,
      pageSize: 50,
      category: 'news',
      tag: 'release',
      author: 'ada',
    });
    await cms.getPost('hello', { locale: undefined });
    await cms.listPostCategories({ slug: 'news', locale: 'en' });
    await cms.listTags({ page: 3 });
    await cms.listAuthors({ pageSize: 10 });
    await cms.getAuthor('ada', { locale: 'en' });
    await cms.getBlockSchemas();
    await cms.getPreview('abc.def');
    expect(calls.map((c) => c.url.slice(API.length))).toEqual([
      '/site',
      '/routes/resolve?path=%2Fzh-cn%2Fblog%2Fa+b%3Fc',
      '/pages/about%2Fus?locale=zh-CN',
      '/posts?locale=en&page=2&pageSize=50&category=news&tag=release&author=ada',
      '/posts/hello',
      '/post-categories?locale=en&slug=news',
      '/tags?page=3',
      '/authors?pageSize=10',
      '/authors/ada?locale=en',
      '/schema/blocks',
      '/preview/abc.def',
    ]);
  });

  it('ignores query values the endpoint does not take', async () => {
    const { fn, calls } = mockFetch(json({}));
    await client(fn).listAuthors({ locale: 'en', slug: 'x' } as never);
    expect(calls[0]?.url).toBe(`${API}/authors?locale=en`);
  });

  it('rejects empty path parameters without a request', async () => {
    const { fn, calls } = mockFetch();
    await expect(client(fn).getPage('')).rejects.toThrow(TypeError);
    expect(calls).toHaveLength(0);
  });

  it('reads the OpenAPI document without the token', async () => {
    const { fn, calls } = mockFetch(json({ openapi: '3.1.0' }));
    await expect(client(fn).getOpenApi()).resolves.toEqual({ openapi: '3.1.0' });
    expect(calls[0]?.url).toBe(`${API}/openapi.json`);
    expect(headersOf(calls[0]).Authorization).toBeUndefined();
  });

  it('uses the fetch given to withFetch, with the same settings', async () => {
    const first = mockFetch();
    const second = mockFetch(json({ status: 404 }));
    const cms = client(first.fn).withFetch(second.fn);
    await expect(cms.resolveRoute('/x')).resolves.toEqual({ status: 404 });
    expect(first.calls).toHaveLength(0);
    expect(headersOf(second.calls[0]).Authorization).toBe(`Bearer ${TOKEN}`);
  });

  it('defaults to the global fetch', async () => {
    const { fn, calls } = mockFetch(json({ ok: true }));
    vi.stubGlobal('fetch', fn);
    await createCmsClient({ baseUrl: BASE, token: TOKEN }).getBlockSchemas();
    expect(calls).toHaveLength(1);
  });
});

describe('errors', () => {
  it.each([
    [400, 'invalid_locale', 'bad_request'],
    [401, 'invalid_token', 'unauthorized'],
    [403, 'insufficient_scope', 'forbidden'],
    [404, 'not_found', 'not_found'],
    [405, 'method_not_allowed', 'bad_request'],
    [410, 'gone', 'gone'],
    [409, 'conflict', 'http'],
    [500, 'internal_error', 'server'],
  ] as const)('maps %i %s to kind %s', async (status, code, kind) => {
    const { fn } = mockFetch(apiError(status, code, {}, { languages: ['en'] }));
    const error = await client(fn)
      .getPage('x')
      .catch((e: unknown) => e);
    expect(isCmsError(error)).toBe(true);
    expect(error).toBeInstanceOf(CmsError);
    expect(error).toMatchObject({
      name: 'CmsError',
      kind,
      status,
      code,
      message: `${code} message`,
      details: { languages: ['en'] },
      retryAfter: null,
      url: `${API}/pages/x`,
    });
    expect((error as CmsError).url).not.toContain(TOKEN);
  });

  it('reads Retry-After on 429 as seconds or a date', async () => {
    const { fn } = mockFetch(
      apiError(429, 'rate_limited', { 'Retry-After': '17' }, { retryAfter: 17 }),
      apiError(429, 'rate_limited', {}, { retryAfter: 9 }),
    );
    const cms = client(fn);
    await expect(cms.getSite()).rejects.toMatchObject({ kind: 'rate_limited', retryAfter: 17 });
    await expect(cms.getSite()).rejects.toMatchObject({ kind: 'rate_limited', retryAfter: 9 });
    const now = Date.parse('2026-11-26T10:00:00Z');
    expect(parseRetryAfter('Thu, 26 Nov 2026 10:00:30 GMT', now)).toBe(30);
    expect(parseRetryAfter('Thu, 26 Nov 2026 09:00:00 GMT', now)).toBe(0);
    expect(parseRetryAfter('soon', now)).toBeNull();
    expect(parseRetryAfter(null, now)).toBeNull();
  });

  it('keeps the HTTP status when the error body is not the API’s', async () => {
    const { fn } = mockFetch(
      new Response('<html>Bad gateway</html>', { status: 502, statusText: 'Bad Gateway' }),
    );
    await expect(client(fn).getSite()).rejects.toMatchObject({
      kind: 'server',
      status: 502,
      code: 'http_502',
      message: 'The CMS answered 502 Bad Gateway',
    });
  });

  it('reports a body that is not JSON', async () => {
    const { fn } = mockFetch(new Response('hello', { status: 200 }));
    await expect(client(fn).getSite()).rejects.toMatchObject({
      kind: 'invalid_response',
      code: 'invalid_response',
      status: 200,
    });
  });

  it('wraps network failures', async () => {
    const cause = new TypeError('fetch failed');
    const { fn } = mockFetch(cause);
    const error = await client(fn)
      .getSite()
      .catch((e: unknown) => e);
    expect(error).toMatchObject({ kind: 'network', status: 0, code: 'network_error' });
    expect((error as CmsError).cause).toBe(cause);
  });

  it('gives up after the timeout', async () => {
    const hang = (call: Call) =>
      new Promise<Response>((_, reject) => {
        call.init.signal?.addEventListener('abort', () => reject(call.init.signal?.reason));
      });
    const { fn } = mockFetch(hang);
    await expect(client(fn, { timeout: 20 }).getSite()).rejects.toMatchObject({
      kind: 'timeout',
      code: 'timeout',
    });
  });

  it('passes the caller’s own abort on unchanged', async () => {
    const hang = (call: Call) =>
      new Promise<Response>((_, reject) => {
        call.init.signal?.addEventListener('abort', () => reject(call.init.signal?.reason));
      });
    const { fn } = mockFetch(hang);
    const controller = new AbortController();
    const pending = client(fn).getSite({}, { signal: controller.signal });
    controller.abort(new DOMException('stop', 'AbortError'));
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('sends no signal when there is neither a timeout nor a caller signal', async () => {
    const { fn, calls } = mockFetch(json({}));
    await client(fn, { timeout: 0 }).getSite();
    expect(calls[0]?.init.signal).toBeUndefined();
  });
});

describe('cache', () => {
  it('revalidates with If-None-Match and reuses the body on 304', async () => {
    const cache = memoryCache();
    const { fn, calls } = mockFetch(
      json({ name: 'v1' }, { headers: { ETag: '"a"' } }),
      new Response(null, { status: 304, headers: { ETag: '"a"' } }),
      json({ name: 'v2' }, { headers: { ETag: '"b"' } }),
    );
    const cms = client(fn, { cache });
    await expect(cms.getSite()).resolves.toEqual({ name: 'v1' });
    await expect(cms.getSite()).resolves.toEqual({ name: 'v1' });
    await expect(cms.getSite()).resolves.toEqual({ name: 'v2' });
    expect(headersOf(calls[0])['If-None-Match']).toBeUndefined();
    expect(headersOf(calls[1])['If-None-Match']).toBe('"a"');
    expect(headersOf(calls[2])['If-None-Match']).toBe('"a"');
    expect(cache.get(`${API}/site`)).toMatchObject({ etag: '"b"' });
  });

  it('returns a fresh object on every hit', async () => {
    const { fn } = mockFetch(
      json({ items: [1] }, { headers: { ETag: '"a"' } }),
      new Response(null, { status: 304 }),
    );
    const cms = client(fn, { cache: memoryCache() });
    const first = await cms.listTags();
    (first as unknown as { items: number[] }).items.push(2);
    await expect(cms.listTags()).resolves.toEqual({ items: [1] });
  });

  it('keeps nothing marked no-store, and never the preview', async () => {
    const cache = memoryCache();
    const { fn, calls } = mockFetch(
      json({}, { headers: { ETag: '"a"', 'Cache-Control': 'no-store' } }),
      json({ type: 'page' }, { headers: { ETag: '"p"' } }),
      json({ type: 'page' }, { headers: { ETag: '"p"' } }),
    );
    const cms = client(fn, { cache });
    await cms.getSite();
    await cms.getPreview('t.s');
    await cms.getPreview('t.s');
    expect(cache.size).toBe(0);
    expect(headersOf(calls[2])['If-None-Match']).toBeUndefined();
  });

  it('serves a stale body when the CMS fails, if asked to', async () => {
    const onStale = vi.fn();
    const { fn } = mockFetch(
      json({ name: 'cached' }, { headers: { ETag: '"a"' } }),
      new TypeError('fetch failed'),
      apiError(503, 'unavailable', { 'Retry-After': '5' }),
      apiError(404, 'not_found'),
    );
    const cms = client(fn, { cache: memoryCache(), staleIfError: true, onStale });
    await cms.getSite();
    await expect(cms.getSite()).resolves.toEqual({ name: 'cached' });
    await expect(cms.getSite()).resolves.toEqual({ name: 'cached' });
    expect(onStale).toHaveBeenCalledTimes(2);
    expect(onStale.mock.calls[1]?.[0]).toMatchObject({
      url: `${API}/site`,
      error: { kind: 'server', status: 503, retryAfter: 5 },
    });
    // A 404 is an answer, not a failure: it is not hidden behind the cached body.
    await expect(cms.getSite()).rejects.toMatchObject({ kind: 'not_found' });
  });

  it('throws when there is nothing cached or staleIfError is off', async () => {
    const { fn } = mockFetch(
      new TypeError('fetch failed'),
      json({}, { headers: { ETag: '"a"' } }),
      new TypeError('fetch failed'),
    );
    const stale = client(fn, { cache: memoryCache(), staleIfError: true });
    await expect(stale.getSite()).rejects.toMatchObject({ kind: 'network' });
    const strict = client(fn, { cache: memoryCache() });
    await strict.getSite();
    await expect(strict.getSite()).rejects.toMatchObject({ kind: 'network' });
  });

  it('shares the cache with clients from withFetch', async () => {
    const cache = memoryCache();
    const first = mockFetch(json({ a: 1 }, { headers: { ETag: '"x"' } }));
    const second = mockFetch(new Response(null, { status: 304 }));
    const cms = client(first.fn, { cache });
    await cms.getSite();
    await expect(cms.withFetch(second.fn).getSite()).resolves.toEqual({ a: 1 });
    expect(headersOf(second.calls[0])['If-None-Match']).toBe('"x"');
  });

  it('drops the least recently used entries', () => {
    const cache = memoryCache({ maxEntries: 2 });
    const entry = { etag: '"e"', body: '{}', storedAt: 0 };
    cache.set('a', entry);
    cache.set('b', entry);
    cache.get('a');
    cache.set('c', entry);
    expect(cache.get('b')).toBeUndefined();
    expect(cache.get('a')).toBeDefined();
    expect(cache.get('c')).toBeDefined();
    expect(() => memoryCache({ maxEntries: 0 })).toThrow(RangeError);
  });
});
