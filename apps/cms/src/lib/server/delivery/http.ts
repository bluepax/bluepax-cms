// The Delivery API's HTTP layer (docs/spec/README.md chapter 6, "约定"; docs/adr/0012): server-side
// calls with a Delivery Token, a rate limit per token (1200 requests a minute), a CORS allow-list,
// JSON errors `{ error: { code, message, details } }`, `ETag` / `Last-Modified` with 304 on
// `If-None-Match`. Endpoints that do not exist, or whose module is off, answer 404.
import { createHash } from 'node:crypto';
import type { ModuleRegistry } from '@bluepax/core';
import type { Database } from '@bluepax/db';
import type { StorageDriver } from '@bluepax/storage';
import { exportInstanceConfig } from '../instance.ts';
import { log } from '../log.ts';
import { authenticateDeliveryToken } from '../modules/api/tokens.ts';
import { SlidingWindowLimiter } from '../security/rate-limit.ts';
import { DeliveryError, deliveryContext } from './context.ts';
import { openApiDocument } from './openapi.ts';
import { matchOperation } from './operations.ts';

export const DELIVERY_PREFIX = '/api/delivery/v1';
/** Chapter 6 and 13: 1200 requests a minute per Delivery Token. */
export const TOKEN_RATE_LIMIT = 1200;
/** Requests with an unknown token per client address and minute, against guessing. */
export const INVALID_TOKEN_LIMIT = 60;

const tokenLimiter = new SlidingWindowLimiter(TOKEN_RATE_LIMIT, 60_000);
const invalidLimiter = new SlidingWindowLimiter(INVALID_TOKEN_LIMIT, 60_000);

export interface DeliveryDeps {
  db: Database;
  storage: StorageDriver;
  registry: ModuleRegistry;
  /** The CMS's public origin; media URLs start with it. */
  origin: string;
  clientIp: string | null;
  previewSecret: () => Promise<string | null>;
  now?: Date;
  /** Defaults to the process-wide limiters; tests pass their own. */
  limiters?: { token: SlidingWindowLimiter; invalid: SlidingWindowLimiter };
}

const ALLOWED_HEADERS = 'Authorization, Content-Type, If-None-Match';

function errorResponse(
  status: number,
  code: string,
  message: string,
  details?: Record<string, unknown>,
  headers: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify({ error: { code, message, ...(details && { details }) } }), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      ...headers,
    },
  });
}

/** Origins a browser may call from: the frontend's and the CMS's own (chapter 6, "CORS 白名单"). */
async function allowedOrigins(db: Database, own: string): Promise<Set<string>> {
  const { frontend } = await exportInstanceConfig(db);
  return new Set([new URL(frontend.baseUrl).origin, own]);
}

function bearer(request: Request): string | null {
  const header = request.headers.get('authorization');
  if (!header) return null;
  const [scheme, value, ...rest] = header.trim().split(/ +/);
  if (rest.length > 0 || !value || scheme?.toLowerCase() !== 'bearer') return '';
  return value;
}

function etagOf(body: string): string {
  return `"${createHash('sha256').update(body).digest('base64url').slice(0, 27)}"`;
}

