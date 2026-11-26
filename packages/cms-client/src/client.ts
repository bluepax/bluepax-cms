// Typed client of the BluePax CMS Delivery API v1 (docs/spec/README.md chapter 6, docs/adr/0013).
// Server-side only: the Delivery Token must never reach a browser. Uses the standard `fetch`, or
// one passed in (SvelteKit's `event.fetch`, a test double, …).
import { CmsError, errorFromResponse } from './errors.ts';
import type { ResponseCache, CachedResponse } from './cache.ts';
import type {
  Author,
  AuthorList,
  BlockSchemas,
  Page,
  Post,
  PostList,
  Preview,
  Resolution,
  Site,
  TermList,
} from './contract.ts';
import {
  DELIVERY_API_PREFIX,
  DELIVERY_ENDPOINTS,
  OPENAPI_PATH,
  type OperationId,
} from './endpoints.ts';

/** Any `fetch`-compatible function: the global one, SvelteKit's `event.fetch`, undici's, … */
export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

export interface CmsClientOptions {
  /** The CMS's public URL, e.g. `https://cms.example.com`; the client adds `/api/delivery/v1`. */
  baseUrl: string;
  /** A Delivery Token with the `delivery:read` scope, from the CMS's "接入与 API" page. */
  token: string;
  /** Defaults to the global `fetch`. */
  fetch?: FetchLike | undefined;
  /** Milliseconds before a request is given up (`kind: 'timeout'`); 0 for none. Default 10 000. */
  timeout?: number | undefined;
  /** Keeps responses with their `ETag` and revalidates them with `If-None-Match`. */
  cache?: ResponseCache | undefined;
  /**
   * With a `cache`: when the CMS cannot be reached, times out or answers 5xx, return the cached
   * body of the same request instead of throwing (chapter 6, frontend checklist step 7).
   */
  staleIfError?: boolean | undefined;
  /** Called whenever a stale body is returned instead of an error. */
  onStale?: ((info: { url: string; error: CmsError; storedAt: number }) => void) | undefined;
  /**
   * The client refuses to run where `window` and `document` exist, so a token cannot end up in
   * browser code by accident. Set this only for a trusted non-browser runtime that defines them.
   */
  dangerouslyAllowBrowser?: boolean | undefined;
}

export interface RequestOptions {
  signal?: AbortSignal | undefined;
}

export interface LocaleQuery {
  /** Content language (BCP 47, any case); the primary language when left out. */
  locale?: string | undefined;
}

export interface PagingQuery {
  /** 1–10 000, default 1. */
  page?: number | undefined;
  /** 1–100, default 20. */
  pageSize?: number | undefined;
}

export interface PostListQuery extends LocaleQuery, PagingQuery {
  /** Only posts in the category with this slug. */
  category?: string | undefined;
  /** Only posts with the tag with this slug. */
  tag?: string | undefined;
  /** Only posts by the author with this slug. */
  author?: string | undefined;
}

export interface TermListQuery extends LocaleQuery, PagingQuery {
  /** Only the term with this slug (for a category or tag page's `seo`). */
  slug?: string | undefined;
}

export type AuthorListQuery = LocaleQuery & PagingQuery;

type Query = Record<string, string | number | undefined>;

export const DEFAULT_TIMEOUT = 10_000;

function isBrowser(): boolean {
  return 'window' in globalThis && 'document' in globalThis;
}

/** `https://cms.example.com/` and `https://cms.example.com` give the same API root. */
function apiRoot(baseUrl: string): string {
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    throw new TypeError(`baseUrl is not a URL: ${baseUrl}`);
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new TypeError('baseUrl must be an http(s) URL');
  }
  let path = url.pathname;
  while (path.endsWith('/')) path = path.slice(0, -1);
  return `${url.origin}${path}${DELIVERY_API_PREFIX}`;
}

function hasNoStore(response: Response): boolean {
  const value = response.headers.get('cache-control');
  return value !== null && value.split(',').some((d) => d.trim().toLowerCase() === 'no-store');
}

interface Shared {
  root: string;
  token: string;
  timeout: number;
  cache: ResponseCache | undefined;
  staleIfError: boolean;
  onStale: CmsClientOptions['onStale'];
}

