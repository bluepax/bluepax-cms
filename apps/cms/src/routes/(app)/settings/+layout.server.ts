import { requirePermission } from '#lib/server/guard.ts';
import { exportInstanceConfig } from '#lib/server/instance.ts';
import { getDatabase } from '#lib/server/runtime.ts';
import { SITE_PERMISSION } from '#lib/server/site-actions.ts';
import type { LayoutServerLoad } from './$types';

// Every settings page is admin only; actions check again since they skip layout loads.
export const load: LayoutServerLoad = async ({ locals }) => {
  requirePermission(locals, SITE_PERMISSION);
  const { languages } = await exportInstanceConfig(getDatabase());
  return { languages: languages.content, primaryLanguage: languages.primary };
};
