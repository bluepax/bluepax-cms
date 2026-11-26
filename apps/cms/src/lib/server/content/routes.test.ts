import { fileURLToPath } from 'node:url';
import {
  createDatabase,
  createPool,
  migrationSets,
  runMigrations,
  schema,
  type ContentStatus,
  type Database,
} from '@bluepax/db';
import { freshTestDatabase } from '@bluepax/db/testing';
import { configFromPreset, DEFAULT_ROUTE_TEMPLATES, type RouteTemplates } from '@bluepax/presets';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { listAudit } from '../audit.ts';
import { exportInstanceConfig, initializeInstance } from '../instance.ts';
import { migrationSetNames, registry } from '../modules.ts';
import { reservedSlugs } from '../modules/pages/slugs.ts';
import { saveFrontend, saveRouteTemplates } from '../modules/site/settings.ts';
import { InvalidInputError } from '../modules/site/values.ts';
import {
  addressChanges,
  contentAddresses,
  currentRouting,
  publishedAddresses,
  resolvePath,
  type Resolution,
} from './routes.ts';
import { emptySeo } from './seo.ts';

// Integration tests: need a PostgreSQL server (TEST_DATABASE_URL).
const baseUrl = process.env.TEST_DATABASE_URL;
const migrations = fileURLToPath(
  new URL('../../../../../../packages/db/migrations', import.meta.url),
);

const config = configFromPreset({
  type: 'corporate',
  name: 'Example Site',
  contentLanguages: ['en', 'zh-CN', 'ar'],
  primaryLanguage: 'en',
  adminLocale: 'en',
  frontendBaseUrl: 'https://www.example.com',
});

/** The reason and details of an InvalidInputError. */
async function refusal(run: Promise<unknown>) {
  try {
    await run;
  } catch (error) {
    if (error instanceof InvalidInputError) {
      return { reason: error.reason, fields: error.fields, details: error.details };
    }
    throw error;
  }
  throw new Error('expected an InvalidInputError');
}

