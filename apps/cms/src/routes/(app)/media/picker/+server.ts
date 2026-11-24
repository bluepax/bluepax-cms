// Media list for the media picker of other admin pages (e.g. the site logo). Whoever may edit
// a record that points at media may browse the library: `media.edit` or `site.manage`.
import { error, json } from '@sveltejs/kit';
import { m } from '#lib/paraglide/messages.js';
import { requireUser } from '#lib/server/guard.ts';
import { MEDIA_PERMISSION, mediaContext } from '#lib/server/media-actions.ts';
import { MEDIA_KINDS, type MediaKind } from '#lib/server/modules/media/files.ts';
import { listMedia } from '#lib/server/modules/media/library.ts';
import { can } from '#lib/server/modules/users/auth.ts';
import { SITE_PERMISSION } from '#lib/server/site-actions.ts';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ locals, url }) => {
  const user = requireUser(locals);
  if (!can(user, MEDIA_PERMISSION) && !can(user, SITE_PERMISSION)) error(403, m.forbidden());
  const kind = url.searchParams.get('kind');
  const mimeType = url.searchParams.get('mime');
  const { db, storage } = mediaContext();
  const list = await listMedia(db, storage, {
    folderId: 'all',
    ...(kind && (MEDIA_KINDS as readonly string[]).includes(kind) && { kind: kind as MediaKind }),
    ...(mimeType && { mimeType }),
    query: url.searchParams.get('q') ?? '',
    page: Number(url.searchParams.get('page')) || 1,
    pageSize: 48,
  });
  return json({
    items: list.items.map((v) => ({
      id: v.id,
      name: v.name,
      mimeType: v.mimeType,
      width: v.width,
      height: v.height,
      thumbUrl: v.thumbUrl,
    })),
    total: list.total,
    page: list.page,
    pageSize: list.pageSize,
  });
};
