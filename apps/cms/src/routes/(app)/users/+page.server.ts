import { requirePermission } from '#lib/server/guard.ts';
import { listUsers } from '#lib/server/modules/users/accounts.ts';
import { getDatabase } from '#lib/server/runtime.ts';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
  requirePermission(locals, 'users.manage');
  const now = new Date();
  const users = await listUsers(getDatabase());
  return {
    users: users.map((u) => ({
      ...u,
      locked: u.lockedUntil !== null && u.lockedUntil > now,
      totp: u.totpEnabledAt !== null,
    })),
  };
};
