import { json, redirect } from '@sveltejs/kit';
import { sequence, type Handle, type ServerInit } from '@sveltejs/kit/hooks';
import { getTextDirection } from '#lib/paraglide/runtime.js';
import { paraglideMiddleware } from '#lib/paraglide/server.js';
import { isCrossSiteWrite, isPublicPath } from '#lib/server/http.ts';
import { validateSession } from '#lib/server/modules/users/auth.ts';
import { getDatabase, hasRole, startup } from '#lib/server/runtime.ts';
import {
  clearSessionCookie,
  SESSION_COOKIE,
  setSessionCookie,
} from '#lib/server/session-cookie.ts';

export const init: ServerInit = async () => {
  await startup();
};

/** Security headers on every response (chapter 9); CSP comes from vite.config.ts. */
const securityHeaders: Handle = async ({ event, resolve }) => {
  let response = await resolve(event);
  const headers = {
    'X-Robots-Tag': 'noindex, nofollow',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'same-origin',
    'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
  };
  try {
    for (const [name, value] of Object.entries(headers)) response.headers.set(name, value);
  } catch {
    // Some responses have immutable headers; copy them into a new response.
    response = new Response(response.body, response);
    for (const [name, value] of Object.entries(headers)) response.headers.set(name, value);
  }
  return response;
};

/** A worker-only process still answers the container healthcheck. */
const webRole: Handle = ({ event, resolve }) => {
  if (!hasRole('web') && event.url.pathname !== '/api/health') {
    return new Response('Not Found', { status: 404 });
  }
  return resolve(event);
};

const csrf: Handle = ({ event, resolve }) => {
  if (isCrossSiteWrite(event.request, event.url)) {
    return new Response('Cross-site request blocked', { status: 403 });
  }
  return resolve(event);
};

const session: Handle = async ({ event, resolve }) => {
  event.locals.user = null;
  event.locals.sessionId = null;
  const token = event.cookies.get(SESSION_COOKIE);
  if (token) {
    const valid = await validateSession(getDatabase(), token, new Date());
    if (valid) {
      event.locals.user = valid.user;
      event.locals.sessionId = valid.id;
      if (valid.refreshed) setSessionCookie(event.cookies, token, valid.expiresAt);
    } else {
      clearSessionCookie(event.cookies);
    }
  }
  return resolve(event);
};

const guard: Handle = ({ event, resolve }) => {
  const { pathname, search } = event.url;
  if (!event.locals.user && !isPublicPath(pathname)) {
    if (pathname.startsWith('/api/')) {
      return json({ error: { code: 'unauthorized', message: 'Login required' } }, { status: 401 });
    }
    const next = pathname === '/' ? '' : `?next=${encodeURIComponent(pathname + search)}`;
    redirect(303, `/login${next}`);
  }
  return resolve(event);
};

/** Admin UI language (zh / en) from the locale cookie, see setLocaleCookie. */
const i18n: Handle = ({ event, resolve }) =>
  paraglideMiddleware(event.request, ({ request, locale }) =>
    resolve(
      { ...event, request },
      {
        transformPageChunk: ({ html }) =>
          html
            .replace('%paraglide.lang%', locale)
            .replace('%paraglide.dir%', getTextDirection(locale)),
      },
    ),
  );

export const handle: Handle = sequence(securityHeaders, webRole, csrf, session, guard, i18n);
