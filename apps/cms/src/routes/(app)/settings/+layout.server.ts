import { BACKUPS_PERMISSION } from '#lib/server/backups.ts';
import { requirePermission } from '#lib/server/guard.ts';
import { can } from '#lib/server/modules/users/auth.ts';
import { exportInstanceConfig } from '#lib/server/instance.ts';
import { getDatabase } from '#lib/server/runtime.ts';
import { SITE_PERMISSION } from '#lib/server/site-actions.ts';
import type { LayoutServerLoad } from './$types';

// Every settings page is admin only; actions check again since they skip layout loads.
export const load: LayoutServerLoad = async ({ locals }) => {
  const user = requirePermission(locals, SITE_PERMISSION);
  const { languages } = await exportInstanceConfig(getDatabase());
  return {
    languages: languages.content,
    primaryLanguage: languages.primary,
    canBackups: can(user, BACKUPS_PERMISSION),
  };
};
