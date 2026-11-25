import { requirePermission } from '#lib/server/guard.ts';
import { listAuthors } from '#lib/server/modules/posts/authors.ts';
import { POSTS_AUTHORS, currentPostsSetup } from '#lib/server/posts-actions.ts';
import { getDatabase } from '#lib/server/runtime.ts';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
  requirePermission(locals, POSTS_AUTHORS);
  const setup = await currentPostsSetup();
  return {
    authors: await listAuthors(getDatabase()),
    languages: setup.languages,
    primary: setup.primary,
  };
};
