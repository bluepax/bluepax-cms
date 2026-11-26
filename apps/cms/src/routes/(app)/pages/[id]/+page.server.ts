import { blockMedia, BLOCK_KEYS, emptyBlockData } from '@bluepax/cms-blocks';
import { error, redirect } from '@sveltejs/kit';
import { m } from '#lib/paraglide/messages.js';
import { field, requirePermission } from '#lib/server/guard.ts';
import { exportInstanceConfig } from '#lib/server/instance.ts';
import { mediaContext } from '#lib/server/media-actions.ts';
import { getMediaViews } from '#lib/server/modules/media/library.ts';
import { unavailableFeatures } from '#lib/server/modules/pages/blocks.ts';
import { PageError } from '#lib/server/modules/pages/errors.ts';
import { contentInput } from '#lib/server/modules/pages/forms.ts';
import {
  createTranslation,
  deletePage,
  deleteTranslation,
  getPage,
  getTranslation,
  saveTranslation,
  setHomePage,
  type StatusAction,
} from '#lib/server/modules/pages/pages.ts';
import { pickPosts } from '#lib/server/modules/posts/posts.ts';
import { termOptions } from '#lib/server/modules/posts/terms.ts';
import { can } from '#lib/server/modules/users/auth.ts';
import {
  PAGES_DELETE,
  PAGES_EDIT,
  PAGES_PUBLISH,
  currentSetup,
  pageAction,
} from '#lib/server/pages-actions.ts';
import { getDatabase } from '#lib/server/runtime.ts';
import type { Actions, PageServerLoad, RequestEvent } from './$types';

export const load: PageServerLoad = async ({ locals, params, url }) => {
  const user = requirePermission(locals, PAGES_EDIT);
  const { db, storage } = mediaContext();
  let page;
  try {
    page = await getPage(db, params.id);
  } catch (err) {
    if (err instanceof PageError && err.code === 'not_found') error(404, m.error_not_found());
    throw err;
  }
  const setup = await currentSetup();
  const existing = page.translations.map((t) => t.locale);
  const requested = url.searchParams.get('locale');
  const locale = setup.languages.some((l) => l.code === requested)
    ? requested!
    : existing.includes(setup.primary)
      ? setup.primary
      : (existing[0] ?? setup.primary);
  const translation = existing.includes(locale) ? await getTranslation(db, page.id, locale) : null;
  const mediaIds = translation
    ? [
        ...translation.blocks.flatMap((block) => blockMedia(block).map((r) => r.mediaId)),
        ...(translation.seo.ogImage ? [translation.seo.ogImage] : []),
      ]
    : [];
  // Posts and categories of the featured-posts and latest-posts blocks.
  const postIds = translation
    ? translation.blocks.flatMap((block) =>
        block.type === 'featured-posts' ? block.data.postIds : [],
      )
    : [];
  const [views, { site }, postCategories, posts] = await Promise.all([
    getMediaViews(db, storage, mediaIds),
    exportInstanceConfig(db),
    termOptions(db, 'category'),
    postIds.length > 0 ? pickPosts(db, { locale, ids: [...new Set(postIds)] }) : [],
  ]);
  return {
    page,
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
    blocks: setup.offer.blocks,
    templates: Object.fromEntries(setup.offer.blocks.map((key) => [key, emptyBlockData(key)])),
    hiddenFeatures: Object.fromEntries(
      BLOCK_KEYS.map((key) => [key, unavailableFeatures(key, setup.offer)]),
    ),
    reserved: [...setup.reserved.configured, ...setup.reserved.routes].sort(),
    frontendBaseUrl: setup.frontendBaseUrl,
    routes: setup.routes,
    site: { name: site.name, publisher: site.publisher },
    postCategories,
    posts: Object.fromEntries(posts.map((p) => [p.id, p])),
    can: { publish: can(user, PAGES_PUBLISH), delete: can(user, PAGES_DELETE) },
  };
};

/** Saves the form's content, optionally changing the status in the same step. */
const save =
  (name: string, permissions: string[], status?: StatusAction) => (event: RequestEvent) =>
    pageAction(event, permissions, name, async (form, actor) =>
      saveTranslation(
        mediaContext(),
        event.params.id,
        field(form, 'locale'),
        contentInput(form),
        actor,
        { offer: (await currentSetup()).offer, version: field(form, 'version'), status },
      ),
    );

export const actions: Actions = {
  save: save('save', []),
  submit: save('submit', [], 'submit'),
  withdraw: save('withdraw', [], 'withdraw'),
  publish: save('publish', [PAGES_PUBLISH], 'publish'),
  // Taking a page offline keeps the form's edits too, so nothing typed is lost.
  unpublish: save('unpublish', [PAGES_PUBLISH], 'unpublish'),
  home: (event) =>
    pageAction(event, [PAGES_PUBLISH], 'home', (_form, actor) =>
      setHomePage(getDatabase(), event.params.id, actor),
    ),
  addTranslation: (event) =>
    pageAction(event, [], 'addTranslation', async (form, actor) => {
      const locale = field(form, 'locale');
      await createTranslation(
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
      redirect(303, `/pages/${event.params.id}?locale=${encodeURIComponent(locale)}`);
    }),
  deleteTranslation: (event) =>
    pageAction(event, [PAGES_DELETE], 'deleteTranslation', async (form, actor) => {
      await deleteTranslation(getDatabase(), event.params.id, field(form, 'locale'), actor);
      redirect(303, `/pages/${event.params.id}`);
    }),
  deletePage: (event) =>
    pageAction(event, [PAGES_DELETE], 'deletePage', async (_form, actor) => {
      await deletePage(getDatabase(), event.params.id, actor);
      redirect(303, '/pages?deleted');
    }),
};
