import { requirePermission } from '#lib/server/guard.ts';
import { localizedText, navItemInput, text } from '#lib/server/modules/site/forms.ts';
import {
  createNavItem,
  deleteNavItem,
  listNav,
  NAV_MAX_DEPTH,
  updateNavItem,
  type NavMenu,
} from '#lib/server/modules/site/navigation.ts';
import { contentLanguages, readSiteData, saveFooter } from '#lib/server/modules/site/settings.ts';
import { getDatabase } from '#lib/server/runtime.ts';
import { SITE_PERMISSION, siteAction } from '#lib/server/site-actions.ts';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
  requirePermission(locals, SITE_PERMISSION);
  const db = getDatabase();
  const [header, footer, footerText] = await Promise.all([
    listNav(db, 'header'),
    listNav(db, 'footer'),
    readSiteData(db, 'site.footer'),
  ]);
  return { menus: { header, footer }, footerText: footerText.text, maxDepth: NAV_MAX_DEPTH };
};

const languages = async () => (await contentLanguages(getDatabase())).codes;
const itemForm = (form: FormData) => `nav:${text(form, 'item')}`;

export const actions: Actions = {
  create: (event) =>
    siteAction(
      event,
      (form) => `nav:new:${text(form, 'menu')}`,
      async (form, actor) =>
        createNavItem(
          getDatabase(),
          text(form, 'menu') as NavMenu,
          navItemInput(form, await languages()),
          actor,
        ),
    ),
  update: (event) =>
    siteAction(event, itemForm, async (form, actor) =>
      updateNavItem(
        getDatabase(),
        text(form, 'item'),
        navItemInput(form, await languages()),
        actor,
      ),
    ),
  delete: (event) =>
    siteAction(event, itemForm, (form, actor) =>
      deleteNavItem(getDatabase(), text(form, 'item'), actor),
    ),
  footer: (event) =>
    siteAction(event, 'footer', async (form, actor) =>
      saveFooter(getDatabase(), { text: localizedText(form, 'text', await languages()) }, actor),
    ),
};
