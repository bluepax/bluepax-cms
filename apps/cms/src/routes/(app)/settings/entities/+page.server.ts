import { requirePermission } from '#lib/server/guard.ts';
import { listEntities } from '#lib/server/modules/site/entities.ts';
import { getDatabase } from '#lib/server/runtime.ts';
import { SITE_PERMISSION } from '#lib/server/site-actions.ts';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, url }) => {
  requirePermission(locals, SITE_PERMISSION);
  return { entities: await listEntities(getDatabase()), deleted: url.searchParams.has('deleted') };
};
