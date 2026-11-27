import { requirePermission } from '#lib/server/guard.ts';
import { exportInstanceConfig } from '#lib/server/instance.ts';
import { instantMessagingInput, socialInput, text } from '#lib/server/modules/site/forms.ts';
import {
  contentLanguages,
  readSiteData,
  saveContact,
  saveInstantMessaging,
  saveSocial,
} from '#lib/server/modules/site/settings.ts';
import { getDatabase } from '#lib/server/runtime.ts';
import { SITE_PERMISSION, siteAction } from '#lib/server/site-actions.ts';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
  requirePermission(locals, SITE_PERMISSION);
  const db = getDatabase();
  const [config, contact, social] = await Promise.all([
    exportInstanceConfig(db),
    readSiteData(db, 'site.contact'),
    readSiteData(db, 'site.social'),
  ]);
  return { im: config.site.im, contact, social };
};

export const actions: Actions = {
  contact: (event) =>
    siteAction(event, 'contact', (form, actor) =>
      saveContact(getDatabase(), { email: text(form, 'email'), phone: text(form, 'phone') }, actor),
    ),
  im: (event) =>
    siteAction(event, 'im', async (form, actor) => {
      const db = getDatabase();
      const { codes } = await contentLanguages(db);
      await saveInstantMessaging(db, instantMessagingInput(form, codes), actor);
    }),
  removeIm: (event) =>
    siteAction(event, 'removeIm', (_form, actor) =>
      saveInstantMessaging(getDatabase(), null, actor),
    ),
  social: (event) =>
    siteAction(event, 'social', (form, actor) =>
      saveSocial(getDatabase(), socialInput(form), actor),
    ),
};
