import { redirect } from '@sveltejs/kit';
import { audit } from '#lib/server/audit.ts';
import { accountFailure, parseLocale } from '#lib/server/forms.ts';
import { field, requirePermission, secretField } from '#lib/server/guard.ts';
import { clientIp } from '#lib/server/http.ts';
import { createUser, listRoles } from '#lib/server/modules/users/accounts.ts';
import { defaultAdminLocale } from '#lib/server/instance.ts';
import { getDatabase } from '#lib/server/runtime.ts';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
  requirePermission(locals, 'users.manage');
  const db = getDatabase();
  const roles = await listRoles(db);
  return {
    roles: roles.map(({ id, name, key }) => ({ id, name, key })),
    defaultLocale: await defaultAdminLocale(db),
  };
};

export const actions: Actions = {
  default: async (event) => {
    const actor = requirePermission(event.locals, 'users.manage');
    const form = await event.request.formData();
    const values = {
      email: field(form, 'email'),
      displayName: field(form, 'displayName'),
      roleId: field(form, 'roleId'),
      locale: parseLocale(field(form, 'locale')),
    };
    const db = getDatabase();
    let id: string;
    try {
      id = await createUser(db, { ...values, password: secretField(form, 'password') });
    } catch (error) {
      return accountFailure(error, { values });
    }
    await audit(db, {
      action: 'users.create',
      actorId: actor.id,
      targetType: 'user',
      targetId: id,
      details: { email: values.email, roleId: values.roleId },
      ip: clientIp(event),
    });
    redirect(303, `/users/${id}?created=1`);
  },
};
