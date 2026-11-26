// The operations of the Delivery API v1 (docs/spec/README.md chapter 6, docs/adr/0012). One
// table drives the router, the OpenAPI document and the admin's API console. Endpoints that are
// not built yet (Event API, `/feed`, `/search`, `/seo/*`, catalog, regions) are not listed, so
// they answer 404 like the endpoints of a switched-off module.
import { blockJsonSchemas } from '@bluepax/cms-blocks';
import type { ModuleId } from '@bluepax/core';
import type { z } from 'zod';
import { resolvePath } from '../content/routes.ts';
import { blockOffer } from '../modules/pages/blocks.ts';
import { verifyPreviewToken } from '../modules/api/preview.ts';
import {
  authorListSchema,
  authorSchema,
  blockSchemasSchema,
  pageSchema,
  postListSchema,
  postSchema,
  previewSchema,
  resolutionSchema,
  siteSchema,
  termListSchema,
  type Preview,
} from '@bluepax/cms-client/contract';
import { DeliveryError, notFound, type DeliveryContext } from './context.ts';
import { getPage, pageForPreview } from './pages.ts';
import { getAuthor, getPost, listAuthors, listPosts, listTerms, postForPreview } from './posts.ts';
import { getSite } from './site.ts';

export interface ParamSpec {
  name: string;
  in: 'query' | 'path';
  required: boolean;
  description: string;
  schema: Record<string, unknown>;
}

export interface HandlerResult {
  body: unknown;
  lastModified?: Date | null;
}

export interface HandlerArgs {
  query: URLSearchParams;
  path: Record<string, string>;
}

export interface Operation {
  operationId: string;
  method: 'GET';
  /** Path under `/api/delivery/v1`, with `{name}` parameters. */
  path: string;
  /** The module that owns the endpoint; while it is off the endpoint answers 404. */
  module: ModuleId;
  summary: string;
  params: readonly ParamSpec[];
  response: z.ZodType;
  /** Previews must never be cached or indexed (chapter 6, frontend checklist step 5). */
  cache: 'revalidate' | 'no-store';
  handler: (ctx: DeliveryContext, args: HandlerArgs) => Promise<HandlerResult>;
}

const text = { type: 'string' } as const;
const integer = (max: number, fallback: number) =>
  ({ type: 'integer', minimum: 1, maximum: max, default: fallback }) as const;

const locale: ParamSpec = {
  name: 'locale',
  in: 'query',
  required: false,
  description: 'Content language (BCP 47); the primary language when left out',
  schema: text,
};
const paging: ParamSpec[] = [
  {
    name: 'page',
    in: 'query',
    required: false,
    description: 'Page number',
    schema: integer(10_000, 1),
  },
  {
    name: 'pageSize',
    in: 'query',
    required: false,
    description: 'Items per page',
    schema: integer(100, 20),
  },
];
const slugPath = (what: string): ParamSpec => ({
  name: 'slug',
  in: 'path',
  required: true,
  description: `Slug of the ${what} in the requested language`,
  schema: text,
});
const slugFilter = (name: string, what: string): ParamSpec => ({
  name,
  in: 'query',
  required: false,
  description: `Only ${what} with this slug`,
  schema: text,
});

async function preview(ctx: DeliveryContext, token: string): Promise<HandlerResult> {
  const secret = await ctx.previewSecret?.();
  if (!secret) throw new DeliveryError(404, 'preview_unavailable', 'No preview secret is set');
  const check = verifyPreviewToken(secret, token, ctx.now);
  if (!check.ok) {
    throw check.reason === 'expired'
      ? new DeliveryError(403, 'preview_expired', 'The preview link has expired')
      : new DeliveryError(403, 'preview_invalid', 'The preview token is not valid');
  }
  const { type, id, locale } = check.target;
  if (!ctx.routing.languages.includes(locale)) throw notFound();
  const expiresAt = check.expiresAt.toISOString();
  let body: Preview;
  if (type === 'page') {
    const found = await pageForPreview(ctx, id, locale);
    if (!found) throw notFound('page');
    body = { type, expiresAt, status: found.status, page: found.page };
  } else {
    const found = await postForPreview(ctx, id, locale);
    if (!found) throw notFound('post');
    body = { type, expiresAt, status: found.status, post: found.post };
  }
  return { body };
}

