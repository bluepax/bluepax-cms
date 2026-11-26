// Route templates (docs/spec/README.md chapter 6, "路由模板"; docs/adr/0011). The CMS builds every
// frontend address from them (canonical URLs, hreflang, sitemap, RSS, llms.txt, internal links,
// webhook paths) and resolves paths with them; the frontend implements its routes from the same
// templates, which `GET /site` delivers. They live in the `frontend` configuration section.
// No Zod here: the admin's browser code imports this file (`@bluepax/presets/routes`).
import { routePath } from '@bluepax/cms-client/routes';
import { isSlug } from '@bluepax/core';

export const ROUTE_PLACEHOLDERS = ['{locale}', '{slug}', '{type}', '{category}'] as const;
export type RoutePlaceholder = (typeof ROUTE_PLACEHOLDERS)[number];

/**
 * Routable content with a template. Catalog types, categories and items (`/{locale}/{type}`,
 * `/{locale}/{type}/{category}`, `/{locale}/{type}/{category}/{slug}`) join with the catalog
 * module (M4): `{type}` and `{category}` are already known placeholders.
 */
export const ROUTE_KINDS = ['home', 'page', 'post', 'postCategory', 'tag', 'author'] as const;
export type RouteKind = (typeof ROUTE_KINDS)[number];
export type RouteTemplates = Readonly<Record<RouteKind, string>>;

/** Defaults of chapter 6; the corporate and blog presets use the same ones. */
export const DEFAULT_ROUTE_TEMPLATES: RouteTemplates = {
  home: '/{locale}',
  page: '/{locale}/{slug}',
  post: '/{locale}/blog/{slug}',
  postCategory: '/{locale}/blog/category/{slug}',
  tag: '/{locale}/blog/tag/{slug}',
  author: '/{locale}/authors/{slug}',
};

interface RouteKindRule {
  /** Placeholders of the template, each exactly once; `{locale}` is always the first segment. */
  placeholders: readonly RoutePlaceholder[];
  /**
   * Whether the content's slugs are checked against the reserved slugs, which include every
   * fixed segment of the templates: its `{slug}` then never equals a fixed segment.
   */
  reservedSlugs: boolean;
}

export const ROUTE_KIND_RULES: Readonly<Record<RouteKind, RouteKindRule>> = {
  home: { placeholders: ['{locale}'], reservedSlugs: false },
  page: { placeholders: ['{locale}', '{slug}'], reservedSlugs: true },
  post: { placeholders: ['{locale}', '{slug}'], reservedSlugs: true },
  postCategory: { placeholders: ['{locale}', '{slug}'], reservedSlugs: false },
  tag: { placeholders: ['{locale}', '{slug}'], reservedSlugs: false },
  author: { placeholders: ['{locale}', '{slug}'], reservedSlugs: false },
};

export const ROUTE_TEMPLATE_MAX_LENGTH = 200;
export const ROUTE_TEMPLATE_MAX_SEGMENTS = 8;

function isPlaceholder(segment: string): segment is RoutePlaceholder {
  return (ROUTE_PLACEHOLDERS as readonly string[]).includes(segment);
}

/** The segments of `/a/b/c`; null unless it starts with a slash and has no empty segment. */
function segmentsOf(template: string): string[] | null {
  if (!template.startsWith('/') || template.length === 1) return null;
  const segments = template.slice(1).split('/');
  return segments.includes('') ? null : segments;
}

export type RouteTemplateIssueCode =
  /** Not `/segment/segment…`: no leading slash, an empty segment, a trailing slash, too long. */
  | 'format'
  /** A segment is neither a placeholder nor a lowercase slug (e.g. `Blog`, `post-{slug}`). */
  | 'segment'
  /** The first segment is not `{locale}`: every language has its prefix. */
  | 'locale_first'
  /** A placeholder is missing, repeated or not available for this content. */
  | 'placeholders'
  /** Two templates can produce the same address. */
  | 'overlap';

export interface RouteTemplateIssue {
  kind: RouteKind;
  code: RouteTemplateIssueCode;
  message: string;
  /** `overlap`: the other template and an address both can produce. */
  other?: RouteKind;
  example?: string;
}

/** Problems of one template on its own. */
function ownIssue(kind: RouteKind, template: string): RouteTemplateIssue | null {
  const issue = (code: RouteTemplateIssueCode, message: string) => ({ kind, code, message });
  const segments = segmentsOf(template);
  if (
    !segments ||
    template.length > ROUTE_TEMPLATE_MAX_LENGTH ||
    segments.length > ROUTE_TEMPLATE_MAX_SEGMENTS
  ) {
    return issue(
      'format',
      `must look like /{locale}/blog/{slug}: a leading slash, no empty segments or trailing slash, ` +
        `at most ${ROUTE_TEMPLATE_MAX_SEGMENTS} segments`,
    );
  }
  const bad = segments.find((s) => !isPlaceholder(s) && !isSlug(s));
  if (bad !== undefined) {
    return issue(
      'segment',
      `"${bad}" must be a placeholder (${ROUTE_PLACEHOLDERS.join(', ')}) or lowercase a-z, 0-9 ` +
        'and single hyphens',
    );
  }
  if (segments[0] !== '{locale}') {
    return issue('locale_first', 'must start with /{locale}');
  }
  const wanted = ROUTE_KIND_RULES[kind].placeholders;
  const used = segments.filter(isPlaceholder);
  if (
    used.length !== wanted.length ||
    new Set(used).size !== used.length ||
    used.some((p) => !wanted.includes(p))
  ) {
    return issue(
      'placeholders',
      `must contain ${wanted.join(' and ')}, each once, and nothing else`,
    );
  }
  return null;
}

