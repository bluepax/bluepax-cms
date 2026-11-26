// Addresses of routable content (docs/spec/README.md chapter 6, "路由模板"; docs/adr/0011).
// Every frontend address comes from the route templates of the instance configuration: the
// addresses of a content item per language, all published addresses (sitemap, 301s when a
// template changes) and the resolution of a path, which `GET /routes/resolve` of the Delivery
// API returns. A language that is not published has no address and never falls back.
import { isSlug } from '@bluepax/core';
import { schema, type Executor } from '@bluepax/db';
import {
  matchRoute,
  ROUTE_KINDS,
  routePath,
  type InstanceConfig,
  type RouteKind,
  type RouteTemplates,
} from '@bluepax/presets';
import { and, eq, type SQL } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';
import { exportInstanceConfig } from '../instance.ts';

/**
 * Content types with an address; the home page is a page with its own template. Pages and
 * posts have an address in a language once published there; categories and tags have no
 * status, so a translation is enough; authors need a public author page too (chapter 4).
 */
export type RoutableType = 'page' | 'post' | 'postCategory' | 'tag' | 'author';

export interface ContentRef {
  type: RoutableType;
  id: string;
}

/** One language of a content item that has an address. */
export interface RouteEntry extends ContentRef {
  /** The template it uses: `home` for the home page, else the same as its type. */
  route: RouteKind;
  locale: string;
  slug: string;
}

export interface ContentAddress extends RouteEntry {
  path: string;
}

/** What the routing needs from the configuration. */
export interface RoutingSetup {
  templates: RouteTemplates;
  /** Content language codes in configuration order, e.g. `zh-CN`. */
  languages: string[];
  primary: string;
}

export function routingSetup(config: InstanceConfig): RoutingSetup {
  return {
    templates: config.frontend.routes,
    languages: config.languages.content.map((l) => l.code),
    primary: config.languages.primary,
  };
}

export async function currentRouting(db: Executor): Promise<RoutingSetup> {
  return routingSetup(await exportInstanceConfig(db));
}

export function entryPath(templates: RouteTemplates, entry: RouteEntry): string {
  return routePath(templates[entry.route], { locale: entry.locale, slug: entry.slug });
}

// ---------------------------------------------------------------------------------------------
// Lookups

interface EntryFilter {
  id?: string;
  locale?: string;
  slug?: string;
  /** Pages only: just the home page. */
  home?: boolean;
}

interface TranslationColumns {
  entityId: AnyPgColumn;
  locale: AnyPgColumn;
  slug: AnyPgColumn;
}

function conditions(t: TranslationColumns, filter: EntryFilter, ...more: SQL[]): SQL | undefined {
  return and(
    filter.id === undefined ? undefined : eq(t.entityId, filter.id),
    filter.locale === undefined ? undefined : eq(t.locale, filter.locale),
    filter.slug === undefined ? undefined : eq(t.slug, filter.slug),
    ...more,
  );
}

/** The languages of content of one type that have an address. */
async function entriesOf(
  db: Executor,
  type: RoutableType,
  filter: EntryFilter = {},
): Promise<RouteEntry[]> {
  switch (type) {
    case 'page': {
      const t = schema.pagesTranslations;
      const rows = await db
        .select({ id: t.entityId, locale: t.locale, slug: t.slug, isHome: schema.pages.isHome })
        .from(t)
        .innerJoin(schema.pages, eq(schema.pages.id, t.entityId))
        .where(
          conditions(
            t,
            filter,
            eq(t.status, 'published'),
            ...(filter.home ? [eq(schema.pages.isHome, true)] : []),
          ),
        );
      return rows.map((r) => ({
        type,
        route: r.isHome ? 'home' : 'page',
        id: r.id,
        locale: r.locale,
        slug: r.slug,
      }));
    }
    case 'post': {
      const t = schema.postsTranslations;
      const rows = await db
        .select({ id: t.entityId, locale: t.locale, slug: t.slug })
        .from(t)
        .where(conditions(t, filter, eq(t.status, 'published')));
      return rows.map((r) => ({ type, route: type, ...r }));
    }
    case 'postCategory':
    case 'tag': {
      const t = type === 'tag' ? schema.tagsTranslations : schema.postCategoriesTranslations;
      const rows = await db
        .select({ id: t.entityId, locale: t.locale, slug: t.slug })
        .from(t)
        .where(conditions(t, filter));
      return rows.map((r) => ({ type, route: type, ...r }));
    }
    case 'author': {
      const t = schema.authorsTranslations;
      const rows = await db
        .select({ id: t.entityId, locale: t.locale, slug: t.slug })
        .from(t)
        .innerJoin(schema.authors, eq(schema.authors.id, t.entityId))
        .where(conditions(t, filter, eq(schema.authors.publicPage, true)));
      return rows.map((r) => ({ type, route: type, ...r }));
    }
  }
}

const TYPES: readonly RoutableType[] = ['page', 'post', 'postCategory', 'tag', 'author'];

