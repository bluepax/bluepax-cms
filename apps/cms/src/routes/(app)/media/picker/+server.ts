// Media list for the media picker of other admin pages (e.g. the site logo, page blocks).
// Whoever may edit a record that points at media may browse the library: `media.edit`,
// `site.manage`, `pages.edit`, `posts.edit`, `posts.taxonomy` or `posts.authors`.
import { error, json } from '@sveltejs/kit';
import { m } from '#lib/paraglide/messages.js';
import { requireUser } from '#lib/server/guard.ts';
import { MEDIA_PERMISSION, mediaContext } from '#lib/server/media-actions.ts';
import { MEDIA_KINDS, type MediaKind } from '#lib/server/modules/media/files.ts';
import { listMedia } from '#lib/server/modules/media/library.ts';
import { PAGES_EDIT } from '#lib/server/modules/pages/manifest.ts';
import { POSTS_AUTHORS, POSTS_EDIT, POSTS_TAXONOMY } from '#lib/server/modules/posts/manifest.ts';
import { can } from '#lib/server/modules/users/auth.ts';
import { SITE_PERMISSION } from '#lib/server/site-actions.ts';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ locals, url }) => {
  const user = requireUser(locals);
  const allowed = [
    MEDIA_PERMISSION,
    SITE_PERMISSION,
    PAGES_EDIT,
    POSTS_EDIT,
    POSTS_TAXONOMY,
    POSTS_AUTHORS,
  ];
  if (!allowed.some((p) => can(user, p))) {
    error(403, m.forbidden());
  }
  const kinds = (url.searchParams.get('kind') ?? '')
    .split(',')
    .filter((k): k is MediaKind => (MEDIA_KINDS as readonly string[]).includes(k));
  const mimeType = url.searchParams.get('mime');
  const { db, storage } = mediaContext();
  const list = await listMedia(db, storage, {
    folderId: 'all',
    ...(kinds.length > 0 && { kind: kinds }),
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
