import { requirePermission } from '#lib/server/guard.ts';
import { STORAGE_PERMISSION, mediaAction, mediaContext } from '#lib/server/media-actions.ts';
import { storageStats } from '#lib/server/modules/media/library.ts';
import { readStorageConfig, saveStorageSettings } from '#lib/server/modules/media/storage.ts';
import { integer } from '#lib/server/modules/site/forms.ts';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
  requirePermission(locals, STORAGE_PERMISSION);
  const { db, storage } = mediaContext();
  const [config, stats] = await Promise.all([readStorageConfig(db), storageStats(db)]);
  return {
    config,
    local: stats.find((s) => s.driver === storage.name) ?? { objects: 0, bytes: 0 },
  };
};

export const actions: Actions = {
  save: (event) =>
    mediaAction(event, STORAGE_PERMISSION, 'save', (form, actor) =>
      saveStorageSettings(
        mediaContext().db,
        {
          cacheDays: integer(form, 'cacheDays'),
          uploadLimitsMb: {
            image: integer(form, 'image'),
            document: integer(form, 'document'),
            video: integer(form, 'video'),
          },
        },
        actor,
      ),
    ),
};
