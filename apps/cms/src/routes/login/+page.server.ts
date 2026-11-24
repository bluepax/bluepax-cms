import { fail, redirect, type RequestEvent } from '@sveltejs/kit';
import { audit } from '#lib/server/audit.ts';
import { field, safeNext, secretField } from '#lib/server/guard.ts';
import { clientIp } from '#lib/server/http.ts';
import {
  checkCredentials,
  checkTotpLogin,
  createSession,
  loadAuthUser,
  type LoginResult,
} from '#lib/server/modules/users/auth.ts';
import { loginLimiter } from '#lib/server/modules/users/limits.ts';
import { getDatabase, encryptionKey, signingKey } from '#lib/server/runtime.ts';
import { sign, verifySigned } from '#lib/server/security/crypto.ts';
import {
  setLocaleCookie,
  setSessionCookie,
  TOTP_CHALLENGE_COOKIE,
} from '#lib/server/session-cookie.ts';
import type { Actions, PageServerLoad } from './$types';

const CHALLENGE_TTL_MS = 5 * 60 * 1000;

interface Challenge {
  userId: string;
  exp: number;
}

function readChallenge(event: RequestEvent): Challenge | null {
  const token = event.cookies.get(TOTP_CHALLENGE_COOKIE);
  const challenge = token ? verifySigned<Challenge>(token, signingKey('totp-challenge')) : null;
  return challenge && challenge.exp > Date.now() ? challenge : null;
}

const minutesUntil = (date: Date) => Math.max(1, Math.ceil((date.getTime() - Date.now()) / 60000));

function rateLimited(event: RequestEvent) {
  const limit = loginLimiter.hit(clientIp(event) ?? 'unknown');
  return limit.allowed
    ? null
    : fail(429, { error: 'rate_limited', minutes: Math.ceil(limit.retryAfterMs / 60000) });
}

async function finishLogin(event: RequestEvent, userId: string): Promise<never> {
  const db = getDatabase();
  const user = await loadAuthUser(db, userId);
  if (!user) redirect(303, '/login');
  const ip = clientIp(event);
  const session = await createSession(
    db,
    user.id,
    { ip, userAgent: event.request.headers.get('user-agent') },
    new Date(),
  );
  setSessionCookie(event.cookies, session.token, session.expiresAt);
  setLocaleCookie(event.cookies, user.locale);
  event.cookies.delete(TOTP_CHALLENGE_COOKIE, { path: '/login' });
  await audit(db, { action: 'auth.login', actorId: user.id, ip });
  redirect(303, safeNext(event.url.searchParams.get('next')));
}

async function failed(event: RequestEvent, result: LoginResult, email: string) {
  const ip = clientIp(event);
  if (result.kind === 'locked') {
    return fail(423, { error: 'locked', minutes: minutesUntil(result.until), email });
  }
  await audit(getDatabase(), { action: 'auth.login_failed', details: { email }, ip });
  return fail(400, { error: 'invalid', email });
}

export const load: PageServerLoad = (event) => {
  if (event.locals.user) redirect(303, '/');
  return { totp: readChallenge(event) !== null };
};

export const actions: Actions = {
  password: async (event) => {
    const limited = rateLimited(event);
    if (limited) return limited;
    const form = await event.request.formData();
    const email = field(form, 'email');
    const result = await checkCredentials(
      getDatabase(),
      email,
      secretField(form, 'password'),
      new Date(),
    );
    if (result.kind === 'ok') return finishLogin(event, result.userId);
    if (result.kind === 'totp') {
      const challenge: Challenge = { userId: result.userId, exp: Date.now() + CHALLENGE_TTL_MS };
      event.cookies.set(TOTP_CHALLENGE_COOKIE, sign(challenge, signingKey('totp-challenge')), {
        path: '/login',
        httpOnly: true,
        secure: true,
        sameSite: 'strict',
        maxAge: CHALLENGE_TTL_MS / 1000,
      });
      return { totp: true };
    }
    return failed(event, result, email);
  },

  totp: async (event) => {
    const limited = rateLimited(event);
    if (limited) return limited;
    const challenge = readChallenge(event);
    if (!challenge) return fail(400, { error: 'totp_expired' });
    const form = await event.request.formData();
    const result = await checkTotpLogin(
      getDatabase(),
      challenge.userId,
      field(form, 'code'),
      new Date(),
      encryptionKey(),
    );
    if (result.kind === 'ok') return finishLogin(event, result.userId);
    if (result.kind === 'locked') {
      event.cookies.delete(TOTP_CHALLENGE_COOKIE, { path: '/login' });
      return fail(423, { error: 'locked', minutes: minutesUntil(result.until) });
    }
    await audit(getDatabase(), {
      action: 'auth.totp_failed',
      targetType: 'user',
      targetId: challenge.userId,
      ip: clientIp(event),
    });
    return fail(400, { error: 'totp_invalid', totp: true });
  },
};
