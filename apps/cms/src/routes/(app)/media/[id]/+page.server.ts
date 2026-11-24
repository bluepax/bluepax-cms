import { error, redirect } from '@sveltejs/kit';
import { z } from 'zod';
import { m } from '#lib/paraglide/messages.js';
import { requirePermission } from '#lib/server/guard.ts';
import { exportInstanceConfig } from '#lib/server/instance.ts';
import {
  MEDIA_PERMISSION,
  mediaAction,
  mediaContext,
  uploadedFile,
} from '#lib/server/media-actions.ts';
import { describeUsage } from '#lib/server/media-usages.ts';
import { MediaError } from '#lib/server/modules/media/errors.ts';
import { ACCEPT_ATTRIBUTE } from '#lib/server/modules/media/files.ts';
import {
  deleteMedia,
  folderOptions,
  folderPath,
  getMediaDetail,
  listAllFolders,
  replaceMedia,
  updateMedia,
} from '#lib/server/modules/media/library.ts';
import { readStorageConfig } from '#lib/server/modules/media/storage.ts';
import { localizedText, text } from '#lib/server/modules/site/forms.ts';
import { contentLanguages } from '#lib/server/modules/site/settings.ts';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, params, url }) => {
  requirePermission(locals, MEDIA_PERMISSION);
  const { db, storage } = mediaContext();
  let detail;
  try {
    detail = await getMediaDetail(db, storage, params.id);
  } catch (err) {
    if (err instanceof MediaError && err.code === 'not_found') error(404, m.error_not_found());
    throw err;
  }
  const [folders, config] = await Promise.all([listAllFolders(db), exportInstanceConfig(db)]);
  return {
    media: detail,
    usages: detail.usages.map(describeUsage),
    path: folderPath(folders, detail.folderId),
    folders: folderOptions(folders),
    languages: config.languages.content,
    accept: ACCEPT_ATTRIBUTE,
    replaced: url.searchParams.has('replaced'),
    // The library serves files itself, so their absolute URL starts with this origin.
    origin: url.origin,
  };
};

export const actions: Actions = {
  update: (event) =>
    mediaAction(event, MEDIA_PERMISSION, 'update', async (form, actor) => {
      const { db } = mediaContext();
      const { codes } = await contentLanguages(db);
      const folder = text(form, 'folder');
      if (folder && !z.uuid().safeParse(folder).success) throw new MediaError('folder_not_found');
      await updateMedia(
        db,
        event.params.id,
        {
          name: text(form, 'name'),
          alt: localizedText(form, 'alt', codes),
          folderId: folder || null,
        },
        codes,
        actor,
      );
    }),
  replace: (event) =>
    mediaAction(event, MEDIA_PERMISSION, 'replace', async (form, actor) => {
      const ctx = mediaContext();
      const file = await uploadedFile(form, 'file');
      if (!file) throw new MediaError('empty_file');
      const { uploadLimitsMb } = await readStorageConfig(ctx.db);
      await replaceMedia(ctx, event.params.id, file, uploadLimitsMb, actor);
      redirect(303, `/media/${event.params.id}?replaced`);
    }),
  delete: (event) =>
    mediaAction(event, MEDIA_PERMISSION, 'delete', async (_form, actor) => {
      const ctx = mediaContext();
      const { folderId } = await getMediaDetail(ctx.db, ctx.storage, event.params.id);
      await deleteMedia(ctx, event.params.id, actor);
      redirect(
        303,
        `/media?${new URLSearchParams({ ...(folderId && { folder: folderId }), deleted: 'media' })}`,
      );
    }),
};
