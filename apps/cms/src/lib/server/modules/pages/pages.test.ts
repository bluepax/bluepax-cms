import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { emptyBlockData, type Block } from '@bluepax/cms-blocks';
import {
  createDatabase,
  createPool,
  migrationSets,
  runMigrations,
  schema,
  type Database,
} from '@bluepax/db';
import { freshTestDatabase } from '@bluepax/db/testing';
import { configFromPreset } from '@bluepax/presets';
import { createLocalDriver } from '@bluepax/storage';
import { eq } from 'drizzle-orm';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { listAudit } from '../../audit.ts';
import { activeModules, initializeInstance } from '../../instance.ts';
import { migrationSetNames, registry } from '../../modules.ts';
import { deleteMedia, uploadMedia, usagesOf, type MediaContext } from '../media/library.ts';
import { createNavItem, deleteNavItem, listNav } from '../site/navigation.ts';
import { saveFrontend } from '../site/settings.ts';
import { InvalidInputError } from '../site/values.ts';
import { blockOffer, parseBlocks, sameJson, type BlockOffer } from './blocks.ts';
import { PageError, type PageErrorCode } from './errors.ts';
import {
  canTransition,
  changeStatus,
  createPage,
  createTranslation,
  deletePage,
  deleteTranslation,
  getPage,
  getTranslation,
  listPages,
  pageOptions,
  pagesSetup,
  saveTranslation,
  setHomePage,
  type ContentInput,
} from './pages.ts';

/** The code and fields of a PageError. */
async function failure(run: Promise<unknown>): Promise<{ code: PageErrorCode; fields: string[] }> {
  try {
    await run;
  } catch (error) {
    if (error instanceof PageError) {
      return { code: error.code, fields: error.details.fields ?? [] };
    }
    throw error;
  }
  throw new Error('expected a PageError');
}

const corporate = configFromPreset({
  type: 'corporate',
  name: 'Example Site',
  contentLanguages: ['en', 'ar'],
  primaryLanguage: 'en',
  adminLocale: 'en',
  frontendBaseUrl: 'https://www.example.com',
});

