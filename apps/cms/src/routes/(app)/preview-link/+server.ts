// Creates a signed preview link for the page or post editor (chapter 3 and 6, docs/adr/0012).
// Whoever may edit the content may preview it: `pages.edit` or `posts.edit`.
import { error, json } from '@sveltejs/kit';
import { m } from '#lib/paraglide/messages.js';
import { requirePermission } from '#lib/server/guard.ts';
import { createPreviewLink, PreviewUnavailableError } from '#lib/server/modules/api/frontend.ts';
import { PREVIEW_TYPES, type PreviewType } from '#lib/server/modules/api/preview.ts';
import { PAGES_EDIT } from '#lib/server/modules/pages/manifest.ts';
import { POSTS_EDIT } from '#lib/server/modules/posts/manifest.ts';
import { encryptionKey, getDatabase } from '#lib/server/runtime.ts';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ locals, request }) => {
  const input = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const type = input?.type;
  if (!PREVIEW_TYPES.includes(type as PreviewType)) error(400, m.error_not_found());
  requirePermission(locals, type === 'page' ? PAGES_EDIT : POSTS_EDIT);
  const id = typeof input?.id === 'string' ? input.id : '';
  const locale = typeof input?.locale === 'string' ? input.locale : '';
  try {
    const link = await createPreviewLink(getDatabase(), encryptionKey(), {
      type: type as PreviewType,
      id,
      locale,
    });
    if (!link) error(404, m.error_not_found());
    return json({ url: link.url, expiresAt: link.expiresAt.toISOString() });
  } catch (err) {
    if (err instanceof PreviewUnavailableError) {
      return json({ error: 'preview_unavailable' }, { status: 409 });
    }
    throw err;
  }
};