/** Every address of the frontend's content, e.g. for the sitemap (M2). */
export async function publishedAddresses(
  db: Executor,
  templates: RouteTemplates,
  /** Only content that uses one of these templates. */
  routes: readonly RouteKind[] = ROUTE_KINDS,
): Promise<ContentAddress[]> {
  const types = TYPES.filter((type) =>
    routes.some((route) => route === type || (route === 'home' && type === 'page')),
  );
  const entries = (await Promise.all(types.map((type) => entriesOf(db, type)))).flat();
  return entries
    .filter((entry) => routes.includes(entry.route))
    .map((entry) => ({ ...entry, path: entryPath(templates, entry) }));
}

/** The address of a content item per language that has one, in configuration order. */
export async function contentAddresses(
  db: Executor,
  setup: RoutingSetup,
  ref: ContentRef,
): Promise<Record<string, string>> {
  const entries = await entriesOf(db, ref.type, { id: ref.id });
  const result: Record<string, string> = {};
  for (const locale of setup.languages) {
    const entry = entries.find((e) => e.locale === locale);
    if (entry) result[locale] = entryPath(setup.templates, entry);
  }
  return result;
}

// ---------------------------------------------------------------------------------------------
// Template changes

export interface AddressChange extends ContentRef {
  locale: string;
  from: string;
  to: string;
}

/**
 * Published addresses that a change of the templates moves (chapter 6: they get a 301, and the
 * admin confirms their number first). The 301s themselves are written by `seo` (M2).
 */
export async function addressChanges(
  db: Executor,
  before: RouteTemplates,
  after: RouteTemplates,
): Promise<AddressChange[]> {
  const changed = ROUTE_KINDS.filter((kind) => before[kind] !== after[kind]);
  if (changed.length === 0) return [];
  const addresses = await publishedAddresses(db, before, changed);
  return addresses
    .map((a) => ({
      type: a.type,
      id: a.id,
      locale: a.locale,
      from: a.path,
      to: entryPath(after, a),
    }))
    .filter((change) => change.from !== change.to)
    .sort((a, b) => (a.from < b.from ? -1 : a.from > b.from ? 1 : 0));
}

// ---------------------------------------------------------------------------------------------
// Resolving paths

/** Longer paths are never addresses; they are not looked up. */
const MAX_PATH_LENGTH = 1000;

export type Resolution =
  | {
      status: 200;
      type: RoutableType;
      route: RouteKind;
      id: string;
      /** The content language, e.g. `zh-CN`. */
      locale: string;
      path: string;
      /** The address in every language that has one, the requested one included. */
      alternates: Record<string, string>;
    }
  | { status: 301; location: string }
  | { status: 404 };
// A 410 marker for deleted content comes from the redirect table of `seo` (M2).

const NOT_FOUND: Resolution = { status: 404 };

/** The home address of the primary language, where `/` leads. */
function rootTarget(setup: RoutingSetup): Resolution {
  return { status: 301, location: routePath(setup.templates.home, { locale: setup.primary }) };
}

/** Lowercase and without trailing slashes (chapter 6), `/` for the root. */
function canonicalPath(path: string): string {
  let end = path.length;
  while (end > 1 && path.charCodeAt(end - 1) === 0x2f) end--;
  return path.slice(0, end).toLowerCase();
}

/**
 * What the frontend answers for a path (chapter 6, `GET /routes/resolve`): the content with its
 * addresses in every language, a 301 or a 404. `/` leads to the primary language's home page,
 * the home page's own slug to the home address, and a path with capitals or a trailing slash to
 * the lowercase address without it, if that is content.
 */
export async function resolvePath(
  db: Executor,
  setup: RoutingSetup,
  path: string,
): Promise<Resolution> {
  if (!path.startsWith('/') || path.length > MAX_PATH_LENGTH) return NOT_FOUND;
  const canonical = canonicalPath(path);
  if (canonical === '/') return rootTarget(setup);
  const found = await lookup(db, setup, canonical);
  if (canonical === path || found.status === 404) return found;
  return found.status === 301 ? found : { status: 301, location: found.path };
}

async function lookup(db: Executor, setup: RoutingSetup, path: string): Promise<Resolution> {
  const languages = new Map(setup.languages.map((code) => [code.toLowerCase(), code]));
  // Templates never share an address (routeTemplateIssues), so at most one finds content.
  for (const route of ROUTE_KINDS) {
    const match = matchRoute(setup.templates[route], path);
    const locale = match?.locale === undefined ? undefined : languages.get(match.locale);
    if (!match || !locale) continue;
    if (route === 'home') {
      const [home] = await entriesOf(db, 'page', { locale, home: true });
      if (home) return found(db, setup, home);
      continue;
    }
    if (!match.slug || !isSlug(match.slug)) continue;
    const [entry] = await entriesOf(db, route, { locale, slug: match.slug });
    if (!entry) continue;
    // The home page also has a slug; its address is the home template's.
    if (entry.route !== route) {
      return { status: 301, location: entryPath(setup.templates, entry) };
    }
    return found(db, setup, entry);
  }
  return NOT_FOUND;
}

async function found(db: Executor, setup: RoutingSetup, entry: RouteEntry): Promise<Resolution> {
  return {
    status: 200,
    type: entry.type,
    route: entry.route,
    id: entry.id,
    locale: entry.locale,
    path: entryPath(setup.templates, entry),
    alternates: await contentAddresses(db, setup, entry),
  };
}
