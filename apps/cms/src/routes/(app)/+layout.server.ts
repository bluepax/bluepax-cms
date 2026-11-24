import { requireUser } from '#lib/server/guard.ts';
import { activeModules } from '#lib/server/instance.ts';
import { registry } from '#lib/server/modules.ts';
import { can } from '#lib/server/modules/users/auth.ts';
import { getDatabase } from '#lib/server/runtime.ts';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async ({ locals }) => {
  const user = requireUser(locals);
  // The menu comes from the manifests of active modules, filtered by the user's permissions.
  const active = await activeModules(getDatabase(), registry);
  const menu = registry
    .all()
    .filter((module) => active.has(module.id))
    .flatMap((module) => module.menu ?? [])
    .filter((item) => can(user, item.permission))
    .map(({ label, href }) => ({ label, href }));
  return {
    user: { displayName: user.displayName, email: user.email, roleName: user.role.name },
    menu,
  };
};
