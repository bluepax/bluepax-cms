// Posts for the post picker of the featured-posts block (pages): the latest posts of a
// category or matching a search, with their title in the page's language. Page editors and post
// editors may list them: `pages.edit` or `posts.edit`.
import { error, json } from '@sveltejs/kit';
import { m } from '#lib/paraglide/messages.js';
import { requireUser } from '#lib/server/guard.ts';
import { PAGES_EDIT } from '#lib/server/modules/pages/manifest.ts';
import { POSTS_EDIT } from '#lib/server/modules/posts/manifest.ts';
import { pickPosts } from '#lib/server/modules/posts/posts.ts';
import { can } from '#lib/server/modules/users/auth.ts';
import { getDatabase } from '#lib/server/runtime.ts';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ locals, url }) => {
  const user = requireUser(locals);
  if (![PAGES_EDIT, POSTS_EDIT].some((p) => can(user, p))) error(403, m.forbidden());
  const ids = url.searchParams.get('ids');
  const items = await pickPosts(getDatabase(), {
    locale: url.searchParams.get('locale') ?? '',
    ...(ids !== null && { ids: ids.split(',').filter(Boolean).slice(0, 50) }),
    categoryId: url.searchParams.get('category') || null,
    query: url.searchParams.get('q') ?? '',
    limit: 50,
  });
  return json({ items });
};
