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

export function clientIp(event: RequestEvent): string | null {
  try {
    return event.getClientAddress();
  } catch {
    return null;
  }
}
