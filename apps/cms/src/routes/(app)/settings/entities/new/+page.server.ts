import { redirect } from '@sveltejs/kit';
import { requirePermission } from '#lib/server/guard.ts';
import { createEntity } from '#lib/server/modules/site/entities.ts';
import { entityInput } from '#lib/server/modules/site/forms.ts';
import { contentLanguages } from '#lib/server/modules/site/settings.ts';
import { getDatabase } from '#lib/server/runtime.ts';
import { SITE_PERMISSION, siteAction } from '#lib/server/site-actions.ts';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = ({ locals }) => {
  requirePermission(locals, SITE_PERMISSION);
};

export const actions: Actions = {
  default: (event) =>
    siteAction(event, 'create', async (form, actor) => {
      const db = getDatabase();
      const { codes } = await contentLanguages(db);
      const id = await createEntity(db, entityInput(form, codes), actor);
      redirect(303, `/settings/entities/${id}?created`);
    }),
};
