// Loads and form actions of the category and tag pages, which work the same way: a list with a
// form for a new term, and an editor per term with a tab per content language. Everything needs
// `posts.taxonomy` (chapter 3). UI and API refuse alike (chapter 12).
import { redirect, type RequestEvent } from '@sveltejs/kit';
import { field, requirePermission } from './guard.ts';
import { mediaContext } from './media-actions.ts';
import { getMediaViews } from './modules/media/library.ts';
import { termInput } from './modules/posts/forms.ts';
import {
  createTerm,
  deleteTerm,
  deleteTermTranslation,
  getTerm,
  listTerms,
  saveTerm,
  type TermKind,
} from './modules/posts/terms.ts';
import {
  POSTS_TAXONOMY,
  chosenLocale,
  currentPostsSetup,
  loadOr404,
  postAction,
} from './posts-actions.ts';
import { getDatabase } from './runtime.ts';

const BASE: Record<TermKind, string> = { category: '/posts/categories', tag: '/posts/tags' };

export function termListLoad(kind: TermKind) {
  return async ({ locals, url }: Pick<RequestEvent, 'locals' | 'url'>) => {
    requirePermission(locals, POSTS_TAXONOMY);
    const setup = await currentPostsSetup();
    const query = url.searchParams.get('q') ?? '';
    return {
      kind,
      list: await listTerms(getDatabase(), kind, {
        query,
        page: Number(url.searchParams.get('page')) || 1,
      }),
      query,
      languages: setup.languages,
      primary: setup.primary,
      locale: chosenLocale(url, setup.languages, setup.primary),
    };
  };
}

export function termListActions(kind: TermKind) {
  return {
    create: (event: RequestEvent) =>
      postAction(event, [POSTS_TAXONOMY], 'create', async (form, actor) => {
        const locale = field(form, 'locale');
        const id = await createTerm(
          getDatabase(),
          kind,
          { locale, name: field(form, 'name'), slug: field(form, 'slug') },
          actor,
        );
        redirect(303, `${BASE[kind]}/${id}?locale=${encodeURIComponent(locale)}`);
      }),
  };
}

export function termEditLoad(kind: TermKind) {
  return async ({ locals, params, url }: Pick<RequestEvent, 'locals' | 'params' | 'url'>) => {
    requirePermission(locals, POSTS_TAXONOMY);
    const { db, storage } = mediaContext();
    const term = await loadOr404(() => getTerm(db, kind, params.id ?? ''));
    const setup = await currentPostsSetup();
    const existing = term.translations.map((t) => t.locale);
    const fallback = existing.includes(setup.primary)
      ? setup.primary
      : (existing[0] ?? setup.primary);
    const locale = chosenLocale(url, setup.languages, fallback);
    const ogImages = term.translations.flatMap((t) => (t.seo.ogImage ? [t.seo.ogImage] : []));
    const views = await getMediaViews(db, storage, ogImages);
    return {
      kind,
      term,
      locale,
      translation: term.translations.find((t) => t.locale === locale) ?? null,
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
      languages: setup.languages,
      primary: setup.primary,
      frontendBaseUrl: setup.frontendBaseUrl,
      routes: setup.routes,
    };
  };
}

export function termEditActions(kind: TermKind) {
  return {
    save: (event: RequestEvent) =>
      postAction(event, [POSTS_TAXONOMY], 'save', (form, actor) =>
        saveTerm(
          mediaContext(),
          kind,
          event.params.id ?? '',
          field(form, 'locale'),
          termInput(form),
          actor,
          { version: field(form, 'version') },
        ),
      ),
    deleteTranslation: (event: RequestEvent) =>
      postAction(event, [POSTS_TAXONOMY], 'deleteTranslation', async (form, actor) => {
        await deleteTermTranslation(
          getDatabase(),
          kind,
          event.params.id ?? '',
          field(form, 'locale'),
          actor,
        );
        redirect(303, `${BASE[kind]}/${event.params.id}`);
      }),
    delete: (event: RequestEvent) =>
      postAction(event, [POSTS_TAXONOMY], 'delete', async (_form, actor) => {
        await deleteTerm(getDatabase(), kind, event.params.id ?? '', actor);
        redirect(303, `${BASE[kind]}?deleted`);
      }),
  };
}
