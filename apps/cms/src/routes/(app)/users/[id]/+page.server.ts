import { error, type RequestEvent } from '@sveltejs/kit';
import { audit } from '#lib/server/audit.ts';
import { accountFailure, parseLocale } from '#lib/server/forms.ts';
import { field, requirePermission, secretField } from '#lib/server/guard.ts';
import { clientIp } from '#lib/server/http.ts';
import {
  getUser,
  listRoles,
  setPassword,
  setUserDisabled,
  unlockUser,
  updateUser,
} from '#lib/server/modules/users/accounts.ts';
import {
  listSessions,
  revokeSessionById,
  revokeUserSessions,
} from '#lib/server/modules/users/auth.ts';
import { getDatabase } from '#lib/server/runtime.ts';
import { m } from '#lib/paraglide/messages.js';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, params, url }) => {
  const actor = requirePermission(locals, 'users.manage');
  const db = getDatabase();
  const user = await getUser(db, params.id);
  if (!user) error(404, m.error_not_found());
  const now = new Date();
  const [roles, sessions] = await Promise.all([listRoles(db), listSessions(db, user.id, now)]);
  return {
    user: { ...user, locked: user.lockedUntil !== null && user.lockedUntil > now },
    isSelf: user.id === actor.id,
    roles: roles.map(({ id, name }) => ({ id, name })),
    // Session ids are hashes of the cookie token, safe to show and to submit.
    sessions: sessions.map((s) => ({ ...s, current: s.id === locals.sessionId })),
    created: url.searchParams.has('created'),
  };
};

/** Runs a change on the user in the URL and writes it to the audit log. */
async function change(
  event: RequestEvent<{ id: string }>,
  action: string,
  run: (actorId: string, form: FormData) => Promise<Record<string, unknown> | void>,
) {
  const actor = requirePermission(event.locals, 'users.manage');
  const form = await event.request.formData();
  let details: Record<string, unknown> | void;
  try {
    details = await run(actor.id, form);
  } catch (err) {
    return accountFailure(err);
  }
  await audit(getDatabase(), {
    action,
    actorId: actor.id,
    targetType: 'user',
    targetId: event.params.id,
    details: details ?? {},
    ip: clientIp(event),
  });
  return { saved: action };
}

export const actions: Actions = {
  update: (event) =>
    change(event, 'users.update', async (actorId, form) => {
      const input = {
        displayName: field(form, 'displayName'),
        roleId: field(form, 'roleId'),
        locale: parseLocale(field(form, 'locale')),
      };
      await updateUser(getDatabase(), actorId, event.params.id, input);
      return { roleId: input.roleId };
    }),
  disable: (event) =>
    change(event, 'users.disable', (actorId) =>
      setUserDisabled(getDatabase(), actorId, event.params.id, true),
    ),
  enable: (event) =>
    change(event, 'users.enable', (actorId) =>
      setUserDisabled(getDatabase(), actorId, event.params.id, false),
    ),
  unlock: (event) =>
    change(event, 'users.unlock', () => unlockUser(getDatabase(), event.params.id)),
  password: (event) =>
    change(event, 'users.password_reset', (_actorId, form) =>
      setPassword(getDatabase(), event.params.id, secretField(form, 'password')),
    ),
  endSession: (event) =>
    change(event, 'users.session_end', async (_actorId, form) => {
      await revokeSessionById(getDatabase(), event.params.id, field(form, 'session'));
    }),
  endAllSessions: (event) =>
    change(event, 'users.sessions_end', () => revokeUserSessions(getDatabase(), event.params.id)),
};
