// What a frontend path shows (chapter 6, frontend checklist step 2): `/routes/resolve` says what
// the path is, then the matching endpoint gives the content.
import {
  isCmsError,
  knownBlock,
  type Author,
  type CmsClient,
  type CmsErrorKind,
  type Page,
  type Post,
  type PostList,
  type Resolution,
  type Site,
  type Term,
} from '@bluepax/cms-client';
import { error } from '@sveltejs/kit';

export const POSTS_PER_PAGE = 10;

export type View =
  | { kind: 'page'; page: Page }
  | { kind: 'post'; post: Post }
  | { kind: 'postCategory' | 'tag'; term: Term; posts: PostList }
  | { kind: 'author'; author: Author; posts: PostList };

export type Found = Extract<Resolution, { status: 200 }>;

const UNAVAILABLE = new Set<CmsErrorKind>(['network', 'timeout', 'server', 'rate_limited']);

/**
 * Turns a failed CMS call into this frontend's answer: 404 / 410 for content that is not
 * there, 503 with `Retry-After` while the CMS is unreachable (checklist step 7), else a 500.
 */
export function cmsFailure(cause: unknown, locals: App.Locals): never {
  if (isCmsError(cause)) {
    if (cause.kind === 'not_found') error(404, 'Not found', { code: 'not_found' });
    if (cause.kind === 'gone') error(410, 'Gone', { code: 'gone' });
    if (UNAVAILABLE.has(cause.kind)) {
      console.error(`[cms] ${cause.kind} ${cause.code}: ${cause.url}`);
      locals.retryAfter = cause.retryAfter ?? 30;
      error(503, 'Service unavailable', { code: 'unavailable' });
    }
    if (cause.kind === 'unauthorized' || cause.kind === 'forbidden') {
      console.error(`[cms] ${cause.code}: check BLUEPAX_DELIVERY_TOKEN (${cause.message})`);
    }
  }
  throw cause;
}

/** Awaits a CMS call; failures become this frontend's HTTP errors. */
export async function fromCms<T>(call: Promise<T>, locals: App.Locals): Promise<T> {
  try {
    return await call;
  } catch (cause) {
    cmsFailure(cause, locals);
  }
}

/**
 * The site settings in a language. The first path segment is the language under every route
 * template (`{locale}` comes first); other paths (`/`, `/preview`, `/favicon.ico`) get the
 * primary language.
 */
export async function siteFor(client: CmsClient, locale: string | undefined): Promise<Site> {
  if (!locale) return client.getSite();
  try {
    return await client.getSite({ locale });
  } catch (cause) {
    if (isCmsError(cause) && cause.code === 'invalid_locale') return client.getSite();
    throw cause;
  }
}

export function directionOf(site: Site, locale: string): 'ltr' | 'rtl' {
  const lower = locale.toLowerCase();
  return site.languages.content.find((l) => l.code.toLowerCase() === lower)?.dir ?? 'ltr';
}

/** Block types this frontend does not know are skipped; the server log says which (chapter 6). */
export function logUnknownBlocks(page: Page): void {
  for (const block of page.blocks) {
    if (!knownBlock(block)) console.warn(`[cms] unknown block type ${block.type} on ${page.path}`);
  }
}

/** The content of a resolved path; `page` is the list page of categories, tags and authors. */
export async function viewOf(client: CmsClient, route: Found, page: number): Promise<View> {
  const { locale, slug } = route;
  const paging = { locale, page, pageSize: POSTS_PER_PAGE };
  switch (route.type) {
    case 'page': {
      const found = await client.getPage(slug, { locale });
      logUnknownBlocks(found);
      return { kind: 'page', page: found };
    }
    case 'post':
      return { kind: 'post', post: await client.getPost(slug, { locale }) };
    case 'postCategory':
    case 'tag': {
      const [terms, posts] = await Promise.all([
        route.type === 'tag'
          ? client.listTags({ locale, slug })
          : client.listPostCategories({ locale, slug }),
        client.listPosts({
          ...paging,
          ...(route.type === 'tag' ? { tag: slug } : { category: slug }),
        }),
      ]);
      const term = terms.items[0];
      if (!term) error(404, 'Not found', { code: 'not_found' });
      return { kind: route.type, term, posts };
    }
    case 'author': {
      const [author, posts] = await Promise.all([
        client.getAuthor(slug, { locale }),
        client.listPosts({ ...paging, author: slug }),
      ]);
      return { kind: 'author', author, posts };
    }
  }
}
