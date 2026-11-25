import { schema } from '@bluepax/db';
import { requirePermission } from '#lib/server/guard.ts';
import { listPosts, type PostFilter } from '#lib/server/modules/posts/posts.ts';
import { termOptions } from '#lib/server/modules/posts/terms.ts';
import { POSTS_EDIT, chosenLocale, currentPostsSetup } from '#lib/server/posts-actions.ts';
import { getDatabase } from '#lib/server/runtime.ts';
import type { PageServerLoad } from './$types';

const STATUS_FILTERS = [...schema.CONTENT_STATUSES, 'missing'] as const;

export const load: PageServerLoad = async ({ locals, url }) => {
  requirePermission(locals, POSTS_EDIT);
  const db = getDatabase();
  const setup = await currentPostsSetup();
  const locale = chosenLocale(url, setup.languages, setup.primary);
  const status = url.searchParams.get('status');
  const categories = await termOptions(db, 'category');
  const category = url.searchParams.get('category') ?? '';
  const filter: PostFilter = {
    locale,
    ...((STATUS_FILTERS as readonly string[]).includes(status ?? '') && {
      status: status as PostFilter['status'] & string,
    }),
    ...(categories.some((c) => c.id === category) && { categoryId: category }),
    query: url.searchParams.get('q') ?? '',
    page: Number(url.searchParams.get('page')) || 1,
  };
  return {
    list: await listPosts(db, filter),
    filter: {
      locale,
      status: filter.status ?? '',
      category: filter.categoryId ?? '',
      query: filter.query ?? '',
    },
    languages: setup.languages,
    primary: setup.primary,
    statuses: STATUS_FILTERS,
    categories,
  };
};
