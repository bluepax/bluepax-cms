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
  type Database,
} from '@bluepax/db';
import { freshTestDatabase } from '@bluepax/db/testing';
import { configFromPreset } from '@bluepax/presets';
import { createLocalDriver } from '@bluepax/storage';
import { eq } from 'drizzle-orm';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { listAudit } from '../../audit.ts';
import { activeModules, exportInstanceConfig, initializeInstance } from '../../instance.ts';
import { migrationSetNames, registry } from '../../modules.ts';
import { uploadMedia, usagesOf, type MediaContext } from '../media/library.ts';
import { createPage, getTranslation, pagesSetup, saveTranslation } from '../pages/pages.ts';
import { createNavItem, deleteNavItem } from '../site/navigation.ts';
import { readSiteData, saveFrontend, saveGeneral, saveLanguages } from '../site/settings.ts';
import { InvalidInputError } from '../site/values.ts';
import {
  authorOfUser,
  createAuthor,
  deleteAuthor,
  getAuthor,
  saveAuthor,
  type AuthorInput,
} from './authors.ts';
import { PostError, type PostErrorCode } from './errors.ts';
import { postInput } from './forms.ts';
import {
  changePostStatus,
  createPost,
  createPostTranslation,
  deletePost,
  deletePostTranslation,
  getPost,
  getPostTranslation,
  listPosts,
  pickPosts,
  savePost,
  type PostInput,
} from './posts.ts';
import { createTerm, deleteTerm, deleteTermTranslation, getTerm, saveTerm } from './terms.ts';

/** The code, fields and details of a PostError. */
async function failure(run: Promise<unknown>) {
  try {
    await run;
  } catch (error) {
    if (error instanceof PostError) {
      return { code: error.code as PostErrorCode, fields: error.details.fields ?? [], error };
    }
    throw error;
  }
  throw new Error('expected a PostError');
}

const blog = configFromPreset({
  type: 'blog',
  name: 'Example Notes',
  contentLanguages: ['en', 'ar'],
  primaryLanguage: 'en',
  adminLocale: 'en',
  frontendBaseUrl: 'https://blog.example.com',
});

const doc = (text: string, image?: string) => ({
  type: 'doc',
  content: [
    { type: 'paragraph', content: [{ type: 'text', text }] },
    ...(image ? [{ type: 'image', attrs: { mediaId: image } }] : []),
  ],
});

describe('posts module (unit)', () => {
  it('declares content permissions for editors, the content events and its tables', () => {
    const all = registry.order().map((m) => m.id);
    expect(registry.editorPermissions(all)).toEqual(
      expect.arrayContaining([
        'posts.edit',
        'posts.publish',
        'posts.delete',
        'posts.taxonomy',
        'posts.authors',
      ]),
    );
    expect(registry.get('posts')?.webhookEvents).toEqual([
      'content.published',
      'content.unpublished',
      'content.deleted',
      'content.slug_changed',
    ]);
    // Posts use media; menu items and the Person publisher (site) point at posts.
    const sets = migrationSetNames();
    expect(sets.indexOf('media')).toBeLessThan(sets.indexOf('posts'));
    expect(sets.indexOf('posts')).toBeLessThan(sets.indexOf('site'));
  });

  it('reads the publication date and the shared fields only when the form has them', () => {
    const form = new FormData();
    form.set('title', ' Hello ');
    form.set('keyTakeaways', 'One\n\n Two \n');
    form.set('body', JSON.stringify(doc('Hi')));
    expect(postInput(form)).toMatchObject({ title: 'Hello', keyTakeaways: ['One', 'Two'] });
    expect(postInput(form)).not.toHaveProperty('publishedAt');
    expect(postInput(form)).not.toHaveProperty('shared');
    form.set('publishedAt', '');
    form.set('shared', JSON.stringify({ cover: null }));
    expect(postInput(form)).toMatchObject({ publishedAt: null, shared: { cover: null } });
    form.set('shared', '{');
    expect(() => postInput(form)).toThrow(PostError);
  });
});

// Integration tests: need a PostgreSQL server (TEST_DATABASE_URL).
const baseUrl = process.env.TEST_DATABASE_URL;
const migrations = fileURLToPath(
  new URL('../../../../../../../packages/db/migrations', import.meta.url),
);

