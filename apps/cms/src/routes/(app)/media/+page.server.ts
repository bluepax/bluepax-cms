import { error, redirect } from '@sveltejs/kit';
import { z } from 'zod';
import { m } from '#lib/paraglide/messages.js';
import { requirePermission } from '#lib/server/guard.ts';
import {
  MEDIA_PERMISSION,
  STORAGE_PERMISSION,
  mediaAction,
  mediaContext,
} from '#lib/server/media-actions.ts';
import { MediaError } from '#lib/server/modules/media/errors.ts';
import { ACCEPT_ATTRIBUTE } from '#lib/server/modules/media/files.ts';
import {
  createFolder,
  deleteFolder,
  folderPath,
  listAllFolders,
  listMedia,
  MAX_FOLDER_DEPTH,
  renameFolder,
  uploadMedia,
} from '#lib/server/modules/media/library.ts';
import { readStorageConfig } from '#lib/server/modules/media/storage.ts';
import { text } from '#lib/server/modules/site/forms.ts';
import { can } from '#lib/server/modules/users/auth.ts';
import type { Actions, PageServerLoad } from './$types';

const uuid = z.uuid();

/** A folder ID from a form or query field; empty is the top level. */
function folderId(value: string | null): string | null {
  if (!value) return null;
  if (!uuid.safeParse(value).success) throw new MediaError('folder_not_found');
  return value;
}

export const load: PageServerLoad = async ({ locals, url }) => {
  const user = requirePermission(locals, MEDIA_PERMISSION);
  const { db, storage } = mediaContext();
  const folders = await listAllFolders(db);
  const current = url.searchParams.get('folder') || null;
  const path = folderPath(folders, current);
  if (current && path.length === 0) error(404, m.error_not_found());
  const query = url.searchParams.get('q')?.trim() ?? '';
  const page = Math.max(Number(url.searchParams.get('page')) || 1, 1);
  const [list, config] = await Promise.all([
    listMedia(db, storage, { folderId: query ? 'all' : current, query, page }),
    readStorageConfig(db),
  ]);
  return {
    folderId: current,
    path,
    children: folders.filter((f) => f.parentId === current),
    canNest: path.length < MAX_FOLDER_DEPTH,
    query,
    list,
    limits: config.uploadLimitsMb,
    accept: ACCEPT_ATTRIBUTE,
    canStorage: can(user, STORAGE_PERMISSION),
    deleted: url.searchParams.get('deleted'),
  };
};

export const actions: Actions = {
  /** One or more files; the page uploads them one request per file. */
  upload: (event) =>
    mediaAction(event, MEDIA_PERMISSION, 'upload', async (form, actor) => {
      const ctx = mediaContext();
      const folder = folderId(text(form, 'folder'));
      const { uploadLimitsMb } = await readStorageConfig(ctx.db);
      const files = form.getAll('file').filter((f): f is File => f instanceof File && f.size > 0);
      if (files.length === 0) throw new MediaError('empty_file');
      const results = [];
      for (const file of files) {
        try {
          const data = new Uint8Array(await file.arrayBuffer());
          const { id } = await uploadMedia(
            ctx,
            { name: file.name, data },
            folder,
            uploadLimitsMb,
            actor,
          );
          results.push({ name: file.name, id });
        } catch (err) {
          if (!(err instanceof MediaError) || err.code === 'folder_not_found') throw err;
          results.push({ name: file.name, error: err.code, details: err.details });
        }
      }
      return { results };
    }),
  createFolder: (event) =>
    mediaAction(event, MEDIA_PERMISSION, 'createFolder', (form, actor) =>
      createFolder(
        mediaContext().db,
        { name: text(form, 'name'), parentId: folderId(text(form, 'parent')) },
        actor,
      ),
    ),
  renameFolder: (event) =>
    mediaAction(event, MEDIA_PERMISSION, 'renameFolder', async (form, actor) => {
      const id = folderId(text(form, 'id'));
      if (!id) throw new MediaError('folder_not_found');
      await renameFolder(mediaContext().db, id, text(form, 'name'), actor);
    }),
  deleteFolder: (event) =>
    mediaAction(event, MEDIA_PERMISSION, 'deleteFolder', async (form, actor) => {
      const id = folderId(text(form, 'id'));
      if (!id) throw new MediaError('folder_not_found');
      const { db } = mediaContext();
      const parent = folderPath(await listAllFolders(db), id).at(-2)?.id;
      await deleteFolder(db, id, actor);
      redirect(
        303,
        `/media?${new URLSearchParams({ ...(parent && { folder: parent }), deleted: 'folder' })}`,
      );
    }),
};