export class CmsClient {
  readonly #options: CmsClientOptions;
  readonly #shared: Shared;
  readonly #fetch: FetchLike;

  constructor(options: CmsClientOptions) {
    this.#options = options;
    if (isBrowser() && !options.dangerouslyAllowBrowser) {
      throw new Error(
        'The BluePax CMS client runs on the server only: a Delivery Token must never reach a browser',
      );
    }
    if (typeof options.token !== 'string' || options.token.trim() === '') {
      throw new TypeError('token is required (a Delivery Token from the CMS)');
    }
    const timeout = options.timeout ?? DEFAULT_TIMEOUT;
    if (!Number.isFinite(timeout) || timeout < 0) throw new RangeError('timeout must be >= 0');
    const fetchFn = options.fetch ?? globalThis.fetch;
    if (typeof fetchFn !== 'function') throw new TypeError('no fetch function is available');
    this.#fetch = fetchFn;
    this.#shared = {
      root: apiRoot(options.baseUrl),
      token: options.token.trim(),
      timeout,
      cache: options.cache,
      staleIfError: options.staleIfError ?? false,
      onStale: options.onStale,
    };
  }

  /**
   * A client that sends its requests through `fetch` (e.g. SvelteKit's `event.fetch`), with this
   * one's settings and the same cache.
   */
  withFetch(fetch: FetchLike): CmsClient {
    return new CmsClient({ ...this.#options, fetch });
  }

  /** The API root, e.g. `https://cms.example.com/api/delivery/v1`. */
  get apiUrl(): string {
    return this.#shared.root;
  }

  /** `GET /site`: site settings, publisher, navigation, route templates and media origin. */
  getSite(query: LocaleQuery = {}, options?: RequestOptions): Promise<Site> {
    return this.#call('getSite', {}, { ...query }, options);
  }

  /**
   * `GET /routes/resolve`: what a frontend path is. Always resolves when the API answers; the
   * outcome is in `status` (200 with the content, 301 with `location`, 404).
   */
  resolveRoute(path: string, options?: RequestOptions): Promise<Resolution> {
    return this.#call('resolveRoute', {}, { path }, options);
  }

  /** `GET /pages/{slug}`: a published block page. */
  getPage(slug: string, query: LocaleQuery = {}, options?: RequestOptions): Promise<Page> {
    return this.#call('getPage', { slug }, { ...query }, options);
  }

  /** `GET /posts`: published posts, newest first, optionally of one category, tag or author. */
  listPosts(query: PostListQuery = {}, options?: RequestOptions): Promise<PostList> {
    return this.#call('listPosts', {}, { ...query }, options);
  }

  /** `GET /posts/{slug}`: a published post. */
  getPost(slug: string, query: LocaleQuery = {}, options?: RequestOptions): Promise<Post> {
    return this.#call('getPost', { slug }, { ...query }, options);
  }

  /** `GET /post-categories`: categories in the editors' order. */
  listPostCategories(query: TermListQuery = {}, options?: RequestOptions): Promise<TermList> {
    return this.#call('listPostCategories', {}, { ...query }, options);
  }

  /** `GET /tags`: tags by name. */
  listTags(query: TermListQuery = {}, options?: RequestOptions): Promise<TermList> {
    return this.#call('listTags', {}, { ...query }, options);
  }

  /** `GET /authors`: authors with a public author page, by name. */
  listAuthors(query: AuthorListQuery = {}, options?: RequestOptions): Promise<AuthorList> {
    return this.#call('listAuthors', {}, { ...query }, options);
  }

  /** `GET /authors/{slug}`: an author with a public author page. */
  getAuthor(slug: string, query: LocaleQuery = {}, options?: RequestOptions): Promise<Author> {
    return this.#call('getAuthor', { slug }, { ...query }, options);
  }

  /** `GET /schema/blocks`: JSON Schemas of the blocks this instance offers and of rich text. */
  getBlockSchemas(options?: RequestOptions): Promise<BlockSchemas> {
    return this.#call('getBlockSchemas', {}, {}, options);
  }

  /**
   * `GET /preview/{token}`: the page or post of a preview link, whatever its status. Never
   * cached. Render it with `noindex` and `Cache-Control: no-store`.
   */
  getPreview(token: string, options?: RequestOptions): Promise<Preview> {
    return this.#call('getPreview', { token }, {}, options, { cache: false });
  }

  /** `GET /openapi.json`: the OpenAPI 3.1 document of the Delivery API (no token needed). */
  getOpenApi(options?: RequestOptions): Promise<Record<string, unknown>> {
    return this.#request(`${this.#shared.root}${OPENAPI_PATH}`, options, {
      auth: false,
      cache: true,
    });
  }

  #call<T>(
    operation: OperationId,
    params: Record<string, string>,
    query: Query,
    options: RequestOptions | undefined,
    flags: { cache: boolean } = { cache: true },
  ): Promise<T> {
    const endpoint = DELIVERY_ENDPOINTS[operation];
    let path: string = endpoint.path;
    for (const [name, value] of Object.entries(params)) {
      if (typeof value !== 'string' || value === '') {
        return Promise.reject(new TypeError(`${name} must be a non-empty string`));
      }
      path = path.replace(`{${name}}`, encodeURIComponent(value));
    }
    const search = new URLSearchParams();
    for (const name of endpoint.query as readonly string[]) {
      const value = query[name];
      if (value !== undefined && value !== '') search.set(name, String(value));
    }
    const qs = search.toString();
    const url = `${this.#shared.root}${path}${qs ? `?${qs}` : ''}`;
    return this.#request(url, options, { auth: true, cache: flags.cache });
  }

  async #request<T>(
    url: string,
    options: RequestOptions | undefined,
    flags: { auth: boolean; cache: boolean },
  ): Promise<T> {
    const { cache, timeout, token } = this.#shared;
    const useCache = flags.cache && cache !== undefined;
    const cached = useCache ? await cache.get(url) : undefined;
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (flags.auth) headers.Authorization = `Bearer ${token}`;
    if (cached) headers['If-None-Match'] = cached.etag;

    const signals: AbortSignal[] = [];
    if (options?.signal) signals.push(options.signal);
    const timer = timeout > 0 ? AbortSignal.timeout(timeout) : undefined;
    if (timer) signals.push(timer);
    const signal = signals.length > 1 ? AbortSignal.any(signals) : signals[0];

    let response: Response;
    let text: string;
    try {
      response = await this.#fetch(url, {
        method: 'GET',
        headers,
        ...(signal && { signal }),
      });
      if (response.status === 304 && cached) return JSON.parse(cached.body) as T;
      if (!response.ok) {
        const error = await errorFromResponse(response, url);
        if (error.kind === 'server') return this.#stale(url, cached, error);
        throw error;
      }
      text = await response.text();
    } catch (error) {
      if (error instanceof CmsError) throw error;
      // The caller's own abort is not a CMS failure: pass it on unchanged.
      if (options?.signal?.aborted) throw error;
      const timedOut = timer?.aborted === true;
      const failure = new CmsError(
        {
          kind: timedOut ? 'timeout' : 'network',
          status: 0,
          code: timedOut ? 'timeout' : 'network_error',
          message: timedOut
            ? `The CMS did not answer within ${timeout} ms`
            : 'The CMS could not be reached',
          url,
        },
        { cause: error },
      );
      return this.#stale(url, cached, failure);
    }

    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch (error) {
      throw new CmsError(
        {
          kind: 'invalid_response',
          status: response.status,
          code: 'invalid_response',
          message: 'The CMS answered with something that is not JSON',
          url,
        },
        { cause: error },
      );
    }
    const etag = response.headers.get('etag');
    if (useCache && etag && !hasNoStore(response)) {
      await cache.set(url, { etag, body: text, storedAt: Date.now() });
    }
    return body as T;
  }

  #stale<T>(url: string, cached: CachedResponse | undefined, error: CmsError): T {
    if (!cached || !this.#shared.staleIfError) throw error;
    this.#shared.onStale?.({ url, error, storedAt: cached.storedAt });
    return JSON.parse(cached.body) as T;
  }
}

/** A Delivery API client; see `CmsClientOptions`. */
export function createCmsClient(options: CmsClientOptions): CmsClient {
  return new CmsClient(options);
}
