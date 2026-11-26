// Route templates (docs/spec/README.md chapter 6, "路由模板"; docs/adr/0011): `GET /site` sends
// them in `frontend.routes`, and a frontend builds its own addresses from them rather than by
// hand, e.g. each language's home page for a language switcher. Content responses already carry
// their `path`. Published as `@bluepax/cms-client/routes`, without other imports.

/** Values of the placeholders; the language is written in lowercase (`zh-CN` → `zh-cn`). */
export interface RouteValues {
  locale: string;
  slug?: string | undefined;
  type?: string | undefined;
  category?: string | undefined;
}

/**
 * The address a template gives (chapter 6: always lowercase):
 * `routePath('/{locale}/blog/{slug}', { locale: 'zh-CN', slug: 'hello' })` → `/zh-cn/blog/hello`.
 */
export function routePath(template: string, values: RouteValues): string {
  return template
    .split('/')
    .map((segment) => {
      switch (segment) {
        case '{locale}':
          return values.locale.toLowerCase();
        case '{slug}':
          return values.slug ?? '';
        case '{type}':
          return values.type ?? '';
        case '{category}':
          return values.category ?? '';
        default:
          return segment;
      }
    })
    .join('/');
}