/** Whether a placeholder of a kind can stand for a fixed segment of another template. */
function placeholderMayBe(placeholder: string, kind: RouteKind): boolean {
  return !(placeholder === '{slug}' && ROUTE_KIND_RULES[kind].reservedSlugs);
}

/**
 * An address both templates can produce, or null if there is none. Same number of segments,
 * and at every position equal fixed segments or a placeholder that can take the other's value.
 */
function sharedAddress(a: string[], ka: RouteKind, b: string[], kb: RouteKind): string | null {
  if (a.length !== b.length) return null;
  const example: string[] = [];
  for (let i = 0; i < a.length; i++) {
    const [x, y] = [a[i]!, b[i]!];
    if (!isPlaceholder(x) && !isPlaceholder(y)) {
      if (x !== y) return null;
      example.push(x);
    } else if (!isPlaceholder(x)) {
      if (!placeholderMayBe(y, kb)) return null;
      example.push(x);
    } else if (!isPlaceholder(y)) {
      if (!placeholderMayBe(x, ka)) return null;
      example.push(y);
    } else {
      example.push(x === '{locale}' ? 'en' : 'example');
    }
  }
  return `/${example.join('/')}`;
}

/**
 * Checks the templates (chapter 6): `{locale}` first, the placeholders the content has, fixed
 * segments that are slugs, and no two templates that can produce the same address. Fixed
 * segments are reserved slugs, so a page or post `{slug}` never takes one; categories, tags and
 * authors are not checked against reserved slugs, so their `{slug}` can.
 */
export function routeTemplateIssues(templates: RouteTemplates): RouteTemplateIssue[] {
  const issues: RouteTemplateIssue[] = [];
  const valid: [RouteKind, string[]][] = [];
  for (const kind of ROUTE_KINDS) {
    const issue = ownIssue(kind, templates[kind]);
    if (issue) issues.push(issue);
    else valid.push([kind, segmentsOf(templates[kind])!]);
  }
  for (let i = 0; i < valid.length; i++) {
    for (let j = i + 1; j < valid.length; j++) {
      const [ka, a] = valid[i]!;
      const [kb, b] = valid[j]!;
      const example = sharedAddress(a, ka, b, kb);
      if (example === null) continue;
      for (const [kind, other] of [
        [ka, kb],
        [kb, ka],
      ] as const) {
        issues.push({
          kind,
          code: 'overlap',
          message: `can produce the same address as the ${other} template, e.g. ${example}`,
          other,
          example,
        });
      }
    }
  }
  return issues;
}

/**
 * Fixed segments of the templates, e.g. `blog` and `authors`. They are reserved slugs
 * (chapter 6: "模板中的固定段自动加入保留 slug"), so no page or post can take their address.
 */
export function routeFixedSegments(templates: RouteTemplates = DEFAULT_ROUTE_TEMPLATES): string[] {
  const segments = new Set<string>();
  for (const template of Object.values(templates)) {
    for (const segment of template.split('/')) {
      if (segment && !isPlaceholder(segment)) segments.add(segment);
    }
  }
  return [...segments].sort();
}

// Frontends fill templates with the same function, so it lives in the published SDK
// (docs/adr/0013): the address a template gives, e.g. `/zh-cn/blog/hello` (chapter 6: always
// lowercase).
export { routePath, type RouteValues } from '@bluepax/cms-client/routes';

/** The frontend address of a content item in one language. */
export function contentPath(
  kind: RouteKind,
  locale: string,
  slug: string,
  templates: RouteTemplates = DEFAULT_ROUTE_TEMPLATES,
): string {
  return routePath(templates[kind], { locale, slug });
}

/** The frontend path of a page in one language: the home page has the home template. */
export function pagePath(
  locale: string,
  slug: string,
  home: boolean,
  templates: RouteTemplates = DEFAULT_ROUTE_TEMPLATES,
): string {
  return contentPath(home ? 'home' : 'page', locale, slug, templates);
}

/** The absolute URL of a frontend path; the base URL has no trailing slash (config schema). */
export function absoluteUrl(baseUrl: string, path: string): string {
  return `${baseUrl}${path}`;
}

/** Placeholder values when a path fits a template, e.g. `{ locale: 'en', slug: 'about' }`. */
export type RouteMatch = Partial<Record<'locale' | 'slug' | 'type' | 'category', string>>;

/** The placeholder values of a path under a template, or null if it does not fit. */
export function matchRoute(template: string, path: string): RouteMatch | null {
  const t = segmentsOf(template);
  const p = segmentsOf(path);
  if (!t || !p || t.length !== p.length) return null;
  const match: RouteMatch = {};
  for (let i = 0; i < t.length; i++) {
    const segment = t[i]!;
    if (isPlaceholder(segment)) {
      match[segment.slice(1, -1) as keyof RouteMatch] = p[i]!;
    } else if (segment !== p[i]) {
      return null;
    }
  }
  return match;
}
