// One error type for everything a Delivery API call can fail with (docs/adr/0013). API errors
// carry the body `{ error: { code, message, details } }` (docs/spec/README.md chapter 6);
// failures without a usable response get a code of their own.

export type CmsErrorKind =
  /** 400 `invalid_query` / `invalid_locale`, 405: the request itself is wrong. */
  | 'bad_request'
  /** 401 `unauthorized` / `invalid_token`: no token, or an unknown, revoked or expired one. */
  | 'unauthorized'
  /** 403 `insufficient_scope`, `origin_not_allowed`, `preview_invalid`, `preview_expired`. */
  | 'forbidden'
  /** 404: unknown endpoint, a switched-off module, or nothing published under this slug. */
  | 'not_found'
  /** 410: permanently deleted. */
  | 'gone'
  /** 429 `rate_limited`; see `retryAfter`. */
  | 'rate_limited'
  /** Any other 4xx. */
  | 'http'
  /** 5xx. */
  | 'server'
  /** No response: DNS, connection refused, TLS, … */
  | 'network'
  /** No response within the client's `timeout`. */
  | 'timeout'
  /** A response that is not the JSON the API promises. */
  | 'invalid_response';

export interface CmsErrorInit {
  kind: CmsErrorKind;
  /** HTTP status; 0 when there was no response. */
  status: number;
  code: string;
  message: string;
  details?: Record<string, unknown> | undefined;
  /** Seconds to wait before retrying, from `Retry-After`; null when not given. */
  retryAfter?: number | null | undefined;
  /** The request URL (it never contains the token). */
  url: string;
}

export class CmsError extends Error {
  override readonly name = 'CmsError';
  readonly kind: CmsErrorKind;
  readonly status: number;
  /** The API's error code (`invalid_token`, `not_found`, …) or `network_error`, `timeout`, `http_<status>`, `invalid_response`. */
  readonly code: string;
  readonly details: Readonly<Record<string, unknown>>;
  readonly retryAfter: number | null;
  readonly url: string;

  constructor(init: CmsErrorInit, options?: { cause?: unknown }) {
    super(init.message, options);
    this.kind = init.kind;
    this.status = init.status;
    this.code = init.code;
    this.details = init.details ?? {};
    this.retryAfter = init.retryAfter ?? null;
    this.url = init.url;
  }
}

/** True for a `CmsError`, also one from another copy of this package. */
export function isCmsError(value: unknown): value is CmsError {
  return (
    value instanceof CmsError ||
    (value instanceof Error && value.name === 'CmsError' && 'kind' in value && 'code' in value)
  );
}

export function kindOfStatus(status: number): CmsErrorKind {
  switch (status) {
    case 400:
    case 405:
      return 'bad_request';
    case 401:
      return 'unauthorized';
    case 403:
      return 'forbidden';
    case 404:
      return 'not_found';
    case 410:
      return 'gone';
    case 429:
      return 'rate_limited';
    default:
      return status >= 500 ? 'server' : 'http';
  }
}

/** `Retry-After` as seconds from now: delay-seconds or an HTTP date (RFC 9110). */
export function parseRetryAfter(value: string | null, now = Date.now()): number | null {
  if (value === null) return null;
  const text = value.trim();
  if (text === '') return null;
  if ([...text].every((c) => c >= '0' && c <= '9')) return Number(text);
  const date = Date.parse(text);
  if (Number.isNaN(date)) return null;
  return Math.max(0, Math.ceil((date - now) / 1000));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The error for a response that is not 2xx (or 304). */
export async function errorFromResponse(response: Response, url: string): Promise<CmsError> {
  const status = response.status;
  let code = `http_${status}`;
  let message = `The CMS answered ${status}${response.statusText ? ` ${response.statusText}` : ''}`;
  let details: Record<string, unknown> | undefined;
  try {
    const body: unknown = JSON.parse(await response.text());
    const error = isRecord(body) ? body.error : undefined;
    if (isRecord(error) && typeof error.code === 'string') {
      code = error.code;
      if (typeof error.message === 'string') message = error.message;
      if (isRecord(error.details)) details = error.details;
    }
  } catch {
    // Not the API's JSON error body (e.g. a proxy's HTML page): keep the HTTP status.
  }
  let retryAfter = parseRetryAfter(response.headers.get('retry-after'));
  if (retryAfter === null && typeof details?.retryAfter === 'number')
    retryAfter = details.retryAfter;
  return new CmsError({
    kind: kindOfStatus(status),
    status,
    code,
    message,
    details,
    retryAfter,
    url,
  });
}
