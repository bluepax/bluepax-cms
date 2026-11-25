// Route templates (docs/spec/README.md chapter 6, "路由模板"). The frontend implements its routes
// from the same templates, and the CMS uses them for canonical URLs, sitemaps and the like.
// The templates become part of the `frontend` configuration section with the route templates
// item; until then every instance uses these defaults (docs/adr/0009).

export const ROUTE_PLACEHOLDERS = ['{locale}', '{slug}', '{type}', '{category}'] as const;

export const DEFAULT_ROUTE_TEMPLATES = {
  home: '/{locale}',
  page: '/{locale}/{slug}',
  post: '/{locale}/blog/{slug}',
  postCategory: '/{locale}/blog/category/{slug}',
  tag: '/{locale}/blog/tag/{slug}',
  author: '/{locale}/authors/{slug}',
  catalogType: '/{locale}/{type}',
  category: '/{locale}/{type}/{category}',
  catalogItem: '/{locale}/{type}/{category}/{slug}',
} as const;

export type RouteTemplates = Readonly<Record<keyof typeof DEFAULT_ROUTE_TEMPLATES, string>>;

/**
 * Fixed segments of the templates, e.g. `blog` and `authors`. They are reserved slugs
 * (chapter 6: "模板中的固定段自动加入保留 slug"), so no page can take their address.
 */
export function routeFixedSegments(templates: RouteTemplates = DEFAULT_ROUTE_TEMPLATES): string[] {
  const segments = new Set<string>();
  for (const template of Object.values(templates)) {
    for (const segment of template.split('/')) {
      if (segment && !(ROUTE_PLACEHOLDERS as readonly string[]).includes(segment)) {
        segments.add(segment);
      }
    }
  }
  return [...segments].sort();
}

/** The frontend path of a page in one language: the home page lives at `/{locale}`. */
export function pagePath(
  locale: string,
  slug: string,
  home: boolean,
  templates: RouteTemplates = DEFAULT_ROUTE_TEMPLATES,
): string {
  const template = home ? templates.home : templates.page;
  return template.replace('{locale}', locale.toLowerCase()).replace('{slug}', slug);
}
