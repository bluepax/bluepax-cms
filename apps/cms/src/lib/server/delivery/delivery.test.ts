import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
import { configFromPreset } from '@bluepax/presets';
import { createLocalDriver, type StorageDriver } from '@bluepax/storage';
import { eq } from 'drizzle-orm';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { z } from 'zod';
import { listAudit } from '../audit.ts';
import { emptySeo } from '../content/seo.ts';
import { initializeInstance } from '../instance.ts';
import { migrationSetNames, registry } from '../modules.ts';
import {
  previewSecret,
  rotatePreviewSecret,
  saveFrontendBaseUrl,
} from '../modules/api/frontend.ts';
import { createPreviewToken } from '../modules/api/preview.ts';
import {
  issueDeliveryToken,
  listDeliveryTokens,
  MAX_ACTIVE_TOKENS,
  revokeDeliveryToken,
} from '../modules/api/tokens.ts';
import { uploadMedia, type MediaContext } from '../modules/media/library.ts';
import { createNavItem } from '../modules/site/navigation.ts';
import { saveBranding, saveGeneral } from '../modules/site/settings.ts';
import { InvalidInputError } from '../modules/site/values.ts';
import { SlidingWindowLimiter } from '../security/rate-limit.ts';
import {
  authorListSchema,
  authorSchema,
  blockSchemasSchema,
  errorSchema,
  pageSchema,
  postListSchema,
  postSchema,
  previewSchema,
  resolutionSchema,
  siteSchema,
  termListSchema,
} from '@bluepax/cms-client/contract';
import { handleDeliveryRequest, type DeliveryDeps } from './http.ts';
import { openApiDocument } from './openapi.ts';
import { OPERATIONS } from './operations.ts';

// Integration tests: need a PostgreSQL server (TEST_DATABASE_URL).
const baseUrl = process.env.TEST_DATABASE_URL;
const migrations = fileURLToPath(
  new URL('../../../../../../packages/db/migrations', import.meta.url),
);

const CMS = 'https://cms.example.com';
const FRONTEND = 'https://www.example.com';
const KEY = Buffer.alloc(32, 7);

const config = configFromPreset({
  type: 'blog',
  name: 'Example Blog',
  contentLanguages: ['en', 'zh-CN'],
  primaryLanguage: 'en',
  adminLocale: 'en',
  frontendBaseUrl: FRONTEND,
});

const image = (width: number, height: number, color: string) =>
  sharp({ create: { width, height, channels: 3, background: color } })
    .png()
    .toBuffer();

