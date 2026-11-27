import { audit } from '#lib/server/audit.ts';
import { accountFailure } from '#lib/server/forms.ts';
import { field, requirePermission } from '#lib/server/guard.ts';
import { clientIp } from '#lib/server/http.ts';
import { registry } from '#lib/server/modules.ts';
import {
  createRole,
  deleteRole,
  listRoles,
  updateRole,
} from '#lib/server/modules/users/accounts.ts';
import { getDatabase } from '#lib/server/runtime.ts';
import type { Actions, PageServerLoad } from './$types';

/** Every permission point declared by a module manifest. */
function declaredPermissions() {
  return registry
    .all()
    .flatMap((module) => (module.permissions ?? []).map((p) => ({ ...p, module: module.id })));
}

function chosenPermissions(form: FormData): string[] {
  const known = new Set(declaredPermissions().map((p) => p.name));
  return form
    .getAll('permission')
    .filter((p): p is string => typeof p === 'string' && known.has(p));
}

export const load: PageServerLoad = async ({ locals }) => {
  requirePermission(locals, 'users.manage');
  return { roles: await listRoles(getDatabase()), permissions: declaredPermissions() };
};

export const actions: Actions = {
  create: async (event) => {
    const actor = requirePermission(event.locals, 'users.manage');
    const form = await event.request.formData();
    const input = {
      key: field(form, 'key'),
      name: field(form, 'name'),
      permissions: chosenPermissions(form),
    };
    const db = getDatabase();
    let id: string;
    try {
      id = await createRole(db, input);
    } catch (error) {
      return accountFailure(error, { values: input });
    }
    await audit(db, {
      action: 'roles.create',
      actorId: actor.id,
      targetType: 'role',
      targetId: id,
      details: input,
      ip: clientIp(event),
    });
    return { saved: 'create' };
  },

  update: async (event) => {
    const actor = requirePermission(event.locals, 'users.manage');
    const form = await event.request.formData();
    const id = field(form, 'id');
    const input = { name: field(form, 'name'), permissions: chosenPermissions(form) };
    const db = getDatabase();
    try {
      await updateRole(db, id, input);
    } catch (error) {
      return accountFailure(error);
    }
    await audit(db, {
      action: 'roles.update',
      actorId: actor.id,
      targetType: 'role',
      targetId: id,
      details: input,
      ip: clientIp(event),
    });
    return { saved: 'update' };
  },

  delete: async (event) => {
    const actor = requirePermission(event.locals, 'users.manage');
    const form = await event.request.formData();
    const id = field(form, 'id');
    const db = getDatabase();
    try {
      await deleteRole(db, id);
    } catch (error) {
      return accountFailure(error);
    }
    await audit(db, {
      action: 'roles.delete',
      actorId: actor.id,
      targetType: 'role',
      targetId: id,
      ip: clientIp(event),
    });
    return { saved: 'delete' };
  },
};
