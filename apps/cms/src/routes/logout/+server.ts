import { redirect } from '@sveltejs/kit';
import { audit } from '#lib/server/audit.ts';
import { clientIp } from '#lib/server/http.ts';
import { revokeSession } from '#lib/server/modules/users/auth.ts';
import { getDatabase } from '#lib/server/runtime.ts';
import { clearSessionCookie, SESSION_COOKIE } from '#lib/server/session-cookie.ts';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async (event) => {
  const token = event.cookies.get(SESSION_COOKIE);
  if (token) {
    const db = getDatabase();
    await revokeSession(db, token);
    if (event.locals.user) {
      await audit(db, {
        action: 'auth.logout',
        actorId: event.locals.user.id,
        ip: clientIp(event),
      });
    }
  }
  clearSessionCookie(event.cookies);
  redirect(303, '/login');
};