describe('pages module (unit)', () => {
  it('declares content permissions for editors, the content events and its tables', () => {
    const all = registry.order().map((m) => m.id);
    expect(registry.editorPermissions(all)).toEqual(
      expect.arrayContaining(['pages.edit', 'pages.publish', 'pages.delete']),
    );
    expect(registry.get('pages')?.webhookEvents).toEqual([
      'content.published',
      'content.unpublished',
      'content.deleted',
      'content.slug_changed',
    ]);
    // Pages use media; menu items (site) link to pages.
    const sets = migrationSetNames();
    expect(sets.indexOf('media')).toBeLessThan(sets.indexOf('pages'));
    expect(sets.indexOf('pages')).toBeLessThan(sets.indexOf('site'));
  });

  it('offers the configured blocks that an active module provides', () => {
    // catalog and regions are not built yet, so their blocks are never on offer in M1.
    const offer = blockOffer(corporate, registry, registry.resolveEnabled(['catalog', 'regions']));
    expect(offer.blocks).toEqual([
      'hero',
      'text-media',
      'cards',
      'steps',
      'stats',
      'logos',
      'featured-posts',
      'latest-posts',
      'contact-cta',
      'rich-text',
    ]);
    const blog = blockOffer(
      { blocks: { available: ['hero', 'rich-text'] } },
      registry,
      registry.resolveEnabled([]),
    );
    expect(blog.blocks).toEqual(['hero', 'rich-text']);
  });

  it('allows the status changes of chapter 3', () => {
    expect(canTransition('draft', 'submit')).toBe(true);
    expect(canTransition('in_review', 'withdraw')).toBe(true);
    expect(canTransition('in_review', 'publish')).toBe(true);
    expect(canTransition('published', 'unpublish')).toBe(true);
    expect(canTransition('unpublished', 'publish')).toBe(true);
    expect(canTransition('published', 'publish')).toBe(false);
    expect(canTransition('published', 'submit')).toBe(false);
    expect(canTransition('draft', 'unpublish')).toBe(false);
  });

  it('compares JSON regardless of key order', () => {
    expect(sameJson({ a: 1, b: [1, { c: 2 }] }, { b: [1, { c: 2 }], a: 1 })).toBe(true);
    expect(sameJson({ a: 1 }, { a: 1, b: undefined })).toBe(false);
    expect(sameJson([1, 2], [2, 1])).toBe(false);
    expect(sameJson(null, {})).toBe(false);
  });

  describe('parseBlocks', () => {
    const offer: BlockOffer = {
      blocks: ['hero', 'rich-text', 'contact-cta'],
      modules: new Set(['pages', 'media']),
    };
    const id = '11111111-1111-4111-8111-111111111111';

    it('keeps the IDs of stored blocks and gives new blocks a fresh one', () => {
      const stored = new Map([[id, { type: 'hero', data: emptyBlockData('hero') }]]);
      const blocks = parseBlocks(
        [
          { id, type: 'hero', data: { title: 'Welcome' } },
          { id, type: 'rich-text', data: {} },
          { type: 'rich-text', data: {} },
        ],
        offer,
        stored,
      );
      expect(blocks.map((b) => b.id)[0]).toBe(id);
      expect(new Set(blocks.map((b) => b.id)).size).toBe(3);
      expect(blocks[0]).toMatchObject({ type: 'hero', data: { title: 'Welcome', buttons: [] } });
    });

    it('names the failing fields by their form path', () => {
      try {
        parseBlocks(
          [
            { type: 'hero', data: { buttons: [{ label: 'Go', url: 'javascript:alert(1)' }] } },
            { type: 'shop', data: {} },
          ],
          offer,
          new Map(),
        );
        expect.unreachable();
      } catch (error) {
        expect(error).toBeInstanceOf(PageError);
        expect((error as PageError).details.fields).toEqual([
          'blocks.0.data.buttons.0.url',
          'blocks.1.type',
        ]);
      }
    });

    it('refuses blocks that are not on offer unless they are kept unchanged', () => {
      const stored = new Map([[id, { type: 'stats', data: { items: [{ value: '24/7' }] } }]]);
      const kept = parseBlocks(
        [{ id, type: 'stats', data: { items: [{ value: '24/7', unit: '', label: '' }] } }],
        offer,
        stored,
      );
      expect(kept[0]?.id).toBe(id);
      expect(() =>
        parseBlocks([{ id, type: 'stats', data: { items: [{ value: '25' }] } }], offer, stored),
      ).toThrow(expect.objectContaining({ code: 'block_unavailable' }));
      expect(() => parseBlocks([{ type: 'logos', data: {} }], offer, new Map())).toThrow(
        expect.objectContaining({ code: 'block_unavailable' }),
      );
    });

    it('keeps features of inactive modules off', () => {
      expect(() =>
        parseBlocks([{ type: 'contact-cta', data: { showForm: true } }], offer, new Map()),
      ).toThrow(expect.objectContaining({ details: { fields: ['blocks.0.data.showForm'] } }));
      expect(() =>
        parseBlocks(
          [{ type: 'hero', data: { selector: { catalogType: 'products' } } }],
          offer,
          new Map(),
        ),
      ).toThrow(expect.objectContaining({ details: { fields: ['blocks.0.data.selector'] } }));
      // A value it already had stays.
      const stored = new Map([
        [id, { type: 'contact-cta', data: { ...emptyBlockData('contact-cta'), showForm: true } }],
      ]);
      expect(
        parseBlocks([{ id, type: 'contact-cta', data: { showForm: true } }], offer, stored)[0],
      ).toMatchObject({ data: { showForm: true } });
      const withInquiries = { ...offer, modules: new Set(['inquiries']) };
      expect(
        parseBlocks([{ type: 'contact-cta', data: { showForm: true } }], withInquiries, new Map()),
      ).toHaveLength(1);
    });
  });
});

