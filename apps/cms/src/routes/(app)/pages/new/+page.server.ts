import { redirect } from '@sveltejs/kit';
import { field, requirePermission } from '#lib/server/guard.ts';
import { mediaContext } from '#lib/server/media-actions.ts';
import { PAGES_EDIT, currentSetup, pageAction } from '#lib/server/pages-actions.ts';
import { createPage } from '#lib/server/modules/pages/pages.ts';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, url }) => {
  requirePermission(locals, PAGES_EDIT);
  const setup = await currentSetup();
  const requested = url.searchParams.get('locale');
  return {
    languages: setup.languages,
    locale: setup.languages.some((l) => l.code === requested) ? requested! : setup.primary,
    reserved: [...setup.reserved.configured, ...setup.reserved.routes].sort(),
  };
};

export const actions: Actions = {
  create: (event) =>
    pageAction(event, [], 'create', async (form, actor) => {
      const locale = field(form, 'locale');
      const id = await createPage(
        mediaContext(),
        { locale, title: field(form, 'title'), slug: field(form, 'slug') },
        actor,
      );
      redirect(303, `/pages/${id}?locale=${encodeURIComponent(locale)}`);
    }),
};
