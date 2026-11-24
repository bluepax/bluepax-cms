import { requirePermission } from '#lib/server/guard.ts';
import { smtpInput } from '#lib/server/modules/site/forms.ts';
import { clearSmtp, readSmtp, saveSmtp } from '#lib/server/modules/site/settings.ts';
import { encryptionKey, getDatabase } from '#lib/server/runtime.ts';
import { SITE_PERMISSION, siteAction } from '#lib/server/site-actions.ts';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
  requirePermission(locals, SITE_PERMISSION);
  return { smtp: await readSmtp(getDatabase()) };
};

export const actions: Actions = {
  save: (event) =>
    siteAction(event, 'smtp', (form, actor) => {
      const { settings, password } = smtpInput(form);
      return saveSmtp(getDatabase(), settings, password, encryptionKey(), actor);
    }),
  clear: (event) => siteAction(event, 'clear', (_form, actor) => clearSmtp(getDatabase(), actor)),
};