// Integration tests: need a PostgreSQL server (TEST_DATABASE_URL).
const baseUrl = process.env.TEST_DATABASE_URL;
const migrations = fileURLToPath(
  new URL('../../../../../../../packages/db/migrations', import.meta.url),
);

describe.skipIf(!baseUrl)('pages module', { timeout: 30_000 }, () => {
  let pool: ReturnType<typeof createPool>;
  let db: Database;
  let root: string;
  let ctx: MediaContext;
  let actor: { id: string; ip: string };
  let offer: BlockOffer;
  let imageId: string;
  let pdfId: string;

  const content = (patch: Partial<ContentInput> = {}): ContentInput => ({
    title: 'About us',
    slug: 'about',
    seo: {},
    blocks: [],
    ...patch,
  });

  async function lastAudit() {
    const [entry] = await listAudit(db, { limit: 1 });
    return entry!;
  }

  beforeAll(async () => {
    pool = createPool(await freshTestDatabase(baseUrl!, 'pages'), 4);
    await runMigrations(pool, migrationSets(migrations, migrationSetNames()));
    db = createDatabase(pool);
    const { adminId } = await initializeInstance(db, corporate, {
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
    root = await mkdtemp(join(tmpdir(), 'bluepax-pages-'));
    ctx = { db, storage: createLocalDriver({ root, publicBaseUrl: '/uploads' }) };
    offer = (await pagesSetup(db, registry, await activeModules(db, registry))).offer;
    const png = await sharp({
      create: { width: 640, height: 400, channels: 3, background: { r: 20, g: 120, b: 90 } },
    })
      .png()
      .toBuffer();
    const limits = { image: 20, document: 50, video: 200 };
    imageId = (await uploadMedia(ctx, { name: 'team.png', data: png }, null, limits, actor)).id;
    const pdf = Buffer.from(
      '%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\ntrailer << >>\n%%EOF\n',
    );
    pdfId = (await uploadMedia(ctx, { name: 'brochure.pdf', data: pdf }, null, limits, actor)).id;
  });

  afterAll(async () => {
    await pool?.end();
    if (root) await rm(root, { recursive: true, force: true });
  });

  it('gives the default editor role the page permissions', async () => {
    const rows = await db
      .select({ permission: schema.rolePermissions.permission, key: schema.roles.key })
      .from(schema.rolePermissions)
      .innerJoin(schema.roles, eq(schema.roles.id, schema.rolePermissions.roleId));
    const editor = rows.filter((r) => r.key === 'editor').map((r) => r.permission);
    expect(editor).toEqual(expect.arrayContaining(['pages.edit', 'pages.publish', 'pages.delete']));
  });

  it('creates a page as a draft and checks its slug', async () => {
    const id = await createPage(ctx, { locale: 'en', title: 'About us', slug: 'about' }, actor);
    expect(await getPage(db, id)).toMatchObject({
      isHome: false,
      translations: [{ locale: 'en', status: 'draft', title: 'About us', slug: 'about' }],
    });
    expect((await lastAudit()).action).toBe('pages.create');

    const make = (slug: string, locale = 'en') =>
      createPage(ctx, { locale, title: 'Other', slug }, actor);
    expect(await failure(make('About'))).toEqual({ code: 'invalid', fields: ['slug'] });
    expect(await failure(make('über'))).toEqual({ code: 'invalid', fields: ['slug'] });
    expect(await failure(make('a--b'))).toEqual({ code: 'invalid', fields: ['slug'] });
    // Fixed segments of the route templates are reserved.
    expect((await failure(make('blog'))).code).toBe('slug_reserved');
    expect((await failure(make('authors'))).code).toBe('slug_reserved');
    // Unique per language (409), but another language may use it.
    expect((await failure(make('about'))).code).toBe('slug_taken');
    expect(await make('about', 'ar')).toBeTruthy();
    expect(await failure(make('fine', 'fr'))).toEqual({ code: 'invalid', fields: ['locale'] });
    expect(
      await failure(createPage(ctx, { locale: 'en', title: ' ', slug: 'blank' }, actor)),
    ).toEqual({ code: 'invalid', fields: ['title'] });
  });

  it('refuses reserved slugs that a page uses, and pages with reserved slugs', async () => {
    await createPage(ctx, { locale: 'en', title: 'Shop', slug: 'shop' }, actor);
    try {
      await saveFrontend(db, { reservedSlugs: ['shop', 'events'] }, actor);
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(InvalidInputError);
      expect((error as InvalidInputError).reason).toBe('slug_in_use');
      expect((error as InvalidInputError).details).toMatchObject({
        pages: [{ locale: 'en', slug: 'shop', title: 'Shop' }],
      });
    }
    await saveFrontend(db, { reservedSlugs: ['events', 'events'] }, actor);
    expect(
      (await failure(createPage(ctx, { locale: 'en', title: 'Events', slug: 'events' }, actor)))
        .code,
    ).toBe('slug_reserved');
    await saveFrontend(db, { reservedSlugs: [] }, actor);
  });

  it('saves blocks and SEO fields and records the media they use', async () => {
    const id = await createPage(ctx, { locale: 'en', title: 'Services', slug: 'services' }, actor);
    const before = await getTranslation(db, id, 'en');
    const result = await saveTranslation(
      ctx,
      id,
      'en',
      content({
        title: 'Our services',
        slug: 'services',
        seo: { metaTitle: 'Services', ogImage: imageId, keywords: ['a', 'a', 'b'] },
        blocks: [
          { type: 'hero', data: { title: 'Hello', background: imageId } },
          {
            type: 'rich-text',
            data: {
              title: 'Details',
              body: {
                type: 'doc',
                content: [
                  {
                    type: 'heading',
                    attrs: { level: 2, textAlign: 'left' },
                    content: [{ type: 'text', text: 'Why' }],
                  },
                  { type: 'image', attrs: { mediaId: imageId, src: '/x.png' } },
                ],
              },
            },
          },
        ],
      }),
      actor,
      { offer, version: before.updatedAt.toISOString() },
    );
    expect(result).toEqual({ slugChanged: false, status: 'draft' });
    const saved = await getTranslation(db, id, 'en');
    expect(saved.title).toBe('Our services');
    expect(saved.seo).toMatchObject({
      metaTitle: 'Services',
      ogImage: imageId,
      keywords: ['a', 'b'],
    });
    expect(saved.blocks.map((b) => b.type)).toEqual(['hero', 'rich-text']);
    // Editor-only attributes are dropped.
    expect((saved.blocks[1] as Extract<Block, { type: 'rich-text' }>).data.body.content).toEqual([
      { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Why' }] },
      { type: 'image', attrs: { mediaId: imageId } },
    ]);
    const usages = await usagesOf(db, imageId);
    expect(usages.filter((u) => u.module === 'pages')).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: 'seo.ogImage', locale: 'en', purpose: 'og' }),
        expect.objectContaining({
          field: `blocks.${saved.blocks[0]!.id}.background`,
          locale: 'en',
          purpose: 'default',
        }),
        expect.objectContaining({ field: `blocks.${saved.blocks[1]!.id}.body`, locale: 'en' }),
      ]),
    );
    // The OG image was derived for the share image.
    const og = await db
      .select({ variant: schema.mediaObjects.variant })
      .from(schema.mediaObjects)
      .where(eq(schema.mediaObjects.mediaId, imageId));
    expect(og.map((o) => o.variant)).toContain('og');
    // A used image cannot be deleted.
    await expect(deleteMedia(ctx, imageId, actor)).rejects.toMatchObject({ code: 'in_use' });

    // A stale editor is refused instead of overwriting (409).
    expect(
      (
        await failure(
          saveTranslation(ctx, id, 'en', content({ slug: 'services' }), actor, {
            offer,
            version: before.updatedAt.toISOString(),
          }),
        )
      ).code,
    ).toBe('edit_conflict');

    // A PDF is no image; the failing field is named by its form path.
    expect(
      await failure(
        saveTranslation(
          ctx,
          id,
          'en',
          content({ slug: 'services', blocks: [{ type: 'text-media', data: { image: pdfId } }] }),
          actor,
          { offer },
        ),
      ),
    ).toEqual({ code: 'media', fields: ['blocks.0.data.image'] });

    // Removing the image removes its usages.
    await saveTranslation(ctx, id, 'en', content({ slug: 'services' }), actor, { offer });
    expect((await usagesOf(db, imageId)).filter((u) => u.module === 'pages')).toEqual([]);
  });

  it('records slug changes and reports invalid fields together', async () => {
    const id = await createPage(ctx, { locale: 'en', title: 'Team', slug: 'team' }, actor);
    const result = await saveTranslation(
      ctx,
      id,
      'en',
      content({ title: 'Team', slug: 'people' }),
      actor,
      { offer },
    );
    expect(result.slugChanged).toBe(true);
    expect(await lastAudit()).toMatchObject({
      action: 'pages.slug_change',
      details: { locale: 'en', from: 'team', to: 'people', published: false },
    });
    expect(
      await failure(
        saveTranslation(
          ctx,
          id,
          'en',
          content({ title: '', slug: 'No', seo: { canonical: 'ftp://x' } }),
          actor,
          { offer },
        ),
      ),
    ).toEqual({ code: 'invalid', fields: ['title', 'seo.canonical', 'slug'] });
    expect(
      (
        await failure(
          saveTranslation(ctx, id, 'en', content({ title: 'Team', slug: 'about' }), actor, {
            offer,
          }),
        )
      ).code,
    ).toBe('slug_taken');
  });

  it('manages the status per language and writes the publishing times', async () => {
    const id = await createPage(ctx, { locale: 'en', title: 'Careers', slug: 'careers' }, actor);
    await createTranslation(ctx, id, { locale: 'ar', title: 'وظائف', slug: 'careers' }, actor);
    expect(await changeStatus(db, id, 'en', 'submit', actor)).toBe('in_review');
    expect((await failure(changeStatus(db, id, 'en', 'unpublish', actor))).code).toBe(
      'invalid_status',
    );
    expect(await changeStatus(db, id, 'en', 'publish', actor)).toBe('published');
    const published = await getTranslation(db, id, 'en');
    expect(published.publishedAt).toBeInstanceOf(Date);
    expect(await lastAudit()).toMatchObject({
      action: 'pages.publish',
      details: { locale: 'en', from: 'in_review', to: 'published' },
    });
    // Arabic is still a draft.
    expect((await getTranslation(db, id, 'ar')).status).toBe('draft');
    expect(await changeStatus(db, id, 'en', 'unpublish', actor)).toBe('unpublished');
    expect((await getTranslation(db, id, 'en')).unpublishedAt).toBeInstanceOf(Date);

    // Save and publish in one step.
    const saved = await saveTranslation(
      ctx,
      id,
      'ar',
      content({ title: 'وظائف', slug: 'careers' }),
      actor,
      { offer, status: 'publish' },
    );
    expect(saved.status).toBe('published');

    const list = await listPages(db, { locale: 'en', status: 'unpublished' });
    expect(list.items.map((i) => i.id)).toContain(id);
    expect(list.items.find((i) => i.id === id)?.languages).toEqual([
      { locale: 'ar', status: 'published' },
      { locale: 'en', status: 'unpublished' },
    ]);
    expect((await listPages(db, { locale: 'ar', query: 'careers' })).items).toHaveLength(1);
  });

  it('copies blocks into a new language and lists pages missing a language', async () => {
    const id = await createPage(ctx, { locale: 'en', title: 'Contact', slug: 'contact' }, actor);
    await saveTranslation(
      ctx,
      id,
      'en',
      content({
        title: 'Contact',
        slug: 'contact',
        blocks: [{ type: 'cards', data: { cards: [{ title: 'Mail', icon: imageId }] } }],
      }),
      actor,
      { offer },
    );
    const missing = await listPages(db, { locale: 'ar', status: 'missing', query: 'contact' });
    expect(missing.items).toEqual([
      expect.objectContaining({ id, locale: null, title: 'Contact' }),
    ]);
    expect(missing.total).toBe(1);

    await createTranslation(
      ctx,
      id,
      { locale: 'ar', title: 'اتصل بنا', slug: 'contact', copyFrom: 'en' },
      actor,
    );
    const [en, ar] = [await getTranslation(db, id, 'en'), await getTranslation(db, id, 'ar')];
    expect(ar.blocks.map((b) => b.type)).toEqual(['cards']);
    expect(ar.blocks[0]!.id).not.toBe(en.blocks[0]!.id);
    expect(
      (await usagesOf(db, imageId)).filter((u) => u.module === 'pages').map((u) => u.locale),
    ).toEqual(expect.arrayContaining(['en', 'ar']));
    expect(
      (await failure(createTranslation(ctx, id, { locale: 'ar', title: 'x', slug: 'x' }, actor)))
        .code,
    ).toBe('translation_exists');

    // Deleting a language removes its usages; the last language cannot be deleted.
    await deleteTranslation(db, id, 'ar', actor);
    expect(
      (await usagesOf(db, imageId)).filter((u) => u.module === 'pages').map((u) => u.locale),
    ).toEqual(['en']);
    expect((await failure(deleteTranslation(db, id, 'en', actor))).code).toBe('last_translation');
  });

  it('keeps one home page and protects it and linked pages from deletion', async () => {
    const first = await createPage(ctx, { locale: 'en', title: 'Home', slug: 'home' }, actor);
    const second = await createPage(ctx, { locale: 'en', title: 'Start', slug: 'start' }, actor);
    await setHomePage(db, first, actor);
    await setHomePage(db, second, actor);
    expect((await getPage(db, first)).isHome).toBe(false);
    expect((await getPage(db, second)).isHome).toBe(true);
    expect(await lastAudit()).toMatchObject({ action: 'pages.home', details: { previous: first } });
    expect((await failure(deletePage(db, second, actor))).code).toBe('home_page');

    // A menu item links to the page.
    const item = await createNavItem(
      db,
      'header',
      {
        parentId: null,
        label: { en: 'Home' },
        url: '',
        pageId: first,
        newTab: false,
        sortOrder: 0,
      },
      actor,
    );
    expect((await listNav(db, 'header')).find((n) => n.id === item)?.pageId).toBe(first);
    expect(await failure(deletePage(db, first, actor))).toMatchObject({ code: 'in_navigation' });
    await expect(
      createNavItem(
        db,
        'header',
        {
          parentId: null,
          label: { en: 'Both' },
          url: '/en/x',
          pageId: first,
          newTab: false,
          sortOrder: 0,
        },
        actor,
      ),
    ).rejects.toMatchObject({ fields: ['url'] });
    await expect(
      createNavItem(
        db,
        'header',
        {
          parentId: null,
          label: { en: 'Gone' },
          url: '',
          pageId: '00000000-0000-4000-8000-000000000009',
          newTab: false,
          sortOrder: 0,
        },
        actor,
      ),
    ).rejects.toMatchObject({ fields: ['pageId'] });
    expect((await pageOptions(db)).find((p) => p.id === first)?.titles).toEqual({ en: 'Home' });

    await deleteNavItem(db, item, actor);
    await deletePage(db, first, actor);
    expect((await failure(getPage(db, first))).code).toBe('not_found');
    expect(await lastAudit()).toMatchObject({
      action: 'pages.delete',
      details: { versions: [{ locale: 'en', slug: 'home', status: 'draft' }] },
    });
  });
});