function matchesEtag(header: string | null, etag: string): boolean {
  if (!header) return false;
  return header
    .split(',')
    .map((v) => v.trim().replace(/^W\//, ''))
    .some((v) => v === etag || v === '*');
}

/** Answers one request under `/api/delivery/v1`. */
export async function handleDeliveryRequest(
  request: Request,
  deps: DeliveryDeps,
): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname.slice(DELIVERY_PREFIX.length) || '/';
  const cors: Record<string, string> = { Vary: 'Origin' };
  try {
    const origin = request.headers.get('origin');
    if (origin) {
      if (!(await allowedOrigins(deps.db, deps.origin)).has(origin)) {
        return errorResponse(
          403,
          'origin_not_allowed',
          'This origin may not call the API',
          undefined,
          cors,
        );
      }
      cors['Access-Control-Allow-Origin'] = origin;
    }
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: {
          ...cors,
          'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
          'Access-Control-Allow-Headers': ALLOWED_HEADERS,
          'Access-Control-Max-Age': '600',
        },
      });
    }

    // The OpenAPI document describes the API, not the instance's content: no token needed.
    if (path === '/openapi.json' && (request.method === 'GET' || request.method === 'HEAD')) {
      return json(request, openApiDocument(), { ...cors, 'Cache-Control': 'public, max-age=300' });
    }

    const match = matchOperation(request.method, path);
    if (!match) return errorResponse(404, 'not_found', 'Unknown endpoint', undefined, cors);
    if ('methods' in match) {
      return errorResponse(405, 'method_not_allowed', 'Method not allowed', undefined, {
        ...cors,
        Allow: [...match.methods, 'HEAD', 'OPTIONS'].join(', '),
      });
    }

    const now = deps.now ?? new Date();
    const token = bearer(request);
    if (token === null) {
      return errorResponse(401, 'unauthorized', 'A Delivery Token is required', undefined, {
        ...cors,
        'WWW-Authenticate': 'Bearer',
      });
    }
    const auth = token ? await authenticateDeliveryToken(deps.db, token, now) : null;
    if (!auth) {
      const limited = (deps.limiters?.invalid ?? invalidLimiter).hit(
        deps.clientIp ?? 'unknown',
        now.getTime(),
      );
      if (!limited.allowed) return rateLimited(limited.retryAfterMs, cors);
      return errorResponse(
        401,
        'invalid_token',
        'The token is unknown, revoked or expired',
        undefined,
        {
          ...cors,
          'WWW-Authenticate': 'Bearer error="invalid_token"',
        },
      );
    }
    if (!auth.scopes.has('delivery:read')) {
      return errorResponse(
        403,
        'insufficient_scope',
        'The token lacks the delivery:read scope',
        {
          scope: 'delivery:read',
        },
        cors,
      );
    }
    const limit = (deps.limiters?.token ?? tokenLimiter).hit(auth.id, now.getTime());
    if (!limit.allowed) return rateLimited(limit.retryAfterMs, cors);
    const rate = {
      'X-RateLimit-Limit': String((deps.limiters?.token ?? tokenLimiter).limit),
      'X-RateLimit-Remaining': String(limit.remaining),
    };

    const ctx = await deliveryContext({
      db: deps.db,
      storage: deps.storage,
      origin: deps.origin,
      registry: deps.registry,
      now,
      previewSecret: deps.previewSecret,
    });
    const { operation, params } = match;
    if (!ctx.active.has(operation.module)) {
      return errorResponse(404, 'not_found', 'Unknown endpoint', undefined, { ...cors, ...rate });
    }
    const result = await operation.handler(ctx, { query: url.searchParams, path: params });
    const headers: Record<string, string> = { ...cors, ...rate };
    if (operation.cache === 'no-store') {
      headers['Cache-Control'] = 'no-store';
      headers['X-Robots-Tag'] = 'noindex, nofollow';
      return json(request, result.body, headers, false);
    }
    headers['Cache-Control'] = 'private, no-cache';
    if (result.lastModified) headers['Last-Modified'] = result.lastModified.toUTCString();
    return json(request, result.body, headers);
  } catch (error) {
    if (error instanceof DeliveryError) {
      return errorResponse(error.status, error.code, error.message, error.details, cors);
    }
    log('error', 'delivery request failed', { path, error: String(error) });
    return errorResponse(500, 'internal_error', 'Something went wrong', undefined, cors);
  }
}

function rateLimited(retryAfterMs: number, cors: Record<string, string>): Response {
  const seconds = Math.max(1, Math.ceil(retryAfterMs / 1000));
  return errorResponse(
    429,
    'rate_limited',
    'Too many requests',
    { retryAfter: seconds },
    {
      ...cors,
      'Retry-After': String(seconds),
    },
  );
}

/** A JSON response with an ETag; 304 when the client already has this body. */
function json(
  request: Request,
  body: unknown,
  headers: Record<string, string>,
  conditional = true,
): Response {
  const text = JSON.stringify(body);
  const all: Record<string, string> = {
    'Content-Type': 'application/json; charset=utf-8',
    ...headers,
  };
  if (conditional) {
    const etag = etagOf(text);
    all.ETag = etag;
    if (matchesEtag(request.headers.get('if-none-match'), etag)) {
      delete all['Content-Type'];
      return new Response(null, { status: 304, headers: all });
    }
  }
  return new Response(request.method === 'HEAD' ? null : text, { status: 200, headers: all });
}
