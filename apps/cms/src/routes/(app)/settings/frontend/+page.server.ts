import { routeFixedSegments } from '@bluepax/presets';
import { requirePermission } from '#lib/server/guard.ts';
import { exportInstanceConfig } from '#lib/server/instance.ts';
import { lines } from '#lib/server/modules/site/forms.ts';
import { saveFrontend } from '#lib/server/modules/site/settings.ts';
import { getDatabase } from '#lib/server/runtime.ts';
import { SITE_PERMISSION, siteAction } from '#lib/server/site-actions.ts';
import type { Actions, PageServerLoad } from './$types';

// The frontend section of the instance configuration (chapter 2, "前台"): reserved slugs now,
// route templates with their own item (docs/adr/0009).
export const load: PageServerLoad = async ({ locals }) => {
  requirePermission(locals, SITE_PERMISSION);
  const { frontend } = await exportInstanceConfig(getDatabase());
  return { frontend, routeSegments: routeFixedSegments() };
};

export const actions: Actions = {
  default: (event) =>
    siteAction(event, 'frontend', (form, actor) =>
      saveFrontend(getDatabase(), { reservedSlugs: lines(form, 'reservedSlugs') }, actor),
    ),
};
