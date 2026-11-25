import { richTextMedia } from '@bluepax/cms-blocks';
import { redirect } from '@sveltejs/kit';
import { field, requirePermission } from '#lib/server/guard.ts';
import { exportInstanceConfig } from '#lib/server/instance.ts';
import { mediaContext } from '#lib/server/media-actions.ts';
import { getMediaViews } from '#lib/server/modules/media/library.ts';
import { authorOptions } from '#lib/server/modules/posts/authors.ts';
import { postInput } from '#lib/server/modules/posts/forms.ts';
import {
  createPostTranslation,
  deletePost,
  deletePostTranslation,
  getPost,
  getPostTranslation,
  savePost,
  type PostInput,
} from '#lib/server/modules/posts/posts.ts';
import { termOptions } from '#lib/server/modules/posts/terms.ts';
import type { StatusAction } from '#lib/server/content/status.ts';
import { can } from '#lib/server/modules/users/auth.ts';
import {
  POSTS_AUTHORS,
  POSTS_DELETE,
  POSTS_EDIT,
  POSTS_PUBLISH,
  POSTS_TAXONOMY,
  chosenLocale,
  currentPostsSetup,
  loadOr404,
  postAction,
} from '#lib/server/posts-actions.ts';
import { getDatabase } from '#lib/server/runtime.ts';
import type { Actions, PageServerLoad, RequestEvent } from './$types';

export const load: PageServerLoad = async ({ locals, params, url }) => {
  const user = requirePermission(locals, POSTS_EDIT);
  const { db, storage } = mediaContext();
  const post = await loadOr404(() => getPost(db, params.id));
  const setup = await currentPostsSetup();
  const existing = post.translations.map((t) => t.locale);
  const fallback = existing.includes(setup.primary)
    ? setup.primary
    : (existing[0] ?? setup.primary);
  const locale = chosenLocale(url, setup.languages, fallback);
  const translation = existing.includes(locale)
    ? await getPostTranslation(db, post.id, locale)
    : null;
  const mediaIds = [
    ...(post.cover ? [post.cover] : []),
    ...(translation ? richTextMedia(translation.body) : []),
    ...(translation?.seo.ogImage ? [translation.seo.ogImage] : []),
  ];
  const [views, categories, tags, authors, { site }] = await Promise.all([
    getMediaViews(db, storage, mediaIds),
    termOptions(db, 'category'),
    termOptions(db, 'tag'),
    authorOptions(db),
    exportInstanceConfig(db),
  ]);
  return {
    post,
    locale,
    translation,
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
          url: v.url,
        },
      ]),
    ),
    languages: setup.languages,
    primary: setup.primary,
    reserved: [...setup.reserved.configured, ...setup.reserved.routes].sort(),
    frontendBaseUrl: setup.frontendBaseUrl,
    options: { categories, tags, authors },
    site: { name: site.name, publisher: site.publisher },
    can: {
      publish: can(user, POSTS_PUBLISH),
      delete: can(user, POSTS_DELETE),
      taxonomy: can(user, POSTS_TAXONOMY),
      authors: can(user, POSTS_AUTHORS),
    },
  };
};

/** Saves the form's content, optionally changing the status in the same step. */
const save =
  (name: string, permissions: string[], status?: StatusAction) => (event: RequestEvent) =>
    postAction(event, [POSTS_EDIT, ...permissions], name, async (form, actor) => {
      const input: PostInput = postInput(form);
      // Only users who may publish change the publication date.
      if (!can(event.locals.user!, POSTS_PUBLISH)) delete input.publishedAt;
      return savePost(mediaContext(), event.params.id, field(form, 'locale'), input, actor, {
        version: field(form, 'version'),
        sharedVersion: field(form, 'sharedVersion'),
        status,
      });
    });

export const actions: Actions = {
  save: save('save', []),
  submit: save('submit', [], 'submit'),
  withdraw: save('withdraw', [], 'withdraw'),
  publish: save('publish', [POSTS_PUBLISH], 'publish'),
  // Taking a post offline keeps the form's edits too, so nothing typed is lost.
  unpublish: save('unpublish', [POSTS_PUBLISH], 'unpublish'),
  addTranslation: (event) =>
    postAction(event, [POSTS_EDIT], 'addTranslation', async (form, actor) => {
      const locale = field(form, 'locale');
      await createPostTranslation(
        mediaContext(),
        event.params.id,
        {
          locale,
          title: field(form, 'title'),
          slug: field(form, 'slug'),
          copyFrom: field(form, 'copyFrom') || undefined,
        },
        actor,
      );
      redirect(303, `/posts/${event.params.id}?locale=${encodeURIComponent(locale)}`);
    }),
  deleteTranslation: (event) =>
    postAction(event, [POSTS_EDIT, POSTS_DELETE], 'deleteTranslation', async (form, actor) => {
      await deletePostTranslation(getDatabase(), event.params.id, field(form, 'locale'), actor);
      redirect(303, `/posts/${event.params.id}`);
    }),
  deletePost: (event) =>
    postAction(event, [POSTS_EDIT, POSTS_DELETE], 'deletePost', async (_form, actor) => {
      await deletePost(getDatabase(), event.params.id, actor);
      redirect(303, '/posts?deleted');
    }),
};
