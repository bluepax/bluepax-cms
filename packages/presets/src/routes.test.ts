import { describe, expect, it } from 'vitest';
import {
  absoluteUrl,
  contentPath,
  DEFAULT_ROUTE_TEMPLATES,
  matchRoute,
  pagePath,
  routeFixedSegments,
  routePath,
  routeTemplateIssues,
  type RouteTemplates,
} from './routes.ts';

const templates = (patch: Partial<RouteTemplates>): RouteTemplates => ({
  ...DEFAULT_ROUTE_TEMPLATES,
  ...patch,
});
const issues = (patch: Partial<RouteTemplates>) =>
  routeTemplateIssues(templates(patch)).map((i) => `${i.kind}:${i.code}`);

describe('route templates', () => {
  it('has the defaults of chapter 6, which are valid', () => {
    expect(DEFAULT_ROUTE_TEMPLATES).toEqual({
      home: '/{locale}',
      page: '/{locale}/{slug}',
      post: '/{locale}/blog/{slug}',
      postCategory: '/{locale}/blog/category/{slug}',
      tag: '/{locale}/blog/tag/{slug}',
      author: '/{locale}/authors/{slug}',
    });
    expect(routeTemplateIssues(DEFAULT_ROUTE_TEMPLATES)).toEqual([]);
  });

  it('reserves the fixed segments of the templates', () => {
    expect(routeFixedSegments()).toEqual(['authors', 'blog', 'category', 'tag']);
    expect(routeFixedSegments(templates({ post: '/{locale}/news/{slug}' }))).toEqual([
      'authors',
      'blog',
      'category',
      'news',
      'tag',
    ]);
  });

  it('builds lowercase addresses, the home page at its own template', () => {
    expect(pagePath('zh-CN', 'about', false)).toBe('/zh-cn/about');
    expect(pagePath('en', 'home', true)).toBe('/en');
    expect(contentPath('post', 'ar', 'hello')).toBe('/ar/blog/hello');
    expect(contentPath('tag', 'fr-FR', 'news', templates({ tag: '/{locale}/t/{slug}' }))).toBe(
      '/fr-fr/t/news',
    );
    expect(
      routePath('/{locale}/{type}/{category}/{slug}', {
        locale: 'en',
        type: 'products',
        category: 'pumps',
        slug: 'p-100',
      }),
    ).toBe('/en/products/pumps/p-100');
    expect(absoluteUrl('https://www.example.com', '/en/about')).toBe(
      'https://www.example.com/en/about',
    );
  });

  it('matches paths against a template', () => {
    expect(matchRoute('/{locale}/blog/{slug}', '/en/blog/hello')).toEqual({
      locale: 'en',
      slug: 'hello',
    });
    expect(matchRoute('/{locale}', '/zh-cn')).toEqual({ locale: 'zh-cn' });
    expect(matchRoute('/{locale}/blog/{slug}', '/en/news/hello')).toBeNull();
    expect(matchRoute('/{locale}/blog/{slug}', '/en/blog')).toBeNull();
    expect(matchRoute('/{locale}/blog/{slug}', '/en/blog/hello/more')).toBeNull();
    expect(matchRoute('/{locale}/{slug}', '/en//')).toBeNull();
    expect(matchRoute('/{locale}/{slug}', 'en/about')).toBeNull();
  });

  it('checks the form of each template', () => {
    expect(issues({ post: 'blog/{slug}' })).toEqual(['post:format']);
    expect(issues({ post: '/{locale}/blog/{slug}/' })).toEqual(['post:format']);
    expect(issues({ post: '/{locale}//{slug}' })).toEqual(['post:format']);
    expect(issues({ post: '/' })).toEqual(['post:format']);
    expect(issues({ post: '/{locale}/a/b/c/d/e/f/g/{slug}' })).toEqual(['post:format']);
    expect(issues({ post: '/{locale}/Blog/{slug}' })).toEqual(['post:segment']);
    expect(issues({ post: '/{locale}/post-{slug}' })).toEqual(['post:segment']);
    expect(issues({ post: '/{locale}/{id}' })).toEqual(['post:segment']);
  });

  it('wants {locale} first and the placeholders of the content, each once', () => {
    expect(issues({ post: '/blog/{locale}/{slug}' })).toEqual(['post:locale_first']);
    expect(issues({ post: '/blog/{slug}' })).toEqual(['post:locale_first']);
    expect(issues({ post: '/{locale}/blog' })).toEqual(['post:placeholders']);
    expect(issues({ post: '/{locale}/{slug}/{slug}' })).toEqual(['post:placeholders']);
    expect(issues({ post: '/{locale}/{type}/{slug}' })).toEqual(['post:placeholders']);
    expect(issues({ home: '/{locale}/{slug}' })).toEqual(['home:placeholders']);
    expect(issues({ home: '/{locale}/start' })).toEqual([]);
  });

  it('refuses templates that can produce the same address', () => {
    // The same template twice.
    expect(issues({ post: '/{locale}/{slug}' })).toEqual(['page:overlap', 'post:overlap']);
    expect(issues({ tag: '/{locale}/blog/category/{slug}' })).toEqual([
      'postCategory:overlap',
      'tag:overlap',
    ]);
    expect(issues({ author: '/{locale}/{slug}/about', post: '/{locale}/{slug}/about' })).toEqual([
      'post:overlap',
      'author:overlap',
    ]);
    const [overlap] = routeTemplateIssues(templates({ author: '/{locale}/blog/{slug}' }));
    expect(overlap).toMatchObject({ kind: 'post', other: 'author', example: '/en/blog/example' });
  });

  it('knows that page and post slugs never take a fixed segment', () => {
    // Fixed segments are reserved slugs: no page is called `start`, no post `x`.
    expect(issues({ home: '/{locale}/start' })).toEqual([]);
    expect(issues({ page: '/{locale}/{slug}/x' })).toEqual([]);
    // A tag slug is not checked against reserved slugs: tag `authors` would be /en/authors/x,
    // the address of author `x`.
    expect(issues({ tag: '/{locale}/{slug}/x' })).toEqual(['tag:overlap', 'author:overlap']);
  });
});
