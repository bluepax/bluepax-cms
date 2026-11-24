import { requirePermission } from '#lib/server/guard.ts';
import { mediaContext } from '#lib/server/media-actions.ts';
import { getMediaViews } from '#lib/server/modules/media/library.ts';
import { SITE_ICON_MIN } from '#lib/server/modules/media/images.ts';
import { text } from '#lib/server/modules/site/forms.ts';
import { readSiteData, saveBranding } from '#lib/server/modules/site/settings.ts';
import { SITE_PERMISSION, siteAction } from '#lib/server/site-actions.ts';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
  requirePermission(locals, SITE_PERMISSION);
  const { db, storage } = mediaContext();
  const branding = await readSiteData(db, 'site.branding');
  const [logo, icon] = await Promise.all(
    [branding.logo, branding.icon].map(async (id) =>
      id ? ((await getMediaViews(db, storage, [id]))[0] ?? null) : null,
    ),
  );
  return { branding, logo: logo ?? null, icon: icon ?? null, iconMin: SITE_ICON_MIN };
};

export const actions: Actions = {
  branding: (event) =>
    siteAction(event, 'branding', (form, actor) =>
      saveBranding(
        mediaContext(),
        {
          themeColor: text(form, 'themeColor'),
          logo: text(form, 'logo'),
          icon: text(form, 'icon'),
        },
        actor,
      ),
    ),
};
