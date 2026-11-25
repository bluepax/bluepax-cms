import { redirect } from '@sveltejs/kit';
import { field, requirePermission } from '#lib/server/guard.ts';
import { mediaContext } from '#lib/server/media-actions.ts';
import { createPost } from '#lib/server/modules/posts/posts.ts';
import {
  POSTS_EDIT,
  chosenLocale,
  currentPostsSetup,
  postAction,
} from '#lib/server/posts-actions.ts';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, url }) => {
  requirePermission(locals, POSTS_EDIT);
  const setup = await currentPostsSetup();
  return {
    languages: setup.languages,
    locale: chosenLocale(url, setup.languages, setup.primary),
    reserved: [...setup.reserved.configured, ...setup.reserved.routes].sort(),
  };
};

export const actions: Actions = {
  create: (event) =>
    postAction(event, [POSTS_EDIT], 'create', async (form, actor) => {
      const locale = field(form, 'locale');
      const id = await createPost(
        mediaContext(),
        { locale, title: field(form, 'title'), slug: field(form, 'slug') },
        actor,
      );
      redirect(303, `/posts/${id}?locale=${encodeURIComponent(locale)}`);
    }),
};
