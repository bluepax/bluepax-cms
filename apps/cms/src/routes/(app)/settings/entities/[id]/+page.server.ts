import { error, redirect } from '@sveltejs/kit';
import { m } from '#lib/paraglide/messages.js';
import { requirePermission } from '#lib/server/guard.ts';
import {
  createLocation,
  deleteEntity,
  deleteLocation,
  getEntity,
  updateEntity,
  updateLocation,
} from '#lib/server/modules/site/entities.ts';
import { entityInput, locationInput, text } from '#lib/server/modules/site/forms.ts';
import { contentLanguages } from '#lib/server/modules/site/settings.ts';
import { getDatabase } from '#lib/server/runtime.ts';
import { SITE_PERMISSION, siteAction } from '#lib/server/site-actions.ts';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, params, url }) => {
  requirePermission(locals, SITE_PERMISSION);
  const entity = await getEntity(getDatabase(), params.id);
  if (!entity) error(404, m.error_not_found());
  return { entity, created: url.searchParams.has('created') };
};

const languages = async () => (await contentLanguages(getDatabase())).codes;
const locationForm = (form: FormData) => `location:${text(form, 'location')}`;

export const actions: Actions = {
  update: (event) =>
    siteAction(event, 'update', async (form, actor) =>
      updateEntity(getDatabase(), event.params.id, entityInput(form, await languages()), actor),
    ),
  delete: (event) =>
    siteAction(event, 'delete', async (_form, actor) => {
      await deleteEntity(getDatabase(), event.params.id, actor);
      redirect(303, '/settings/entities?deleted');
    }),
  addLocation: (event) =>
    siteAction(event, 'location:new', async (form, actor) =>
      createLocation(getDatabase(), event.params.id, locationInput(form, await languages()), actor),
    ),
  updateLocation: (event) =>
    siteAction(event, locationForm, async (form, actor) =>
      updateLocation(
        getDatabase(),
        event.params.id,
        text(form, 'location'),
        locationInput(form, await languages()),
        actor,
      ),
    ),
  deleteLocation: (event) =>
    siteAction(event, locationForm, (form, actor) =>
      deleteLocation(getDatabase(), event.params.id, text(form, 'location'), actor),
    ),
};
