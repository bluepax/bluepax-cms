import { stringifyConfig } from '@bluepax/presets';
import { requirePermission } from '#lib/server/guard.ts';
import { exportInstanceConfig } from '#lib/server/instance.ts';
import { getDatabase } from '#lib/server/runtime.ts';
import { SITE_PERMISSION } from '#lib/server/site-actions.ts';
import type { PageServerLoad } from './$types';

// "设置 → 实例配置" (chapter 2): the current configuration in the config-file format.
export const load: PageServerLoad = async ({ locals }) => {
  requirePermission(locals, SITE_PERMISSION);
  return { yaml: stringifyConfig(await exportInstanceConfig(getDatabase())) };
};