describe.skipIf(!baseUrl)('delivery api', { timeout: 60_000 }, () => {
  let pool: ReturnType<typeof createPool>;
  let db: Database;
  let storage: StorageDriver;
  let root: string;
  let actor: { id: string; ip: string };
  let token: string;
  const ids: Record<string, string> = {};

  const deps = (extra: Partial<DeliveryDeps> = {}): DeliveryDeps => ({
    db,
    storage,
    registry,
    origin: CMS,
    clientIp: '203.0.113.9',
    previewSecret: () => previewSecret(db, KEY),
    ...extra,
  });

  async function call(
    path: string,
    init: { token?: string | null; headers?: Record<string, string>; method?: string } = {},
    extra: Partial<DeliveryDeps> = {},
  ) {
    const headers: Record<string, string> = { ...init.headers };
    const bearer = init.token === undefined ? token : init.token;
    if (bearer !== null) headers.authorization = `Bearer ${bearer}`;
    const response = await handleDeliveryRequest(
      new Request(`${CMS}/api/delivery/v1${path}`, { method: init.method ?? 'GET', headers }),
      deps(extra),
    );
    const text = await response.text();
    return { response, status: response.status, body: text ? JSON.parse(text) : null };
  }

  /**
   * The contract test (chapter 12): the body must match the contract schema that the OpenAPI
   * document is generated from, and must not carry fields the contract does not describe. Zod
   * objects drop unknown keys while parsing, so the parsed value has to equal the raw body.
   */
  function described<S extends z.ZodType>(contract: S, body: unknown): z.output<S> {
    const parsed = contract.parse(body);
    expect(parsed, 'the response has fields the contract does not describe').toEqual(body);
    return parsed;
  }

  /** Calls an endpoint and checks the body against the contract schema. */
  async function get<S extends z.ZodType>(path: string, contract: S): Promise<z.output<S>> {
    const { status, body } = await call(path);
    expect(status, JSON.stringify(body)).toBe(200);
    return described(contract, body);
  }

  async function errorOf(
    path: string,
    init?: Parameters<typeof call>[1],
    extra?: Partial<DeliveryDeps>,
  ) {
    const { status, body } = await call(path, init, extra);
    return { status, code: described(errorSchema, body).error.code };
  }

  async function insertPage(
    key: string,
    versions: [locale: string, slug: string, status: ContentStatus][],
    options: { isHome?: boolean; blocks?: { type: string; data: unknown }[] } = {},
  ) {
    const [row] = await db
      .insert(schema.pages)
      .values({ isHome: options.isHome ?? false })
      .returning();
    ids[key] = row!.id;
    for (const [locale, slug, status] of versions) {
      const [translation] = await db
        .insert(schema.pagesTranslations)
        .values({
          entityId: row!.id,
          locale,
          slug,
          title: `${key} ${locale}`,
          status,
          publishedAt: status === 'published' ? new Date('2026-11-01T00:00:00Z') : null,
          seo: emptySeo(),
        })
        .returning();
      if (options.blocks?.length) {
        await db.insert(schema.pageBlocks).values(
          options.blocks.map((b, sortOrder) => ({
            translationId: translation!.id,
            sortOrder,
            ...b,
          })),
        );
      }
    }
  }

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'bluepax-delivery-'));
    storage = createLocalDriver({ root, publicBaseUrl: '/uploads' });
    pool = createPool(await freshTestDatabase(baseUrl!, 'delivery'), 4);
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
    const media: MediaContext = { db, storage };
    const limits = { image: 20, document: 50, video: 200 };
    ids.logo = (
      await uploadMedia(
        media,
        { name: 'logo.png', data: await image(64, 64, '#123456') },
        null,
        limits,
        actor,
      )
    ).id;
    ids.cover = (
      await uploadMedia(
        media,
        { name: 'cover.png', data: await image(240, 120, '#aa3300') },
        null,
        limits,
        actor,
      )
    ).id;
    ids.avatar = (
      await uploadMedia(
        media,
        { name: 'alex.png', data: await image(48, 48, '#00aa66') },
        null,
        limits,
        actor,
      )
    ).id;
    await saveBranding(media, { themeColor: '#112233', logo: ids.logo, icon: null }, actor);

    await insertPage(
      'home',
      [
        ['en', 'start', 'published'],
        ['zh-CN', 'start', 'published'],
      ],
      {
        isHome: true,
      },
    );
    await insertPage(
      'about',
      [
        ['en', 'about', 'published'],
        ['zh-CN', 'guanyu', 'draft'],
      ],
      {
        blocks: [
          {
            type: 'rich-text',
            data: {
              title: 'Hello',
              body: {
                type: 'doc',
                content: [
                  {
                    type: 'paragraph',
                    content: [{ type: 'text', text: '<script>alert(1)</script>' }],
                  },
                  { type: 'image', attrs: { mediaId: ids.cover } },
                ],
              },
            },
          },
          { type: 'latest-posts', data: { limit: 3, categoryId: null } },
          // Not offered by the blog preset (needs catalog): left out.
          { type: 'catalog-list', data: {} },
        ],
      },
    );

    const [alex] = await db
      .insert(schema.authors)
      .values({ avatar: ids.avatar, sameAs: ['https://social.example.com/alex'], publicPage: true })
      .returning();
    ids.alex = alex!.id;
    await db.insert(schema.authorsTranslations).values([
      { entityId: alex!.id, locale: 'en', slug: 'alex', name: 'Alex Example', seo: emptySeo() },
      { entityId: alex!.id, locale: 'zh-CN', slug: 'alex', name: '示例作者', seo: emptySeo() },
    ]);
    const [category] = await db.select().from(schema.postCategoriesTranslations);
    ids.general = category!.entityId;
    const [tag] = await db.insert(schema.tags).values({}).returning();
    ids.tips = tag!.id;
    await db
      .insert(schema.tagsTranslations)
      .values({ entityId: tag!.id, locale: 'en', slug: 'tips', name: 'Tips', seo: emptySeo() });

    for (const [key, slug, status, day] of [
      ['hello', 'hello', 'published', 10],
      ['second', 'second', 'published', 12],
      ['draft', 'unfinished', 'draft', 13],
    ] as const) {
      const [post] = await db
        .insert(schema.posts)
        .values({ cover: key === 'hello' ? ids.cover : null })
        .returning();
      ids[key] = post!.id;
      await db.insert(schema.postsTranslations).values({
        entityId: post!.id,
        locale: 'en',
        slug,
        title: `Post ${key}`,
        excerpt: `About ${key}`,
        body: {
          type: 'doc',
          content: [{ type: 'paragraph', content: [{ type: 'text', text: key }] }],
        },
        status,
        publishedAt: status === 'published' ? new Date(`2026-11-${day}T08:00:00Z`) : null,
        seo: emptySeo(),
      });
      await db
        .insert(schema.postCategoryLinks)
        .values({ postId: post!.id, categoryId: ids.general, sortOrder: 0 });
      await db
        .insert(schema.postAuthorLinks)
        .values({ postId: post!.id, authorId: ids.alex, sortOrder: 0 });
    }
    await db
      .insert(schema.postTagLinks)
      .values({ postId: ids.hello!, tagId: ids.tips, sortOrder: 0 });

    await createNavItem(
      db,
      'header',
      {
        parentId: null,
        label: { en: 'About', 'zh-CN': '关于' },
        url: '',
        pageId: ids.about!,
        newTab: false,
        sortOrder: 0,
      },
      actor,
    );

    token = (
      await issueDeliveryToken(
        db,
        { name: 'production', scopes: ['delivery:read', 'events:write'] },
        actor,
      )
    ).token;
  });

  afterAll(async () => {
    await pool?.end();
    if (root) await rm(root, { recursive: true, force: true });
  });

  describe('tokens', () => {
    it('stores only a hash, shows the prefix and audits issuing and revoking', async () => {
      const { token: other, id } = await issueDeliveryToken(
        db,
        { name: 'staging', scopes: ['delivery:read'], expiresInDays: 30 },
        actor,
      );
      expect(other).toMatch(/^bpxd_[\w-]{43}$/);
      const rows = await db.select().from(schema.apiTokens).where(eq(schema.apiTokens.id, id));
      expect(rows[0]!.tokenHash).not.toContain(other.slice(5));
      expect(JSON.stringify(rows[0])).not.toContain(other);
      const listed = (await listDeliveryTokens(db)).find((t) => t.id === id)!;
      expect(listed).toMatchObject({
        name: 'staging',
        prefix: other.slice(0, 11),
        scopes: ['delivery:read'],
        status: 'active',
      });
      await revokeDeliveryToken(db, id, actor);
      expect((await listDeliveryTokens(db)).find((t) => t.id === id)!.status).toBe('revoked');
      expect((await call('/site', { token: other })).status).toBe(401);
      const actions = (await listAudit(db, { limit: 10 })).map((a) => a.action);
      expect(actions).toEqual(expect.arrayContaining(['api.token_issue', 'api.token_revoke']));
      // The audit keeps the prefix, never the token.
      expect(JSON.stringify(await listAudit(db, { limit: 10 }))).not.toContain(other);
    });

    it('refuses empty scopes, unknown scopes and too many active tokens', async () => {
      await expect(issueDeliveryToken(db, { name: 'x', scopes: [] }, actor)).rejects.toBeInstanceOf(
        InvalidInputError,
      );
      await expect(
        issueDeliveryToken(db, { name: 'x', scopes: ['manage:all' as never] }, actor),
      ).rejects.toBeInstanceOf(InvalidInputError);
      const active = (await listDeliveryTokens(db)).filter((t) => t.status === 'active').length;
      const made: string[] = [];
      for (let i = active; i < MAX_ACTIVE_TOKENS; i++) {
        made.push(
          (await issueDeliveryToken(db, { name: `t${i}`, scopes: ['delivery:read'] }, actor)).id,
        );
      }
      await expect(
        issueDeliveryToken(db, { name: 'one more', scopes: ['delivery:read'] }, actor),
      ).rejects.toMatchObject({
        reason: 'too_many_tokens',
      });
      for (const id of made) await revokeDeliveryToken(db, id, actor);
    });
  });

  describe('authentication, scopes, limits and CORS', () => {
    it('needs a valid token with delivery:read', async () => {
      expect(await errorOf('/site', { token: null })).toEqual({
        status: 401,
        code: 'unauthorized',
      });
      expect(await errorOf('/site', { token: 'bpxd_nope' })).toEqual({
        status: 401,
        code: 'invalid_token',
      });
      expect(
        await errorOf('/site', { headers: { authorization: 'Basic abc' }, token: null }),
      ).toEqual({
        status: 401,
        code: 'invalid_token',
      });
      const events = (
        await issueDeliveryToken(db, { name: 'events only', scopes: ['events:write'] }, actor)
      ).token;
      expect(await errorOf('/site', { token: events })).toEqual({
        status: 403,
        code: 'insufficient_scope',
      });
      const expiring = await issueDeliveryToken(
        db,
        { name: 'short', scopes: ['delivery:read'], expiresInDays: 30 },
        actor,
      );
      const later = new Date(Date.now() + 31 * 86_400_000);
      expect((await call('/site', { token: expiring.token }, { now: later })).status).toBe(401);
      expect((await call('/site', { token: expiring.token })).status).toBe(200);
    });

    it('limits requests per token and unknown tokens per address', async () => {
      const limiters = {
        token: new SlidingWindowLimiter(2, 60_000),
        invalid: new SlidingWindowLimiter(1, 60_000),
      };
      expect(
        (await call('/site', {}, { limiters })).response.headers.get('x-ratelimit-remaining'),
      ).toBe('1');
      expect((await call('/site', {}, { limiters })).status).toBe(200);
      const limited = await call('/site', {}, { limiters });
      expect(limited.status).toBe(429);
      expect(limited.body.error.code).toBe('rate_limited');
      expect(Number(limited.response.headers.get('retry-after'))).toBeGreaterThan(0);
      expect((await call('/site', { token: 'bpxd_bad' }, { limiters })).status).toBe(401);
      expect((await call('/site', { token: 'bpxd_bad' }, { limiters })).status).toBe(429);
    });

    it('allows only the frontend and the CMS as browser origins', async () => {
      expect(await errorOf('/site', { headers: { origin: 'https://evil.example.net' } })).toEqual({
        status: 403,
        code: 'origin_not_allowed',
      });
      const ok = await call('/site', { headers: { origin: FRONTEND } });
      expect(ok.status).toBe(200);
      expect(ok.response.headers.get('access-control-allow-origin')).toBe(FRONTEND);
      const preflight = await call('/site', {
        method: 'OPTIONS',
        token: null,
        headers: { origin: FRONTEND },
      });
      expect(preflight.status).toBe(204);
      expect(preflight.response.headers.get('access-control-allow-headers')).toContain(
        'Authorization',
      );
      // Server-side calls send no Origin and get no CORS header.
      expect((await call('/site')).response.headers.get('access-control-allow-origin')).toBeNull();
    });

    it('answers 404 for endpoints that are not built and 405 for wrong methods', async () => {
      expect(await errorOf('/events', { method: 'POST' })).toEqual({
        status: 404,
        code: 'not_found',
      });
      for (const path of [
        '/feed',
        '/search?q=x',
        '/seo/sitemap',
        '/catalog/products/items',
        '/regions',
      ]) {
        expect(await errorOf(path)).toEqual({ status: 404, code: 'not_found' });
      }
      const wrong = await call('/site', { method: 'DELETE' });
      expect(wrong.status).toBe(405);
      expect(wrong.response.headers.get('allow')).toContain('GET');
    });

    it('answers 304 to a matching If-None-Match and sends Last-Modified', async () => {
      const first = await call('/posts');
      const etag = first.response.headers.get('etag')!;
      expect(etag).toMatch(/^"[\w-]+"$/);
      expect(first.response.headers.get('last-modified')).toBeTruthy();
      expect(first.response.headers.get('cache-control')).toBe('private, no-cache');
      const again = await call('/posts', { headers: { 'if-none-match': etag } });
      expect(again.status).toBe(304);
      expect(again.response.headers.get('etag')).toBe(etag);
    });
  });

  describe('content', () => {
    it('picks the language, accepts any case and refuses unknown languages', async () => {
      expect((await get('/site?locale=zh-cn', siteSchema)).locale).toBe('zh-CN');
      expect((await get('/site', siteSchema)).locale).toBe('en');
      expect(await errorOf('/site?locale=fr')).toEqual({ status: 400, code: 'invalid_locale' });
      expect(await errorOf('/posts?pageSize=101')).toEqual({ status: 400, code: 'invalid_query' });
    });

    it('delivers the site with route templates, navigation and absolute media URLs', async () => {
      const site = await get('/site?locale=zh-CN', siteSchema);
      expect(site.frontend).toEqual({
        baseUrl: FRONTEND,
        routes: config.frontend.routes,
        reservedSlugs: [],
      });
      expect(site.mediaOrigin).toEqual({ driver: 'local', baseUrl: `${CMS}/uploads` });
      expect(site.branding.logo?.url.startsWith(`${CMS}/uploads/`)).toBe(true);
      expect(site.branding.themeColor).toBe('#112233');
      // The About page is not published in Chinese: the item has no address there.
      expect(site.navigation.header).toEqual([
        expect.objectContaining({
          label: '关于',
          href: null,
          target: { type: 'page', id: ids.about },
        }),
      ]);
      expect((await get('/site', siteSchema)).navigation.header[0]!.href).toBe('/en/about');
      expect(site.modules).toEqual(expect.arrayContaining(['api', 'pages', 'posts', 'site']));
      expect(site.modules).not.toContain('catalog');
    });

    it('resolves the publisher per chapter 2', async () => {
      // Person without a main author: configured name or the site name, the stored avatar.
      let publisher = (await get('/site', siteSchema)).publisher;
      expect(publisher).toMatchObject({
        type: 'person',
        name: 'Example Blog',
        authorId: null,
        image: null,
      });
      // Person with a main author: the author's name, avatar, sameAs and author page.
      const media: MediaContext = { db, storage };
      const general = {
        type: 'blog',
        name: 'Example Blog',
        timezone: 'UTC',
        brandTerms: [],
        publisher: { type: 'person', name: '', sameAs: [] },
      };
      await saveGeneral(db, general, actor, { media, image: null, authorId: ids.alex! });
      publisher = (await get('/site?locale=zh-CN', siteSchema)).publisher;
      expect(publisher).toMatchObject({
        type: 'person',
        name: '示例作者',
        sameAs: ['https://social.example.com/alex'],
        url: `${FRONTEND}/zh-cn/authors/alex`,
        authorId: ids.alex,
      });
      expect(publisher.image?.id).toBe(ids.avatar);
      const post = await get('/posts/hello', postSchema);
      expect(post.seo.jsonLd.publisher).toMatchObject({ '@type': 'Person', name: 'Alex Example' });
      // Organization without its own logo: the site logo.
      await saveGeneral(
        db,
        {
          ...general,
          publisher: {
            type: 'organization',
            name: 'Example Ltd',
            sameAs: ['https://social.example.com/ex'],
          },
        },
        actor,
        { media, image: null, authorId: null },
      );
      publisher = (await get('/site', siteSchema)).publisher;
      expect(publisher).toMatchObject({ type: 'organization', name: 'Example Ltd', url: FRONTEND });
      expect(publisher.image?.id).toBe(ids.logo);
      const page = await get('/pages/about', pageSchema);
      expect(page.seo.jsonLd.publisher).toMatchObject({
        '@type': 'Organization',
        name: 'Example Ltd',
        logo: { '@type': 'ImageObject' },
      });
    });

    it('delivers published pages only, with blocks, safe HTML and the seo object', async () => {
      const page = await get('/pages/about', pageSchema);
      expect(page.path).toBe('/en/about');
      expect(page.blocks.map((b) => b.type)).toEqual(['rich-text', 'latest-posts']);
      const html = page.blocks[0]!.html.body!;
      expect(html).toContain('<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>');
      // String checks, not a regex built from the URL (CodeQL js/incomplete-hostname-regexp).
      const img = html.slice(html.indexOf('<img '));
      expect(img.startsWith(`<img src="${CMS}/uploads/`)).toBe(true);
      expect(img).toContain('" alt=""');
      expect(page.media[ids.cover!]?.url).toMatch(/^https:\/\/cms\.example\.com\/uploads\//);
      expect(page.blocks[1]!.posts!.map((p) => p.slug)).toEqual(['second', 'hello']);
      expect(page.seo).toMatchObject({
        title: 'about en',
        canonical: `${FRONTEND}/en/about`,
        robots: 'index, follow',
        hreflang: [
          { hreflang: 'en', href: `${FRONTEND}/en/about` },
          { hreflang: 'x-default', href: `${FRONTEND}/en/about` },
        ],
      });
      // OG image falls back to the first image of the page.
      expect(page.seo.og.image?.url).toMatch(/^https:\/\/cms\.example\.com\/uploads\//);
      expect(page.seo.jsonLd).toMatchObject({
        '@context': 'https://schema.org',
        '@type': 'WebPage',
        inLanguage: 'en',
      });
      // Draft in Chinese: 404, no fallback to English.
      expect(await errorOf('/pages/guanyu?locale=zh-CN')).toEqual({
        status: 404,
        code: 'not_found',
      });
      expect(await errorOf('/pages/about?locale=zh-CN')).toEqual({
        status: 404,
        code: 'not_found',
      });
      expect((await get('/pages/start?locale=zh-CN', pageSchema)).path).toBe('/zh-cn');
    });

    it('lists published posts with filters and serves a post with its seo', async () => {
      const list = await get('/posts', postListSchema);
      expect(list.items.map((p) => p.slug)).toEqual(['second', 'hello']);
      expect(list).toMatchObject({ page: 1, pageSize: 20, total: 2 });
      expect((await get('/posts?tag=tips', postListSchema)).items.map((p) => p.slug)).toEqual([
        'hello',
      ]);
      expect(
        (await get('/posts?author=alex&pageSize=1&page=2', postListSchema)).items.map(
          (p) => p.slug,
        ),
      ).toEqual(['hello']);
      expect((await get('/posts?category=nothing', postListSchema)).total).toBe(0);
      expect((await get('/posts?locale=zh-CN', postListSchema)).total).toBe(0);
      const post = await get('/posts/hello', postSchema);
      expect(post).toMatchObject({
        path: '/en/blog/hello',
        bodyHtml: '<p>hello</p>',
        categories: [{ id: ids.general, path: '/en/blog/category/general' }],
        tags: [{ slug: 'tips', path: '/en/blog/tag/tips' }],
        authors: [{ name: 'Alex Example', path: '/en/authors/alex' }],
      });
      // OG falls back to the cover, as its derived OG file when there is one.
      expect(post.seo.og.image?.url).toBe(post.cover!.url);
      expect(post.seo.og.type).toBe('article');
      expect(post.seo.description).toBe('About hello');
      expect(post.seo.jsonLd).toMatchObject({
        '@type': 'BlogPosting',
        headline: 'Post hello',
        datePublished: '2026-11-10T08:00:00.000Z',
        author: [{ '@type': 'Person', name: 'Alex Example', url: `${FRONTEND}/en/authors/alex` }],
      });
      expect(await errorOf('/posts/unfinished')).toEqual({ status: 404, code: 'not_found' });
    });

    it('lists categories, tags and public authors', async () => {
      const categories = await get('/post-categories', termListSchema);
      expect(categories.items.map((c) => c.slug)).toEqual(['general']);
      expect(categories.items[0]!.seo.jsonLd['@type']).toBe('CollectionPage');
      expect((await get('/tags?slug=tips', termListSchema)).items).toHaveLength(1);
      expect((await get('/tags?locale=zh-CN', termListSchema)).items).toHaveLength(0);
      const authors = await get('/authors', authorListSchema);
      expect(authors.items.map((a) => a.slug)).toEqual(['alex']);
      const author = await get('/authors/alex?locale=zh-CN', authorSchema);
      expect(author).toMatchObject({ name: '示例作者', path: '/zh-cn/authors/alex' });
      expect(author.seo.og.type).toBe('profile');
      await db
        .update(schema.authors)
        .set({ publicPage: false })
        .where(eq(schema.authors.id, ids.alex!));
      expect(await errorOf('/authors/alex')).toEqual({ status: 404, code: 'not_found' });
      expect((await get('/posts/hello', postSchema)).authors[0]!.path).toBeNull();
      await db
        .update(schema.authors)
        .set({ publicPage: true })
        .where(eq(schema.authors.id, ids.alex!));
    });

    it('resolves frontend paths', async () => {
      expect(await get('/routes/resolve?path=/en/blog/hello', resolutionSchema)).toEqual({
        status: 200,
        type: 'post',
        route: 'post',
        id: ids.hello,
        locale: 'en',
        slug: 'hello',
        path: '/en/blog/hello',
        alternates: { en: '/en/blog/hello' },
      });
      expect(await get('/routes/resolve?path=/', resolutionSchema)).toEqual({
        status: 301,
        location: '/en',
      });
      expect(await get('/routes/resolve?path=/en/nothing', resolutionSchema)).toEqual({
        status: 404,
      });
      expect(await errorOf('/routes/resolve')).toEqual({ status: 400, code: 'invalid_query' });
    });

    it('serves the JSON Schemas of the offered blocks', async () => {
      const schemas = await get('/schema/blocks', blockSchemasSchema);
      expect(Object.keys(schemas.blocks)).toContain('rich-text');
      expect(Object.keys(schemas.blocks)).not.toContain('catalog-list');
      expect(schemas.richText).toMatchObject({ type: 'object' });
    });
  });

  describe('preview', () => {
    it('needs a preview secret, a valid signature and an unexpired token', async () => {
      const draft = { type: 'post' as const, id: ids.draft!, locale: 'en' };
      expect(await errorOf('/preview/abc')).toEqual({ status: 404, code: 'preview_unavailable' });
      const secret = await rotatePreviewSecret(db, KEY, actor);
      expect(secret).toMatch(/^bpxp_/);
      const { token: link } = createPreviewToken(secret, draft);
      const preview = await call(`/preview/${link}`);
      expect(preview.status).toBe(200);
      expect(preview.response.headers.get('cache-control')).toBe('no-store');
      expect(preview.response.headers.get('x-robots-tag')).toBe('noindex, nofollow');
      const body = described(previewSchema, preview.body);
      expect(body).toMatchObject({ type: 'post', status: 'draft', post: { slug: 'unfinished' } });
      if (body.type === 'post') expect(body.post.seo.robots).toBe('noindex, nofollow');
      // The Delivery Token is required too.
      expect((await call(`/preview/${link}`, { token: null })).status).toBe(401);
      // Tampered, signed with another secret, expired.
      expect(await errorOf(`/preview/${link}x`)).toEqual({ status: 403, code: 'preview_invalid' });
      expect(await errorOf(`/preview/${createPreviewToken('bpxp_other', draft).token}`)).toEqual({
        status: 403,
        code: 'preview_invalid',
      });
      const old = createPreviewToken(secret, draft, new Date(Date.now() - 2 * 3600_000)).token;
      expect(await errorOf(`/preview/${old}`)).toEqual({ status: 403, code: 'preview_expired' });
      // A page in draft.
      const page = createPreviewToken(secret, {
        type: 'page',
        id: ids.about!,
        locale: 'zh-CN',
      }).token;
      expect(described(previewSchema, (await call(`/preview/${page}`)).body)).toMatchObject({
        type: 'page',
        status: 'draft',
        page: { path: '/zh-cn/guanyu' },
      });
      // Rotating the secret ends the old links.
      await rotatePreviewSecret(db, KEY, actor);
      expect(await errorOf(`/preview/${link}`)).toEqual({ status: 403, code: 'preview_invalid' });
      expect((await listAudit(db, { limit: 5 })).map((a) => a.action)).toContain(
        'api.preview_secret_rotate',
      );
    });
  });

  describe('frontend and OpenAPI', () => {
    it('changes the frontend base URL with an audit entry and uses it for canonicals', async () => {
      await expect(saveFrontendBaseUrl(db, 'ftp://x', actor)).rejects.toBeInstanceOf(
        InvalidInputError,
      );
      await saveFrontendBaseUrl(db, 'https://new.example.com/', actor);
      expect((await get('/posts/hello', postSchema)).seo.canonical).toBe(
        'https://new.example.com/en/blog/hello',
      );
      const [entry] = await listAudit(db, { limit: 1 });
      expect(entry).toMatchObject({
        action: 'api.frontend_update',
        details: { baseUrl: { from: FRONTEND, to: 'https://new.example.com' } },
      });
      await saveFrontendBaseUrl(db, FRONTEND, actor);
    });

    it('describes every operation in an OpenAPI 3.1 document without a token', async () => {
      const { status, body } = await call('/openapi.json', { token: null });
      expect(status).toBe(200);
      expect(body).toMatchObject({
        openapi: '3.1.0',
        info: { title: 'BluePax CMS', version: 'v1' },
      });
      for (const op of OPERATIONS) {
        expect(body.paths[op.path].get.operationId).toBe(op.operationId);
      }
      for (const id of [
        'Site',
        'Page',
        'Post',
        'PostList',
        'Seo',
        'Media',
        'Error',
        'NavItem',
        'Preview',
      ]) {
        expect(body.components.schemas[id], id).toBeTruthy();
      }
      expect(JSON.stringify(openApiDocument())).not.toContain('__schema');
    });
  });
});