describe.skipIf(!baseUrl)('route templates and path resolution', { timeout: 30_000 }, () => {
  let pool: ReturnType<typeof createPool>;
  let db: Database;
  let actor: { id: string; ip: string };
  const ids: Record<string, string> = {};

  const resolve = async (path: string): Promise<Resolution> =>
    resolvePath(db, await currentRouting(db), path);

  async function page(
    key: string,
    versions: [locale: string, slug: string, status: ContentStatus][],
    isHome = false,
  ) {
    const [row] = await db.insert(schema.pages).values({ isHome }).returning();
    ids[key] = row!.id;
    for (const [locale, slug, status] of versions) {
      await db.insert(schema.pagesTranslations).values({
        entityId: row!.id,
        locale,
        slug,
        title: `${key} ${locale}`,
        status,
        seo: emptySeo(),
      });
    }
  }

  async function post(key: string, versions: [string, string, ContentStatus][]) {
    const [row] = await db.insert(schema.posts).values({}).returning();
    ids[key] = row!.id;
    for (const [locale, slug, status] of versions) {
      await db.insert(schema.postsTranslations).values({
        entityId: row!.id,
        locale,
        slug,
        title: `${key} ${locale}`,
        body: { type: 'doc', content: [] },
        status,
        seo: emptySeo(),
      });
    }
  }

  beforeAll(async () => {
    pool = createPool(await freshTestDatabase(baseUrl!, 'routes'), 4);
    await runMigrations(pool, migrationSets(migrations, migrationSetNames()));
    db = createDatabase(pool);
    const { adminId } = await initializeInstance(db, config, {
      registry,
      source: 'wizard',
      admin: {
        email: 'owner@example.com',
        displayName: 'Owner',
        password: 'a long enough password',
        locale: 'en',
      },
    });
    actor = { id: adminId!, ip: '203.0.113.7' };

    await page(
      'home',
      [
        ['en', 'start', 'published'],
        ['zh-CN', 'start', 'published'],
        ['ar', 'start', 'draft'],
      ],
      true,
    );
    await page('about', [
      ['en', 'about', 'published'],
      ['zh-CN', 'guanyu', 'draft'],
      ['ar', 'about', 'published'],
    ]);
    await page('offline', [['en', 'old', 'unpublished']]);
    await post('hello', [
      ['en', 'hello', 'published'],
      ['zh-CN', 'nihao', 'published'],
      ['ar', 'marhaba', 'in_review'],
    ]);

    const [category] = await db.insert(schema.postCategories).values({}).returning();
    ids.news = category!.id;
    await db.insert(schema.postCategoriesTranslations).values([
      { entityId: category!.id, locale: 'en', slug: 'news', name: 'News', seo: emptySeo() },
      { entityId: category!.id, locale: 'ar', slug: 'akhbar', name: 'أخبار', seo: emptySeo() },
    ]);
    const [tag] = await db.insert(schema.tags).values({}).returning();
    ids.tips = tag!.id;
    await db
      .insert(schema.tagsTranslations)
      .values({ entityId: tag!.id, locale: 'en', slug: 'tips', name: 'Tips', seo: emptySeo() });
    const [alex] = await db.insert(schema.authors).values({ publicPage: true }).returning();
    const [hidden] = await db.insert(schema.authors).values({ publicPage: false }).returning();
    ids.alex = alex!.id;
    await db.insert(schema.authorsTranslations).values([
      { entityId: alex!.id, locale: 'en', slug: 'alex', name: 'Alex', seo: emptySeo() },
      { entityId: hidden!.id, locale: 'en', slug: 'hidden', name: 'Hidden', seo: emptySeo() },
    ]);
  });

  afterAll(async () => {
    await pool?.end();
  });

  it('seeds the default templates and exports them', async () => {
    expect((await exportInstanceConfig(db)).frontend.routes).toEqual(DEFAULT_ROUTE_TEMPLATES);
    expect([...(await reservedSlugs(db))].sort()).toEqual(['authors', 'blog', 'category', 'tag']);
  });

  it('sends / to the home page of the primary language', async () => {
    expect(await resolve('/')).toEqual({ status: 301, location: '/en' });
    expect(await resolve('//')).toEqual({ status: 301, location: '/en' });
  });

  it('resolves the home page per published language, its slug to its address', async () => {
    expect(await resolve('/en')).toEqual({
      status: 200,
      type: 'page',
      route: 'home',
      id: ids.home,
      locale: 'en',
      slug: 'start',
      path: '/en',
      alternates: { en: '/en', 'zh-CN': '/zh-cn' },
    });
    expect(await resolve('/zh-cn')).toMatchObject({ status: 200, locale: 'zh-CN' });
    // Not published in Arabic: no fallback to another language.
    expect(await resolve('/ar')).toEqual({ status: 404 });
    expect(await resolve('/en/start')).toEqual({ status: 301, location: '/en' });
    expect(await resolve('/ar/start')).toEqual({ status: 404 });
  });

  it('resolves pages, posts, categories, tags and authors in every language', async () => {
    expect(await resolve('/en/about')).toEqual({
      status: 200,
      type: 'page',
      route: 'page',
      id: ids.about,
      locale: 'en',
      slug: 'about',
      path: '/en/about',
      alternates: { en: '/en/about', ar: '/ar/about' },
    });
    expect(await resolve('/ar/about')).toMatchObject({ status: 200, locale: 'ar' });
    expect(await resolve('/zh-cn/guanyu')).toEqual({ status: 404 });
    expect(await resolve('/en/old')).toEqual({ status: 404 });
    expect(await resolve('/zh-cn/blog/nihao')).toEqual({
      status: 200,
      type: 'post',
      route: 'post',
      id: ids.hello,
      locale: 'zh-CN',
      slug: 'nihao',
      path: '/zh-cn/blog/nihao',
      alternates: { en: '/en/blog/hello', 'zh-CN': '/zh-cn/blog/nihao' },
    });
    expect(await resolve('/ar/blog/marhaba')).toEqual({ status: 404 });
    // A post slug is not a page slug, and the other way round.
    expect(await resolve('/en/hello')).toEqual({ status: 404 });
    expect(await resolve('/en/blog/about')).toEqual({ status: 404 });
    expect(await resolve('/ar/blog/category/akhbar')).toEqual({
      status: 200,
      type: 'postCategory',
      route: 'postCategory',
      id: ids.news,
      locale: 'ar',
      slug: 'akhbar',
      path: '/ar/blog/category/akhbar',
      alternates: { en: '/en/blog/category/news', ar: '/ar/blog/category/akhbar' },
    });
    expect(await resolve('/en/blog/tag/tips')).toMatchObject({ status: 200, id: ids.tips });
    expect(await resolve('/en/blog/category/tips')).toEqual({ status: 404 });
    expect(await resolve('/en/authors/alex')).toMatchObject({
      status: 200,
      type: 'author',
      id: ids.alex,
      alternates: { en: '/en/authors/alex' },
    });
    // No public author page, no address.
    expect(await resolve('/en/authors/hidden')).toEqual({ status: 404 });
  });

  it('answers unknown paths, fixed segments and reserved slugs with 404', async () => {
    for (const path of [
      '/en/missing',
      '/fr/about',
      '/en/about/more',
      '/en/blog',
      '/en/authors',
      '/en/blog/category',
      '/en/search',
      'en/about',
      '/en//about',
      '/en/bad_slug',
      `/en/${'a'.repeat(2000)}`,
    ]) {
      expect(await resolve(path), path).toEqual({ status: 404 });
    }
  });

  it('sends capitals and trailing slashes to the lowercase address', async () => {
    expect(await resolve('/EN/About')).toEqual({ status: 301, location: '/en/about' });
    expect(await resolve('/en/about/')).toEqual({ status: 301, location: '/en/about' });
    expect(await resolve('/zh-CN')).toEqual({ status: 301, location: '/zh-cn' });
    expect(await resolve('/EN/start')).toEqual({ status: 301, location: '/en' });
    expect(await resolve('/en/missing/')).toEqual({ status: 404 });
  });

  it('lists the addresses of a content item and every published address', async () => {
    const setup = await currentRouting(db);
    expect(await contentAddresses(db, setup, { type: 'post', id: ids.hello! })).toEqual({
      en: '/en/blog/hello',
      'zh-CN': '/zh-cn/blog/nihao',
    });
    const all = (await publishedAddresses(db, setup.templates)).map((a) => a.path).sort();
    expect(all).toEqual([
      '/ar/about',
      '/ar/blog/category/akhbar',
      '/en',
      '/en/about',
      '/en/authors/alex',
      '/en/blog/category/news',
      '/en/blog/hello',
      '/en/blog/tag/tips',
      '/zh-cn',
      '/zh-cn/blog/nihao',
    ]);
    const moved: RouteTemplates = { ...DEFAULT_ROUTE_TEMPLATES, home: '/{locale}/start' };
    expect(await addressChanges(db, DEFAULT_ROUTE_TEMPLATES, moved)).toEqual([
      { type: 'page', id: ids.home, locale: 'en', from: '/en', to: '/en/start' },
      { type: 'page', id: ids.home, locale: 'zh-CN', from: '/zh-cn', to: '/zh-cn/start' },
    ]);
    expect(await addressChanges(db, DEFAULT_ROUTE_TEMPLATES, DEFAULT_ROUTE_TEMPLATES)).toEqual([]);
  });

  it('refuses templates with issues, and fixed segments that pages or posts use', async () => {
    const save = (routes: Partial<RouteTemplates>, confirmed: number | null = null) =>
      saveRouteTemplates(db, { routes, confirmed }, actor);
    expect(await refusal(save({ post: '/{locale}/{slug}' }))).toMatchObject({
      reason: 'route_templates',
      fields: ['routes.page', 'routes.post'],
      details: {
        issues: [
          { kind: 'page', code: 'overlap', other: 'post', example: '/en/example' },
          { kind: 'post', code: 'overlap', other: 'page', example: '/en/example' },
        ],
      },
    });
    expect(await refusal(save({ author: '/team/{slug}' }))).toMatchObject({
      reason: 'route_templates',
      fields: ['routes.author'],
    });
    // `about` becomes a fixed segment, but pages use it as a slug.
    expect(await refusal(save({ tag: '/{locale}/about/{slug}' }))).toMatchObject({
      reason: 'slug_in_use',
      fields: ['routes.tag'],
      details: {
        pages: [
          { pageId: ids.about, locale: 'ar', slug: 'about' },
          { pageId: ids.about, locale: 'en', slug: 'about' },
        ],
        posts: [],
      },
    });
    expect((await exportInstanceConfig(db)).frontend.routes).toEqual(DEFAULT_ROUTE_TEMPLATES);
  });

  it('asks to confirm the moved addresses, then saves and audits the change', async () => {
    const routes = { post: '/{locale}/articles/{slug}', postCategory: '/{locale}/topics/{slug}' };
    const asked = await refusal(saveRouteTemplates(db, { routes, confirmed: null }, actor));
    expect(asked).toEqual({
      reason: 'confirm_required',
      fields: [],
      details: {
        count: 4,
        changes: [
          { from: '/ar/blog/category/akhbar', to: '/ar/topics/akhbar' },
          { from: '/en/blog/category/news', to: '/en/topics/news' },
          { from: '/en/blog/hello', to: '/en/articles/hello' },
          { from: '/zh-cn/blog/nihao', to: '/zh-cn/articles/nihao' },
        ],
      },
    });
    // A stale number asks again; nothing is saved meanwhile.
    expect(await refusal(saveRouteTemplates(db, { routes, confirmed: 3 }, actor))).toMatchObject({
      reason: 'confirm_required',
    });
    expect((await exportInstanceConfig(db)).frontend.routes).toEqual(DEFAULT_ROUTE_TEMPLATES);

    await saveRouteTemplates(db, { routes, confirmed: 4 }, actor);
    const { frontend } = await exportInstanceConfig(db);
    expect(frontend.routes).toEqual({ ...DEFAULT_ROUTE_TEMPLATES, ...routes });
    const [change, update] = await listAudit(db, { limit: 2 });
    expect(update).toMatchObject({ action: 'site.update', details: { frontend: ['routes'] } });
    expect(change).toMatchObject({
      action: 'site.routes_change',
      targetId: 'frontend',
      ip: '203.0.113.7',
      details: {
        before: {
          post: '/{locale}/blog/{slug}',
          postCategory: '/{locale}/blog/category/{slug}',
        },
        after: routes,
        addresses: expect.arrayContaining([
          {
            type: 'post',
            id: ids.hello,
            locale: 'zh-CN',
            from: '/zh-cn/blog/nihao',
            to: '/zh-cn/articles/nihao',
          },
        ]),
      },
    });
    expect((change!.details as { addresses: unknown[] }).addresses).toHaveLength(4);

    // Resolved with the new templates; the old addresses get their 301 from seo (M2).
    expect(await resolve('/zh-cn/articles/nihao')).toMatchObject({
      status: 200,
      alternates: { en: '/en/articles/hello', 'zh-CN': '/zh-cn/articles/nihao' },
    });
    expect(await resolve('/en/topics/news')).toMatchObject({ status: 200, id: ids.news });
    expect(await resolve('/en/blog/hello')).toEqual({ status: 404 });
    // The new fixed segments are reserved, `blog` still is (tags), `category` no longer.
    expect([...(await reservedSlugs(db))].sort()).toEqual([
      'articles',
      'authors',
      'blog',
      'tag',
      'topics',
    ]);
  });

  it('saves unchanged templates and reserved slugs without a routes audit entry', async () => {
    const before = await exportInstanceConfig(db);
    await saveRouteTemplates(db, { routes: before.frontend.routes, confirmed: null }, actor);
    await saveFrontend(db, { reservedSlugs: ['search'] }, actor);
    const [entry] = await listAudit(db, { limit: 1 });
    expect(entry).toMatchObject({
      action: 'site.update',
      details: { frontend: ['reservedSlugs'] },
    });
    expect((await exportInstanceConfig(db)).frontend).toEqual({
      ...before.frontend,
      reservedSlugs: ['search'],
    });
    // Reserved slugs that pages use are refused as before.
    expect(await refusal(saveFrontend(db, { reservedSlugs: ['about'] }, actor))).toMatchObject({
      reason: 'slug_in_use',
      fields: ['reservedSlugs'],
    });
  });
});