export const OPERATIONS: readonly Operation[] = [
  {
    operationId: 'getSite',
    method: 'GET',
    path: '/site',
    module: 'site',
    summary: 'Site settings, publisher, navigation, route templates and media origin',
    params: [locale],
    response: siteSchema,
    cache: 'revalidate',
    handler: (ctx, { query }) => getSite(ctx, query),
  },
  {
    operationId: 'resolveRoute',
    method: 'GET',
    path: '/routes/resolve',
    module: 'api',
    summary: 'What a frontend path is: content with its addresses, a 301 or a 404',
    params: [
      {
        name: 'path',
        in: 'query',
        required: true,
        description: 'Frontend path, e.g. `/en/blog/hello`',
        schema: text,
      },
    ],
    response: resolutionSchema,
    cache: 'revalidate',
    handler: async (ctx, { query }) => {
      const path = query.get('path');
      if (!path)
        throw new DeliveryError(400, 'invalid_query', 'path is required', { parameter: 'path' });
      return { body: await resolvePath(ctx.db, ctx.routing, path) };
    },
  },
  {
    operationId: 'getPage',
    method: 'GET',
    path: '/pages/{slug}',
    module: 'pages',
    summary: 'A published block page',
    params: [slugPath('page'), locale],
    response: pageSchema,
    cache: 'revalidate',
    handler: (ctx, { path, query }) => getPage(ctx, path.slug!, query),
  },
  {
    operationId: 'listPosts',
    method: 'GET',
    path: '/posts',
    module: 'posts',
    summary: 'Published posts, newest first',
    params: [
      locale,
      ...paging,
      slugFilter('category', 'posts in the category'),
      slugFilter('tag', 'posts with the tag'),
      slugFilter('author', 'posts by the author'),
    ],
    response: postListSchema,
    cache: 'revalidate',
    handler: (ctx, { query }) => listPosts(ctx, query),
  },
  {
    operationId: 'getPost',
    method: 'GET',
    path: '/posts/{slug}',
    module: 'posts',
    summary: 'A published post',
    params: [slugPath('post'), locale],
    response: postSchema,
    cache: 'revalidate',
    handler: (ctx, { path, query }) => getPost(ctx, path.slug!, query),
  },
  {
    operationId: 'listPostCategories',
    method: 'GET',
    path: '/post-categories',
    module: 'posts',
    summary: 'Post categories in the editor’s order',
    params: [locale, ...paging, slugFilter('slug', 'the category')],
    response: termListSchema,
    cache: 'revalidate',
    handler: (ctx, { query }) => listTerms(ctx, 'postCategory', query),
  },
  {
    operationId: 'listTags',
    method: 'GET',
    path: '/tags',
    module: 'posts',
    summary: 'Tags by name',
    params: [locale, ...paging, slugFilter('slug', 'the tag')],
    response: termListSchema,
    cache: 'revalidate',
    handler: (ctx, { query }) => listTerms(ctx, 'tag', query),
  },
  {
    operationId: 'listAuthors',
    method: 'GET',
    path: '/authors',
    module: 'posts',
    summary: 'Authors with a public author page, by name',
    params: [locale, ...paging],
    response: authorListSchema,
    cache: 'revalidate',
    handler: (ctx, { query }) => listAuthors(ctx, query),
  },
  {
    operationId: 'getAuthor',
    method: 'GET',
    path: '/authors/{slug}',
    module: 'posts',
    summary: 'An author with a public author page',
    params: [slugPath('author'), locale],
    response: authorSchema,
    cache: 'revalidate',
    handler: (ctx, { path, query }) => getAuthor(ctx, path.slug!, query),
  },
  {
    operationId: 'getBlockSchemas',
    method: 'GET',
    path: '/schema/blocks',
    module: 'api',
    summary: 'JSON Schemas of the blocks this instance offers and of rich text',
    params: [],
    response: blockSchemasSchema,
    cache: 'revalidate',
    handler: async (ctx) => ({
      body: blockJsonSchemas(blockOffer(ctx.config, ctx.registry, ctx.active).blocks),
    }),
  },
  {
    operationId: 'getPreview',
    method: 'GET',
    path: '/preview/{token}',
    module: 'api',
    summary: 'A page or post language version as it is now, from a signed preview link',
    params: [
      {
        name: 'token',
        in: 'path',
        required: true,
        description: 'The `token` of the preview link (valid for one hour)',
        schema: text,
      },
    ],
    response: previewSchema,
    cache: 'no-store',
    handler: (ctx, { path }) => preview(ctx, path.token!),
  },
];

/** The operation for a method and path under `/api/delivery/v1`, with its path parameters. */
export function matchOperation(
  method: string,
  path: string,
): { operation: Operation; params: Record<string, string> } | { methods: string[] } | null {
  const segments = path.split('/').filter(Boolean);
  const methods: string[] = [];
  for (const operation of OPERATIONS) {
    const pattern = operation.path.split('/').filter(Boolean);
    if (pattern.length !== segments.length) continue;
    const params: Record<string, string> = {};
    let matched = true;
    for (let i = 0; i < pattern.length; i++) {
      const part = pattern[i]!;
      const segment = segments[i]!;
      if (part.startsWith('{') && part.endsWith('}')) {
        let value: string;
        try {
          value = decodeURIComponent(segment);
        } catch {
          matched = false;
          break;
        }
        params[part.slice(1, -1)] = value;
      } else if (part !== segment) {
        matched = false;
        break;
      }
    }
    if (!matched) continue;
    if (operation.method === method || (method === 'HEAD' && operation.method === 'GET')) {
      return { operation, params };
    }
    methods.push(operation.method);
  }
  return methods.length > 0 ? { methods } : null;
}
