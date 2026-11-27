// Request helpers shared by hooks and routes.
import type { RequestEvent } from '@sveltejs/kit';

/** Paths authenticated by tokens or keys instead of the admin session (chapter 6). */
const TOKEN_PATHS = ['/api/delivery/', '/api/inquiry/', '/api/manage/'];
/** Paths reachable without logging in. */
const PUBLIC_PATHS = ['/login', '/setup', '/api/health'];
/** The local media source (chapter 5); frontends and visitors load media from here. */
const MEDIA_PREFIX = '/uploads/';

export function isTokenPath(pathname: string): boolean {
  return TOKEN_PATHS.some((p) => pathname.startsWith(p));
}

export function isMediaPath(pathname: string): boolean {
  return pathname.startsWith(MEDIA_PREFIX);
}

export function isPublicPath(pathname: string): boolean {
  return isTokenPath(pathname) || isMediaPath(pathname) || PUBLIC_PATHS.includes(pathname);
}

/**
 * CSRF check for admin writes (chapter 9): a state-changing request must come from this
 * origin. Browsers send `Origin` (or `Sec-Fetch-Site`) on every POST/PUT/PATCH/DELETE.
 */
export function isCrossSiteWrite(request: Request, url: URL): boolean {
  if (['GET', 'HEAD', 'OPTIONS'].includes(request.method)) return false;
  if (isTokenPath(url.pathname)) return false;
  const origin = request.headers.get('origin');
  if (origin) return origin !== url.origin;
  const site = request.headers.get('sec-fetch-site');
  return site !== 'same-origin';
}

/**
 * Largest request body outside the media upload forms (docs/adr/0015). adapter-node's
 * BODY_SIZE_LIMIT has to allow the largest upload for every route, so other routes are held
 * to this smaller limit by their declared Content-Length; bodies without one stay capped by
 * BODY_SIZE_LIMIT.
 */
export const FORM_BODY_LIMIT = 10 * 1024 * 1024;

/** The media library and a media item's page: their forms upload and replace files. */
export function isUploadPath(pathname: string): boolean {
  if (pathname === '/media') return true;
  if (!pathname.startsWith('/media/')) return false;
  const rest = pathname.slice('/media/'.length);
  return rest.length > 0 && !rest.includes('/');
}

/** True when a request declares a body larger than its route accepts. */
export function isOversizedBody(request: Request, url: URL): boolean {
  if (isUploadPath(url.pathname)) return false;
  const length = request.headers.get('content-length');
  return length !== null && Number(length) > FORM_BODY_LIMIT;
}

/** adapter-node's reading of BODY_SIZE_LIMIT: bytes, or a number with K, M or G. */
export function parseBodySizeLimit(value: string | undefined): number {
  const raw = (value ?? '512K').trim();
  const unit = ({ K: 1024, M: 1024 ** 2, G: 1024 ** 3 } as Record<string, number>)[
    raw.slice(-1).toUpperCase()
  ];
  return Number(unit ? raw.slice(0, -1) : raw) * (unit ?? 1);
}

export function clientIp(event: RequestEvent): string | null {
  try {
    return event.getClientAddress();
  } catch {
    return null;
  }
}
