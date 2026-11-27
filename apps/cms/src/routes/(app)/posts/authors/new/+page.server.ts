import { redirect } from '@sveltejs/kit';
import { field, requirePermission } from '#lib/server/guard.ts';
import { accountOptions, createAuthor } from '#lib/server/modules/posts/authors.ts';
import {
  POSTS_AUTHORS,
  chosenLocale,
  currentPostsSetup,
  postAction,
} from '#lib/server/posts-actions.ts';
import { getDatabase } from '#lib/server/runtime.ts';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, url }) => {
  requirePermission(locals, POSTS_AUTHORS);
  const setup = await currentPostsSetup();
  return {
    languages: setup.languages,
    locale: chosenLocale(url, setup.languages, setup.primary),
    accounts: await accountOptions(getDatabase()),
  };
};

export const actions: Actions = {
  create: (event) =>
    postAction(event, [POSTS_AUTHORS], 'create', async (form, actor) => {
      const locale = field(form, 'locale');
      const id = await createAuthor(
        getDatabase(),
        {
          locale,
          name: field(form, 'name'),
          slug: field(form, 'slug'),
          userId: field(form, 'userId') || null,
        },
        actor,
      );
      redirect(303, `/posts/authors/${id}?locale=${encodeURIComponent(locale)}`);
    }),
};
