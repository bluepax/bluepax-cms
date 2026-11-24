import { requirePermission } from '#lib/server/guard.ts';
import { exportInstanceConfig } from '#lib/server/instance.ts';
import { languagesInput } from '#lib/server/modules/site/forms.ts';
import { saveLanguages } from '#lib/server/modules/site/settings.ts';
import { getDatabase } from '#lib/server/runtime.ts';
import { SITE_PERMISSION, siteAction } from '#lib/server/site-actions.ts';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
  requirePermission(locals, SITE_PERMISSION);
  const { languages } = await exportInstanceConfig(getDatabase());
  return { admin: languages.admin };
};

export const actions: Actions = {
  default: (event) =>
    siteAction(event, 'languages', (form, actor) =>
      saveLanguages(getDatabase(), languagesInput(form), actor),
    ),
};
