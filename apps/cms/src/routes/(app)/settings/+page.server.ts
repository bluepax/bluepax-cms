import { requirePermission } from '#lib/server/guard.ts';
import { exportInstanceConfig } from '#lib/server/instance.ts';
import { mediaContext } from '#lib/server/media-actions.ts';
import { getMediaViews } from '#lib/server/modules/media/library.ts';
import { authorOptions } from '#lib/server/modules/posts/authors.ts';
import { generalInput, text } from '#lib/server/modules/site/forms.ts';
import { readSiteData, saveGeneral } from '#lib/server/modules/site/settings.ts';
import { getDatabase } from '#lib/server/runtime.ts';
import { SITE_PERMISSION, siteAction } from '#lib/server/site-actions.ts';
import type { Actions, PageServerLoad } from './$types';

const timeZones = ['UTC', ...Intl.supportedValuesOf('timeZone').filter((z) => z !== 'UTC')];

export const load: PageServerLoad = async ({ locals }) => {
  requirePermission(locals, SITE_PERMISSION);
  const { db, storage } = mediaContext();
  const [config, publisher, authors] = await Promise.all([
    exportInstanceConfig(db),
    readSiteData(db, 'site.publisher'),
    authorOptions(db),
  ]);
  const [image] = publisher.image ? await getMediaViews(db, storage, [publisher.image]) : [];
  return {
    site: config.site,
    primaryLanguage: config.languages.primary,
    publisherImage: image ?? null,
    publisherAuthor: publisher.authorId,
    authors,
    timeZones,
  };
};

export const actions: Actions = {
  general: (event) =>
    siteAction(event, 'general', (form, actor) =>
      saveGeneral(getDatabase(), generalInput(form), actor, {
        media: mediaContext(),
        image: text(form, 'publisher.image') || null,
        authorId: text(form, 'publisher.authorId') || null,
      }),
    ),
};
