import { requireUser } from '#lib/server/guard.ts';
import { registry } from '#lib/server/modules.ts';
import { can } from '#lib/server/modules/users/auth.ts';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = ({ locals }) => {
  const user = requireUser(locals);
  // The menu comes from the module manifests, filtered by the user's permissions.
  const menu = registry
    .all()
    .flatMap((module) => module.menu ?? [])
    .filter((item) => can(user, item.permission))
    .map(({ label, href }) => ({ label, href }));
  return {
    user: { displayName: user.displayName, email: user.email, roleName: user.role.name },
    menu,
  };
};
