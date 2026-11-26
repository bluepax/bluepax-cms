import { redirect } from '@sveltejs/kit';
import { field, requirePermission } from '#lib/server/guard.ts';
import { mediaContext } from '#lib/server/media-actions.ts';
import { getMediaViews } from '#lib/server/modules/media/library.ts';
import {
  accountOptions,
  deleteAuthor,
  deleteAuthorTranslation,
  getAuthor,
  saveAuthor,
} from '#lib/server/modules/posts/authors.ts';
import { authorInput } from '#lib/server/modules/posts/forms.ts';
import {
  POSTS_AUTHORS,
  chosenLocale,
  currentPostsSetup,
  loadOr404,
  postAction,
} from '#lib/server/posts-actions.ts';
import { getDatabase } from '#lib/server/runtime.ts';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, params, url }) => {
  requirePermission(locals, POSTS_AUTHORS);
  const { db, storage } = mediaContext();
  const author = await loadOr404(() => getAuthor(db, params.id));
  const setup = await currentPostsSetup();
  const existing = author.translations.map((t) => t.locale);
  const fallback = existing.includes(setup.primary)
    ? setup.primary
    : (existing[0] ?? setup.primary);
  const locale = chosenLocale(url, setup.languages, fallback);
  const mediaIds = [
    ...(author.avatar ? [author.avatar] : []),
    ...author.translations.flatMap((t) => (t.seo.ogImage ? [t.seo.ogImage] : [])),
  ];
  const [views, accounts] = await Promise.all([
    getMediaViews(db, storage, mediaIds),
    accountOptions(db),
  ]);
  return {
    author,
    locale,
    translation: author.translations.find((t) => t.locale === locale) ?? null,
    media: Object.fromEntries(
      views.map((v) => [
        v.id,
        {
          id: v.id,
          name: v.name,
          mimeType: v.mimeType,
          width: v.width,
          height: v.height,
          thumbUrl: v.thumbUrl,
        },
      ]),
    ),
    accounts,
    languages: setup.languages,
    primary: setup.primary,
    frontendBaseUrl: setup.frontendBaseUrl,
    routes: setup.routes,
  };
};

export const actions: Actions = {
  save: (event) =>
    postAction(event, [POSTS_AUTHORS], 'save', (form, actor) =>
      saveAuthor(mediaContext(), event.params.id, field(form, 'locale'), authorInput(form), actor, {
        version: field(form, 'version'),
      }),
    ),
  deleteTranslation: (event) =>
    postAction(event, [POSTS_AUTHORS], 'deleteTranslation', async (form, actor) => {
      await deleteAuthorTranslation(getDatabase(), event.params.id, field(form, 'locale'), actor);
      redirect(303, `/posts/authors/${event.params.id}`);
    }),
  delete: (event) =>
    postAction(event, [POSTS_AUTHORS], 'delete', async (_form, actor) => {
      await deleteAuthor(getDatabase(), event.params.id, actor);
      redirect(303, '/posts/authors?deleted');
    }),
};
