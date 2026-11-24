import { requirePermission } from '#lib/server/guard.ts';
import { exportInstanceConfig } from '#lib/server/instance.ts';
import { generalInput, text } from '#lib/server/modules/site/forms.ts';
import { readSiteData, saveBranding, saveGeneral } from '#lib/server/modules/site/settings.ts';
import { getDatabase } from '#lib/server/runtime.ts';
import { SITE_PERMISSION, siteAction } from '#lib/server/site-actions.ts';
import type { Actions, PageServerLoad } from './$types';

const timeZones = ['UTC', ...Intl.supportedValuesOf('timeZone').filter((z) => z !== 'UTC')];

export const load: PageServerLoad = async ({ locals }) => {
  requirePermission(locals, SITE_PERMISSION);
  const db = getDatabase();
  const [config, branding] = await Promise.all([
    exportInstanceConfig(db),
    readSiteData(db, 'site.branding'),
  ]);
  return { site: config.site, branding, timeZones };
};

export const actions: Actions = {
  general: (event) =>
    siteAction(event, 'general', (form, actor) =>
      saveGeneral(getDatabase(), generalInput(form), actor),
    ),
  branding: (event) =>
    siteAction(event, 'branding', (form, actor) =>
      saveBranding(getDatabase(), { themeColor: text(form, 'themeColor') }, actor),
    ),
};
