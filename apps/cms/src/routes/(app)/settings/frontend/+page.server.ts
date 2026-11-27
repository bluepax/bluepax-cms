import { DEFAULT_ROUTE_TEMPLATES, ROUTE_KINDS, routeFixedSegments } from '@bluepax/presets';
import { field, requirePermission } from '#lib/server/guard.ts';
import { exportInstanceConfig } from '#lib/server/instance.ts';
import { lines } from '#lib/server/modules/site/forms.ts';
import { saveFrontend, saveRouteTemplates } from '#lib/server/modules/site/settings.ts';
import { getDatabase } from '#lib/server/runtime.ts';
import { SITE_PERMISSION, siteAction } from '#lib/server/site-actions.ts';
import type { Actions, PageServerLoad } from './$types';

// The frontend section of the instance configuration (chapter 2, "前台"): route templates
// (chapter 6, docs/adr/0011) and reserved slugs. Admin only (`site.manage`).
export const load: PageServerLoad = async ({ locals }) => {
  requirePermission(locals, SITE_PERMISSION);
  const { frontend, languages } = await exportInstanceConfig(getDatabase());
  return {
    frontend,
    primary: languages.primary,
    defaults: DEFAULT_ROUTE_TEMPLATES,
    routeSegments: routeFixedSegments(frontend.routes),
  };
};

export const actions: Actions = {
  reserved: (event) =>
    siteAction(event, 'frontend', (form, actor) =>
      saveFrontend(getDatabase(), { reservedSlugs: lines(form, 'reservedSlugs') }, actor),
    ),
  routes: (event) =>
    siteAction(event, 'routes', (form, actor) => {
      const confirmed = Number(field(form, 'confirm'));
      return saveRouteTemplates(
        getDatabase(),
        {
          routes: Object.fromEntries(ROUTE_KINDS.map((kind) => [kind, field(form, kind)])),
          confirmed: Number.isInteger(confirmed) && confirmed > 0 ? confirmed : null,
        },
        actor,
      );
    }),
};
