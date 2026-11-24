// Starts an admin session after a successful login or after the setup wizard.
import type { RequestEvent } from '@sveltejs/kit';
import { audit } from './audit.ts';
import { clientIp } from './http.ts';
import { createSession, loadAuthUser, type AuthUser } from './modules/users/auth.ts';
import { getDatabase } from './runtime.ts';
import { setLocaleCookie, setSessionCookie } from './session-cookie.ts';

export async function signIn(event: RequestEvent, userId: string): Promise<AuthUser | null> {
  const db = getDatabase();
  const user = await loadAuthUser(db, userId);
  if (!user) return null;
  const ip = clientIp(event);
  const session = await createSession(
    db,
    user.id,
    { ip, userAgent: event.request.headers.get('user-agent') },
    new Date(),
  );
  setSessionCookie(event.cookies, session.token, session.expiresAt);
  setLocaleCookie(event.cookies, user.locale);
  await audit(db, { action: 'auth.login', actorId: user.id, ip });
  return user;
}
