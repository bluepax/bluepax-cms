// Cookies of the admin UI (chapter 9): the session cookie is HttpOnly, Secure, SameSite=Lax.
import type { Cookies } from '@sveltejs/kit';

export const SESSION_COOKIE = 'bluepax_session';
/** Short-lived, signed: a password was right and a TOTP code is still needed. */
export const TOTP_CHALLENGE_COOKIE = 'bluepax_2fa';
/** Read by Paraglide (also in the browser), so not HttpOnly. */
export const LOCALE_COOKIE = 'bluepax_locale';

export function setSessionCookie(cookies: Cookies, token: string, expiresAt: Date): void {
  cookies.set(SESSION_COOKIE, token, {
    path: '/',
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    expires: expiresAt,
  });
}

export function clearSessionCookie(cookies: Cookies): void {
  cookies.delete(SESSION_COOKIE, { path: '/' });
}

export function setLocaleCookie(cookies: Cookies, locale: string): void {
  cookies.set(LOCALE_COOKIE, locale, {
    path: '/',
    httpOnly: false,
    secure: true,
    sameSite: 'lax',
    maxAge: 365 * 24 * 60 * 60,
  });
}
