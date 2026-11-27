// The Delivery API v1 operations the client calls (docs/spec/README.md chapter 6, docs/adr/0013),
// keyed by their OpenAPI `operationId`. The CMS's tests compare this table with its own
// operations table (paths and query parameters), so the client cannot fall behind the API.

/** Path prefix of the Delivery API on the CMS. */
export const DELIVERY_API_PREFIX = '/api/delivery/v1';

export const DELIVERY_ENDPOINTS = {
  getSite: { path: '/site', query: ['locale'] },
  resolveRoute: { path: '/routes/resolve', query: ['path'] },
  getPage: { path: '/pages/{slug}', query: ['locale'] },
  listPosts: {
    path: '/posts',
    query: ['locale', 'page', 'pageSize', 'category', 'tag', 'author'],
  },
  getPost: { path: '/posts/{slug}', query: ['locale'] },
  listPostCategories: { path: '/post-categories', query: ['locale', 'page', 'pageSize', 'slug'] },
  listTags: { path: '/tags', query: ['locale', 'page', 'pageSize', 'slug'] },
  listAuthors: { path: '/authors', query: ['locale', 'page', 'pageSize'] },
  getAuthor: { path: '/authors/{slug}', query: ['locale'] },
  getBlockSchemas: { path: '/schema/blocks', query: [] },
  getPreview: { path: '/preview/{token}', query: [] },
} as const satisfies Record<string, { path: string; query: readonly string[] }>;

export type OperationId = keyof typeof DELIVERY_ENDPOINTS;

/** The OpenAPI 3.1 document; the only path that needs no Delivery Token. */
export const OPENAPI_PATH = '/openapi.json';