describe.skipIf(!baseUrl)('posts module', { timeout: 30_000 }, () => {
  let pool: ReturnType<typeof createPool>;
  let db: Database;
  let root: string;
  let ctx: MediaContext;
  let actor: { id: string; ip: string };
  let imageId: string;
  let otherImageId: string;
  let pdfId: string;

  const content = (patch: Partial<PostInput> = {}): PostInput => ({
    title: 'Hello world',
    slug: 'hello-world',
    excerpt: '',
    body: doc('First words'),
    keyTakeaways: [],
    seo: {},
    ...patch,
  });
  const author = (patch: Partial<AuthorInput> = {}): AuthorInput => ({
    name: 'Alex Example',
    slug: 'alex',
    jobTitle: '',
    bio: '',
    seo: {},
    avatar: null,
    sameAs: [],
    publicPage: true,
    userId: null,
    ...patch,
  });
  const version = (date: Date) => date.toISOString();

  async function lastAudit() {
    const [entry] = await listAudit(db, { limit: 1 });
    return entry!;
  }

  beforeAll(async () => {
    pool = createPool(await freshTestDatabase(baseUrl!, 'posts'), 4);
    await runMigrations(pool, migrationSets(migrations, migrationSetNames()));
    db = createDatabase(pool);
    const { adminId } = await initializeInstance(db, blog, {
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
    root = await mkdtemp(join(tmpdir(), 'bluepax-posts-'));
    ctx = { db, storage: createLocalDriver({ root, publicBaseUrl: '/uploads' }) };
    const image = (r: number) =>
      sharp({ create: { width: 640, height: 400, channels: 3, background: { r, g: 120, b: 90 } } })
        .png()
        .toBuffer();
    const limits = { image: 20, document: 50, video: 200 };
    imageId = (
      await uploadMedia(ctx, { name: 'a.png', data: await image(20) }, null, limits, actor)
    ).id;
    otherImageId = (
      await uploadMedia(ctx, { name: 'b.png', data: await image(200) }, null, limits, actor)
    ).id;
    const pdf = Buffer.from(
      '%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\ntrailer << >>\n%%EOF\n',
    );
    pdfId = (await uploadMedia(ctx, { name: 'a.pdf', data: pdf }, null, limits, actor)).id;
  });

  afterAll(async () => {
    await pool?.end();
    if (root) await rm(root, { recursive: true, force: true });
  });

  it('gives the default editor role the posts permissions and seeds the default category', async () => {
    const rows = await db
      .select({ permission: schema.rolePermissions.permission, key: schema.roles.key })
      .from(schema.rolePermissions)
      .innerJoin(schema.roles, eq(schema.roles.id, schema.rolePermissions.roleId));
    const editor = rows.filter((r) => r.key === 'editor').map((r) => r.permission);
    expect(editor).toEqual(
      expect.arrayContaining(['posts.edit', 'posts.publish', 'posts.delete', 'posts.taxonomy']),
    );
    expect((await exportInstanceConfig(db)).posts.categories).toEqual([
      { name: { en: 'General' }, slug: { en: 'general' } },
    ]);
  });

  it('manages categories per language, with order, conflicts and the configuration export', async () => {
    const id = await createTerm(
      db,
      'category',
      { locale: 'en', name: 'Guides', slug: 'guides' },
      actor,
    );
    expect(await lastAudit()).toMatchObject({ action: 'posts.category_create' });
    // Reserved slugs do not apply to categories: they live under /blog/category/.
    const blogCategory = await createTerm(
      db,
      'category',
      { locale: 'en', name: 'Blog', slug: 'blog' },
      actor,
    );
    expect(
      (
        await failure(
          createTerm(db, 'category', { locale: 'en', name: 'X', slug: 'guides' }, actor),
        )
      ).code,
    ).toBe('slug_taken');
    expect(
      await failure(createTerm(db, 'category', { locale: 'en', name: '', slug: 'Bad' }, actor)),
    ).toMatchObject({ code: 'invalid', fields: ['name'] });
    expect(
      (await failure(createTerm(db, 'category', { locale: 'fr', name: 'X', slug: 'x' }, actor)))
        .fields,
    ).toEqual(['locale']);
    // Another kind may use the same slug.
    await createTerm(db, 'tag', { locale: 'en', name: 'Guides', slug: 'guides' }, actor);

    // Adding the Arabic version: saving a language without a version creates it.
    const term = await getTerm(db, 'category', id);
    const arabic = { name: 'أدلة', slug: 'adilla', description: 'دليل', seo: {}, sortOrder: -5 };
    expect(
      await saveTerm(ctx, 'category', id, 'ar', arabic, actor, {
        version: version(term.updatedAt),
      }),
    ).toEqual({ created: true });
    // The editor that opened it before that save gets a conflict.
    expect(
      (
        await failure(
          saveTerm(
            ctx,
            'category',
            id,
            'en',
            { ...arabic, name: 'Guides', slug: 'guides' },
            actor,
            {
              version: version(term.updatedAt),
            },
          ),
        )
      ).code,
    ).toBe('edit_conflict');
    const saved = await getTerm(db, 'category', id);
    expect(saved).toMatchObject({ sortOrder: -5, posts: 0 });
    expect(saved.translations.map((t) => [t.locale, t.slug])).toEqual([
      ['ar', 'adilla'],
      ['en', 'guides'],
    ]);
    // The OG image of a category is a media usage of its language, with purpose `og`.
    await saveTerm(
      ctx,
      'category',
      id,
      'en',
      { name: 'Guides', slug: 'how-to', description: '', seo: { ogImage: imageId } },
      actor,
    );
    expect(await lastAudit()).toMatchObject({
      action: 'posts.category_slug_change',
      details: { locale: 'en', from: 'guides', to: 'how-to' },
    });
    expect((await usagesOf(db, imageId)).find((u) => u.targetId === id)).toMatchObject({
      module: 'posts',
      targetType: 'category',
      field: 'seo.ogImage',
      locale: 'en',
      purpose: 'og',
    });

    // The export lists the categories in order (sort -5 first), for the content languages.
    expect((await exportInstanceConfig(db)).posts.categories).toEqual([
      { name: { en: 'Guides', ar: 'أدلة' }, slug: { en: 'how-to', ar: 'adilla' } },
      { name: { en: 'General' }, slug: { en: 'general' } },
      { name: { en: 'Blog' }, slug: { en: 'blog' } },
    ]);

    await deleteTermTranslation(db, 'category', id, 'ar', actor);
    expect((await failure(deleteTermTranslation(db, 'category', id, 'en', actor))).code).toBe(
      'last_translation',
    );
    await deleteTerm(db, 'category', blogCategory, actor);
    expect((await failure(getTerm(db, 'category', blogCategory))).code).toBe('not_found');
  });

  it('manages authors with shared fields, linked accounts and the main author', async () => {
    const id = await createAuthor(
      db,
      { locale: 'en', name: 'Owner Example', slug: 'owner', userId: actor.id },
      actor,
    );
    expect(await authorOfUser(db, actor.id)).toBe(id);
    expect(
      (
        await failure(
          createAuthor(db, { locale: 'en', name: 'Twin', slug: 'twin', userId: actor.id }, actor),
        )
      ).code,
    ).toBe('account_taken');
    expect(
      (await failure(createAuthor(db, { locale: 'en', name: 'Dup', slug: 'owner' }, actor))).code,
    ).toBe('slug_taken');

    const current = await getAuthor(db, id);
    expect(
      await failure(
        saveAuthor(
          ctx,
          id,
          'en',
          author({ sameAs: ['javascript:alert(1)'], avatar: pdfId }),
          actor,
        ),
      ),
    ).toMatchObject({ code: 'invalid', fields: ['sameAs'] });
    expect(
      (await failure(saveAuthor(ctx, id, 'en', author({ avatar: pdfId }), actor))).fields,
    ).toEqual(['avatar']);
    await saveAuthor(
      ctx,
      id,
      'ar',
      author({
        name: 'المالك',
        slug: 'owner',
        jobTitle: 'محرر',
        avatar: imageId,
        sameAs: ['https://social.example.com/owner', 'https://social.example.com/owner'],
        publicPage: false,
        userId: actor.id,
      }),
      actor,
      { version: version(current.updatedAt) },
    );
    const saved = await getAuthor(db, id);
    expect(saved).toMatchObject({
      avatar: imageId,
      sameAs: ['https://social.example.com/owner'],
      publicPage: false,
      userId: actor.id,
    });
    expect(saved.translations.map((t) => [t.locale, t.name, t.jobTitle])).toEqual([
      ['ar', 'المالك', 'محرر'],
      ['en', 'Owner Example', ''],
    ]);
    expect((await usagesOf(db, imageId)).find((u) => u.targetId === id)).toMatchObject({
      targetType: 'author',
      field: 'avatar',
      locale: '',
    });

    // The main author is the Person publisher of the site settings.
    await saveGeneral(
      db,
      {
        type: 'blog',
        name: 'Example Notes',
        timezone: 'UTC',
        publisher: { type: 'person', name: '', sameAs: [] },
        brandTerms: [],
      },
      actor,
      { media: ctx, image: null, authorId: id },
    );
    expect(await readSiteData(db, 'site.publisher')).toEqual({ image: null, authorId: id });
    expect((await getAuthor(db, id)).primary).toBe(true);
    expect((await failure(deleteAuthor(db, id, actor))).code).toBe('primary_author');
    await expect(
      saveGeneral(
        db,
        {
          type: 'blog',
          name: 'Example Notes',
          timezone: 'UTC',
          publisher: { type: 'person', name: '', sameAs: [] },
          brandTerms: [],
        },
        actor,
        { media: ctx, image: null, authorId: '00000000-0000-4000-8000-000000000009' },
      ),
    ).rejects.toMatchObject({ fields: ['publisher.authorId'] });
  });

  it('writes posts per language with shared categories, tags, authors and cover', async () => {
    const [general] = (await exportInstanceConfig(db)).posts.categories;
    expect(general).toBeDefined();
    const categories = await db.select().from(schema.postCategoriesTranslations);
    const generalId = categories.find((c) => c.slug === 'general')!.entityId;
    const guidesId = categories.find((c) => c.slug === 'how-to')!.entityId;
    const tag = await createTerm(db, 'tag', { locale: 'en', name: 'Tips', slug: 'tips' }, actor);
    const owner = (await authorOfUser(db, actor.id))!;
    const guest = await createAuthor(db, { locale: 'en', name: 'Guest', slug: 'guest' }, actor);

    const id = await createPost(
      ctx,
      { locale: 'en', title: 'Hello world', slug: 'hello-world' },
      actor,
    );
    // Credited to the author of the creator's account.
    expect(await getPost(db, id)).toMatchObject({
      authorIds: [owner],
      categoryIds: [],
      cover: null,
    });
    expect(
      (await failure(createPost(ctx, { locale: 'en', title: 'X', slug: 'blog' }, actor))).code,
    ).toBe('slug_reserved');
    expect(
      (await failure(createPost(ctx, { locale: 'en', title: 'X', slug: 'hello-world' }, actor)))
        .code,
    ).toBe('slug_taken');

    const post = await getPost(db, id);
    const opened = await getPostTranslation(db, id, 'en');
    const shared = {
      cover: imageId,
      categoryIds: [guidesId, generalId],
      tagIds: [tag],
      authorIds: [guest, owner],
    };
    await savePost(
      ctx,
      id,
      'en',
      content({
        excerpt: 'A first post.',
        body: doc('Body', otherImageId),
        keyTakeaways: ['One', ' ', 'Two'],
        seo: { ogImage: imageId },
        shared,
      }),
      actor,
      { version: version(opened.updatedAt), sharedVersion: version(post.updatedAt) },
    );
    expect(await getPost(db, id)).toMatchObject(shared);
    expect(await getPostTranslation(db, id, 'en')).toMatchObject({
      excerpt: 'A first post.',
      keyTakeaways: ['One', 'Two'],
      status: 'draft',
      source: 'manual',
      publishedAt: null,
    });
    const usages = (await usagesOf(db, imageId)).filter((u) => u.targetId === id);
    expect(usages.map((u) => [u.field, u.locale, u.purpose]).sort()).toEqual([
      // The cover stands in for missing OG images, so its 1200×630 JPG is derived too.
      ['cover', '', 'og'],
      ['seo.ogImage', 'en', 'og'],
    ]);
    expect((await usagesOf(db, otherImageId)).find((u) => u.targetId === id)).toMatchObject({
      field: 'body',
      locale: 'en',
    });

    // Unknown links and media of the wrong kind fail their fields.
    expect(
      (
        await failure(
          savePost(ctx, id, 'en', content({ shared: { ...shared, categoryIds: [tag] } }), actor),
        )
      ).fields,
    ).toEqual(['categoryIds']);
    expect(
      (
        await failure(
          savePost(ctx, id, 'en', content({ shared: { ...shared, cover: pdfId } }), actor),
        )
      ).fields,
    ).toEqual(['cover']);
    expect(
      (
        await failure(
          savePost(ctx, id, 'en', content({ keyTakeaways: Array(11).fill('x') }), actor),
        )
      ).fields,
    ).toEqual(['keyTakeaways']);
    expect(
      (
        await failure(
          savePost(
            ctx,
            id,
            'en',
            content({ body: { type: 'doc', content: [{ type: 'script' }] } }),
            actor,
          ),
        )
      ).fields,
    ).toEqual(['body']);

    // A stale language version conflicts; so do stale shared fields once they change.
    expect(
      (
        await failure(
          savePost(ctx, id, 'en', content(), actor, { version: version(opened.updatedAt) }),
        )
      ).code,
    ).toBe('edit_conflict');
    const now = await getPostTranslation(db, id, 'en');
    expect(
      (
        await failure(
          savePost(ctx, id, 'en', content({ shared: { ...shared, tagIds: [] } }), actor, {
            version: version(now.updatedAt),
            sharedVersion: version(post.updatedAt),
          }),
        )
      ).code,
    ).toBe('edit_conflict');
    // Unchanged shared fields with an old version, or none at all, are no conflict.
    const english = {
      excerpt: 'A first post.',
      body: doc('Body', otherImageId),
      keyTakeaways: ['One', 'Two'],
      seo: { ogImage: imageId },
    };
    await savePost(ctx, id, 'en', content({ ...english, shared }), actor, {
      version: version(now.updatedAt),
      sharedVersion: version(post.updatedAt),
    });

    // The Arabic version starts from the English content (RTL texts are stored as typed).
    await createPostTranslation(
      ctx,
      id,
      { locale: 'ar', title: 'مرحبا', slug: 'marhaba', copyFrom: 'en' },
      actor,
    );
    expect(await getPostTranslation(db, id, 'ar')).toMatchObject({
      title: 'مرحبا',
      excerpt: 'A first post.',
      keyTakeaways: ['One', 'Two'],
      status: 'draft',
    });
    expect(
      (await usagesOf(db, otherImageId))
        .filter((u) => u.targetId === id)
        .map((u) => u.locale)
        .sort(),
    ).toEqual(['ar', 'en']);

    // Lists by language, status and category.
    expect(
      (await listPosts(db, { locale: 'en', categoryId: guidesId })).items.map((p) => p.id),
    ).toEqual([id]);
    expect((await listPosts(db, { locale: 'en', categoryId: tag })).total).toBe(0);
    expect((await listPosts(db, { locale: 'ar', status: 'draft' })).items[0]).toMatchObject({
      title: 'مرحبا',
      categoryIds: [guidesId, generalId],
      languages: [
        { locale: 'ar', status: 'draft' },
        { locale: 'en', status: 'draft' },
      ],
    });
    expect((await pickPosts(db, { locale: 'ar', ids: [id] }))[0]).toMatchObject({
      title: 'مرحبا',
      locale: 'ar',
      status: 'draft',
    });

    // A category or author with posts cannot be deleted; a tag is removed from its posts.
    expect(await failure(deleteTerm(db, 'category', guidesId, actor))).toMatchObject({
      code: 'has_posts',
    });
    expect((await failure(deleteAuthor(db, guest, actor))).code).toBe('has_posts');
    await deleteTerm(db, 'tag', tag, actor);
    expect((await getPost(db, id)).tagIds).toEqual([]);
  });

  it('publishes per language and keeps the publication date', async () => {
    const id = await createPost(ctx, { locale: 'en', title: 'Dated', slug: 'dated' }, actor);
    expect((await failure(changePostStatus(db, id, 'en', 'unpublish', actor))).code).toBe(
      'invalid_status',
    );
    await changePostStatus(db, id, 'en', 'submit', actor);
    const { status } = await savePost(
      ctx,
      id,
      'en',
      content({ title: 'Dated', slug: 'dated' }),
      actor,
      {
        status: 'publish',
      },
    );
    expect(status).toBe('published');
    const first = await getPostTranslation(db, id, 'en');
    expect(first.publishedAt).not.toBeNull();
    expect(first.modifiedAt).not.toBeNull();
    expect(await lastAudit()).toMatchObject({
      action: 'posts.publish',
      details: { locale: 'en', from: 'in_review', to: 'published' },
    });

    // Saving a live version changes its dateModified, not the publication date.
    await new Promise((r) => setTimeout(r, 20));
    await savePost(ctx, id, 'en', content({ title: 'Dated again', slug: 'dated' }), actor);
    const edited = await getPostTranslation(db, id, 'en');
    expect(edited.publishedAt).toEqual(first.publishedAt);
    expect(edited.modifiedAt!.getTime()).toBeGreaterThan(first.modifiedAt!.getTime());
    // Clearing the date of a published version keeps it; a future date is refused.
    await savePost(
      ctx,
      id,
      'en',
      content({ title: 'Dated again', slug: 'dated', publishedAt: null }),
      actor,
    );
    expect((await getPostTranslation(db, id, 'en')).publishedAt).toEqual(first.publishedAt);
    const future = new Date(Date.now() + 86_400_000).toISOString();
    expect(
      (
        await failure(
          savePost(ctx, id, 'en', content({ slug: 'dated', publishedAt: future }), actor),
        )
      ).fields,
    ).toEqual(['publishedAt']);
    const past = '2020-03-01T08:00:00.000Z';
    await savePost(
      ctx,
      id,
      'en',
      content({ title: 'Dated again', slug: 'dated', publishedAt: past }),
      actor,
    );
    expect((await getPostTranslation(db, id, 'en')).publishedAt?.toISOString()).toBe(past);

    // Offline and back: the publication date stays.
    await changePostStatus(db, id, 'en', 'unpublish', actor);
    expect((await getPostTranslation(db, id, 'en')).unpublishedAt).not.toBeNull();
    await changePostStatus(db, id, 'en', 'publish', actor);
    expect((await getPostTranslation(db, id, 'en')).publishedAt?.toISOString()).toBe(past);
    expect(
      (await listPosts(db, { locale: 'en', status: 'published' })).items.map((p) => p.id),
    ).toContain(id);
    expect(
      (await listPosts(db, { locale: 'ar', status: 'missing' })).items.map((p) => p.id),
    ).toContain(id);

    // A slug change is kept in the audit log for the redirects of M2.
    await savePost(ctx, id, 'en', content({ title: 'Dated again', slug: 'dated-post' }), actor);
    expect(await lastAudit()).toMatchObject({
      action: 'posts.slug_change',
      details: { locale: 'en', from: 'dated', to: 'dated-post', published: true },
    });
  });

  it('checks reserved slugs, references from pages and menus, and deletion', async () => {
    const id = await createPost(ctx, { locale: 'en', title: 'Search', slug: 'search' }, actor);
    // A slug a post uses cannot become reserved.
    try {
      await saveFrontend(db, { reservedSlugs: ['search'] }, actor);
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(InvalidInputError);
      expect((error as InvalidInputError).details).toMatchObject({
        posts: [{ postId: id, locale: 'en', slug: 'search' }],
      });
    }

    // Featured-posts and latest-posts blocks may only name posts and categories that exist.
    const offer = (await pagesSetup(db, registry, await activeModules(db, registry))).offer;
    const page = await createPage(ctx, { locale: 'en', title: 'Home', slug: 'home' }, actor);
    const categoryId = await createTerm(
      db,
      'category',
      { locale: 'en', name: 'News', slug: 'news' },
      actor,
    );
    const missing = '00000000-0000-4000-8000-000000000009';
    const blocks = (postIds: string[], category: string | null) => [
      { type: 'featured-posts', data: { mode: 'manual', postIds, categoryId: null } },
      { type: 'latest-posts', data: { limit: 3, categoryId: category } },
    ];
    await expect(
      saveTranslation(
        ctx,
        page,
        'en',
        { title: 'Home', slug: 'home', seo: {}, blocks: blocks([id, missing], missing) },
        actor,
        { offer },
      ),
    ).rejects.toMatchObject({
      code: 'invalid',
      details: { fields: ['blocks.0.data.postIds.1', 'blocks.1.data.categoryId'] },
    });
    await saveTranslation(
      ctx,
      page,
      'en',
      { title: 'Home', slug: 'home', seo: {}, blocks: blocks([id], categoryId) },
      actor,
      { offer },
    );
    expect((await getTranslation(db, page, 'en')).blocks[0]).toMatchObject({
      data: { mode: 'manual', postIds: [id] },
    });
    expect(await failure(deletePost(db, id, actor))).toMatchObject({ code: 'in_use' });
    expect(((await failure(deletePost(db, id, actor))).error.details.items ?? [])[0]).toBe(
      'en: Home',
    );
    expect((await failure(deleteTerm(db, 'category', categoryId, actor))).code).toBe('in_use');

    // Menu items link to categories and posts; linked ones cannot be deleted either.
    await saveTranslation(
      ctx,
      page,
      'en',
      { title: 'Home', slug: 'home', seo: {}, blocks: [] },
      actor,
      {
        offer,
      },
    );
    const item = await createNavItem(
      db,
      'header',
      {
        parentId: null,
        label: { en: 'News' },
        url: '',
        postCategoryId: categoryId,
        newTab: false,
        sortOrder: 0,
      },
      actor,
    );
    const postItem = await createNavItem(
      db,
      'footer',
      { parentId: null, label: { en: 'Search' }, url: '', postId: id, newTab: false, sortOrder: 0 },
      actor,
    );
    await expect(
      createNavItem(
        db,
        'header',
        {
          parentId: null,
          label: { en: 'Both' },
          url: '',
          postId: id,
          postCategoryId: categoryId,
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
          postId: missing,
          newTab: false,
          sortOrder: 0,
        },
        actor,
      ),
    ).rejects.toMatchObject({ fields: ['postId'] });
    expect(
      (await failure(deleteTerm(db, 'category', categoryId, actor))).error.details.items,
    ).toEqual(['header: News']);
    expect((await failure(deletePost(db, id, actor))).error.details.items).toEqual([
      'footer: Search',
    ]);
    await deleteNavItem(db, item, actor);
    await deleteNavItem(db, postItem, actor);
    await deleteTerm(db, 'category', categoryId, actor);

    // Language versions: the last one cannot go; deleting the post clears its media usages.
    await createPostTranslation(ctx, id, { locale: 'ar', title: 'بحث', slug: 'bahth' }, actor);
    await savePost(
      ctx,
      id,
      'ar',
      content({ title: 'بحث', slug: 'bahth', seo: { ogImage: otherImageId } }),
      actor,
    );
    await deletePostTranslation(db, id, 'ar', actor);
    expect((await usagesOf(db, otherImageId)).filter((u) => u.targetId === id)).toEqual([]);
    expect((await failure(deletePostTranslation(db, id, 'en', actor))).code).toBe(
      'last_translation',
    );
    await savePost(
      ctx,
      id,
      'en',
      content({
        title: 'Search',
        slug: 'search',
        shared: { cover: imageId, categoryIds: [], tagIds: [], authorIds: [] },
      }),
      actor,
    );
    await deletePost(db, id, actor);
    expect((await failure(getPost(db, id))).code).toBe('not_found');
    expect((await usagesOf(db, imageId)).filter((u) => u.targetId === id)).toEqual([]);
    expect(await lastAudit()).toMatchObject({ action: 'posts.delete' });
  });

  it('drops the category names of a removed language from the configuration', async () => {
    const id = await createTerm(
      db,
      'category',
      { locale: 'ar', name: 'عربي', slug: 'arabi' },
      actor,
    );
    await saveLanguages(db, { content: [{ code: 'en' }], primary: 'en', admin: 'en' }, actor);
    const names = (await exportInstanceConfig(db)).posts.categories.map((c) => c.name);
    expect(names.some((n) => 'ar' in n)).toBe(false);
    // The translation stays and comes back with the language.
    await saveLanguages(
      db,
      { content: [{ code: 'en' }, { code: 'ar' }], primary: 'en', admin: 'en' },
      actor,
    );
    expect((await exportInstanceConfig(db)).posts.categories.map((c) => c.name)).toContainEqual({
      ar: 'عربي',
    });
    expect((await getTerm(db, 'category', id)).translations).toHaveLength(1);
  });
});
