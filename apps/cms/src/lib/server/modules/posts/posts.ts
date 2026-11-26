// Posts (docs/spec/README.md chapters 3, 4 and 6; docs/adr/0010). Each content language is a
// translation row with its own slug, title, excerpt, rich text body, key takeaways, SEO fields,
// status and dates; cover, categories, tags and authors are shared by all languages. The status
// is managed per language with the same rules as pages. In M1 edits change the content
// directly; the working copies of M2 will hold the same `PostContent` and `PostShared` and
// publish them through `writeContent`.
import {
  richTextMedia,
  richTextSchema,
  EMPTY_RICH_TEXT,
  type RichTextDoc,
} from '@bluepax/cms-blocks';
import { isSlug } from '@bluepax/core';
import {
  schema,
  type ContentStatus,
  type Database,
  type Executor,
  type Localized,
  type PostSource,
  type SeoFields,
} from '@bluepax/db';
import { routeFixedSegments, type RouteTemplates } from '@bluepax/presets';
import {
  and,
  asc,
  count,
  desc,
  eq,
  exists,
  ilike,
  inArray,
  ne,
  notExists,
  or,
  sql,
} from 'drizzle-orm';
import { z } from 'zod';
import { audit } from '../../audit.ts';
import { emptySeo, seoSchema } from '../../content/seo.ts';
import {
  TRANSITIONS,
  canTransition,
  escapeLike,
  isUuid,
  pgError,
  type StatusAction,
} from '../../content/status.ts';
import { exportInstanceConfig } from '../../instance.ts';
import { clearMediaUsages, type MediaContext } from '../media/library.ts';
import { authorOfUser } from './authors.ts';
import {
  changedFields,
  checkSlug,
  contentSetup,
  fieldChecks,
  ogImageUse,
  optionalText,
  parseSeo,
  prepareMedia,
  requireLanguage,
  requiredText,
  uniqueRace,
  writeUsages,
  type Actor,
  type Language,
  type MediaUse,
} from './common.ts';
import { PostError } from './errors.ts';
import { blockUses, navUses } from './references.ts';

export const TITLE_MAX_LENGTH = 200;
export const EXCERPT_MAX_LENGTH = 1000;
export const TAKEAWAY_MAX_LENGTH = 300;
export const MAX_TAKEAWAYS = 10;
export const MAX_CATEGORIES = 10;
export const MAX_TAGS = 50;
export const MAX_AUTHORS = 10;

const target = (postId: string, locale?: string) => ({
  module: 'posts',
  targetType: 'post',
  targetId: postId,
  ...(locale !== undefined && { locale }),
});

// ---------------------------------------------------------------------------------------------
// Instance context

export interface PostsSetup {
  languages: Language[];
  primary: string;
  frontendBaseUrl: string;
  /** Route templates, for the address preview. */
  routes: RouteTemplates;
  /** Reserved slugs: the configured ones and the fixed segments of the route templates. */
  reserved: { configured: string[]; routes: string[] };
}

export async function postsSetup(db: Executor): Promise<PostsSetup> {
  const config = await exportInstanceConfig(db);
  return {
    languages: config.languages.content.map((l) => ({ code: l.code, dir: l.dir })),
    primary: config.languages.primary,
    frontendBaseUrl: config.frontend.baseUrl,
    routes: config.frontend.routes,
    reserved: {
      configured: config.frontend.reservedSlugs,
      routes: routeFixedSegments(config.frontend.routes),
    },
  };
}

// ---------------------------------------------------------------------------------------------
// Reading

export interface LanguageStatus {
  locale: string;
  status: ContentStatus;
}

export interface PostListItem {
  id: string;
  /** The language listed; null when the post has no version in it (`missing`). */
  locale: string | null;
  title: string;
  slug: string | null;
  status: ContentStatus | null;
  publishedAt: Date | null;
  updatedAt: Date;
  /** Status of every language version, for the list's language column. */
  languages: LanguageStatus[];
  categoryIds: string[];
}

export interface PostFilter {
  locale: string;
  /** A status, `missing` (posts without this language) or undefined for all. */
  status?: ContentStatus | 'missing';
  categoryId?: string;
  /** Part of the title or slug. */
  query?: string;
  page?: number;
  pageSize?: number;
}

async function languageStatuses(db: Executor, ids: string[]) {
  const map = new Map<string, (LanguageStatus & { title: string })[]>();
  if (ids.length === 0) return map;
  const t = schema.postsTranslations;
  const rows = await db
    .select({ postId: t.entityId, locale: t.locale, status: t.status, title: t.title })
    .from(t)
    .where(inArray(t.entityId, ids))
    .orderBy(asc(t.locale));
  for (const row of rows) map.set(row.postId, [...(map.get(row.postId) ?? []), row]);
  return map;
}

async function linkedIds(
  db: Executor,
  kind: 'category' | 'tag' | 'author',
  postIds: string[],
): Promise<Map<string, string[]>> {
  const map = new Map<string, string[]>();
  if (postIds.length === 0) return map;
  const l =
    kind === 'category'
      ? { table: schema.postCategoryLinks, id: schema.postCategoryLinks.categoryId }
      : kind === 'tag'
        ? { table: schema.postTagLinks, id: schema.postTagLinks.tagId }
        : { table: schema.postAuthorLinks, id: schema.postAuthorLinks.authorId };
  const rows = await db
    .select({ postId: l.table.postId, id: l.id })
    .from(l.table)
    .where(inArray(l.table.postId, postIds))
    .orderBy(asc(l.table.postId), asc(l.table.sortOrder));
  for (const row of rows) map.set(row.postId, [...(map.get(row.postId) ?? []), row.id]);
  return map;
}

export async function listPosts(
  db: Executor,
  filter: PostFilter,
): Promise<{ items: PostListItem[]; total: number; page: number; pageSize: number }> {
  const pageSize = Math.min(Math.max(filter.pageSize ?? 50, 1), 200);
  const page = Math.max(filter.page ?? 1, 1);
  const query = filter.query?.trim();
  const t = schema.postsTranslations;
  const matches = (q: string) =>
    or(ilike(t.title, `%${escapeLike(q)}%`), ilike(t.slug, `%${escapeLike(q)}%`));
  const inCategory =
    filter.categoryId && isUuid(filter.categoryId)
      ? exists(
          db
            .select({ one: sql`1` })
            .from(schema.postCategoryLinks)
            .where(
              and(
                eq(schema.postCategoryLinks.postId, schema.posts.id),
                eq(schema.postCategoryLinks.categoryId, filter.categoryId),
              ),
            ),
        )
      : filter.categoryId
        ? sql`false`
        : undefined;

  let rows: Omit<PostListItem, 'languages' | 'categoryIds'>[];
  let total: number;
  if (filter.status === 'missing') {
    const where = and(
      notExists(
        db
          .select({ one: sql`1` })
          .from(t)
          .where(and(eq(t.entityId, schema.posts.id), eq(t.locale, filter.locale))),
      ),
      query
        ? exists(
            db
              .select({ one: sql`1` })
              .from(t)
              .where(and(eq(t.entityId, schema.posts.id), matches(query))),
          )
        : undefined,
      inCategory,
    );
    const [n] = await db.select({ n: count() }).from(schema.posts).where(where);
    total = n?.n ?? 0;
    const found = await db
      .select({ id: schema.posts.id, updatedAt: schema.posts.updatedAt })
      .from(schema.posts)
      .where(where)
      .orderBy(desc(schema.posts.updatedAt), desc(schema.posts.id))
      .limit(pageSize)
      .offset((page - 1) * pageSize);
    rows = found.map((row) => ({
      ...row,
      locale: null,
      title: '',
      slug: null,
      status: null,
      publishedAt: null,
    }));
  } else {
    const where = and(
      eq(t.locale, filter.locale),
      filter.status ? eq(t.status, filter.status) : undefined,
      query ? matches(query) : undefined,
      inCategory,
    );
    const [n] = await db
      .select({ n: count() })
      .from(t)
      .innerJoin(schema.posts, eq(schema.posts.id, t.entityId))
      .where(where);
    total = n?.n ?? 0;
    rows = await db
      .select({
        id: schema.posts.id,
        locale: t.locale,
        title: t.title,
        slug: t.slug,
        status: t.status,
        publishedAt: t.publishedAt,
        updatedAt: t.updatedAt,
      })
      .from(t)
      .innerJoin(schema.posts, eq(schema.posts.id, t.entityId))
      .where(where)
      .orderBy(desc(t.updatedAt), desc(t.id))
      .limit(pageSize)
      .offset((page - 1) * pageSize);
  }
  const ids = rows.map((r) => r.id);
  const [languages, categories] = await Promise.all([
    languageStatuses(db, ids),
    linkedIds(db, 'category', ids),
  ]);
  return {
    items: rows.map((row) => {
      const versions = languages.get(row.id) ?? [];
      return {
        ...row,
        // A post without this language is shown with the title of another one.
        title: row.locale ? row.title : (versions[0]?.title ?? ''),
        languages: versions.map(({ locale, status }) => ({ locale, status })),
        categoryIds: categories.get(row.id) ?? [],
      };
    }),
    total,
    page,
    pageSize,
  };
}

/** Fields shared by all languages of a post. */
export interface PostShared {
  /** Media ID of the cover image. */
  cover: string | null;
  /** In order; the first one is the main category. */
  categoryIds: string[];
  tagIds: string[];
  /** In the order they are credited. */
  authorIds: string[];
}

export interface TranslationSummary extends LanguageStatus {
  title: string;
  slug: string;
}

export interface PostSummary extends PostShared {
  id: string;
  createdAt: Date;
  /** Version of the shared fields: changes only when they change. */
  updatedAt: Date;
  translations: TranslationSummary[];
}

async function sharedOf(db: Executor, postId: string, cover: string | null): Promise<PostShared> {
  const [categories, tags, authors] = await Promise.all([
    linkedIds(db, 'category', [postId]),
    linkedIds(db, 'tag', [postId]),
    linkedIds(db, 'author', [postId]),
  ]);
  return {
    cover,
    categoryIds: categories.get(postId) ?? [],
    tagIds: tags.get(postId) ?? [],
    authorIds: authors.get(postId) ?? [],
  };
}

export async function getPost(db: Executor, id: string): Promise<PostSummary> {
  if (!isUuid(id)) throw new PostError('not_found');
  const [row] = await db.select().from(schema.posts).where(eq(schema.posts.id, id));
  if (!row) throw new PostError('not_found');
  const t = schema.postsTranslations;
  const translations = await db
    .select({ locale: t.locale, status: t.status, title: t.title, slug: t.slug })
    .from(t)
    .where(eq(t.entityId, id))
    .orderBy(asc(t.locale));
  return {
    id: row.id,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    ...(await sharedOf(db, id, row.cover)),
    translations,
  };
}

/** The editable content of one language (shared fields are on the post itself). */
export interface PostContent {
  title: string;
  slug: string;
  excerpt: string;
  body: RichTextDoc;
  keyTakeaways: string[];
  seo: SeoFields;
}

export interface PostTranslation extends PostContent {
  id: string;
  postId: string;
  locale: string;
  status: ContentStatus;
  source: PostSource;
  publishedAt: Date | null;
  modifiedAt: Date | null;
  unpublishedAt: Date | null;
  updatedAt: Date;
  updatedBy: string | null;
}

async function findTranslation(db: Executor, postId: string, locale: string, lock = false) {
  if (!isUuid(postId)) return undefined;
  const t = schema.postsTranslations;
  const query = db
    .select()
    .from(t)
    .where(and(eq(t.entityId, postId), eq(t.locale, locale)));
  const [row] = lock ? await query.for('update') : await query;
  return row;
}

export async function getPostTranslation(
  db: Executor,
  postId: string,
  locale: string,
): Promise<PostTranslation> {
  const row = await findTranslation(db, postId, locale);
  if (!row) throw new PostError('not_found');
  const [editor] = row.updatedBy
    ? await db
        .select({ name: schema.users.displayName })
        .from(schema.users)
        .where(eq(schema.users.id, row.updatedBy))
    : [];
  const seo = seoSchema.safeParse(row.seo);
  const body = richTextSchema.safeParse(row.body);
  return {
    id: row.id,
    postId: row.entityId,
    locale: row.locale,
    title: row.title,
    slug: row.slug,
    excerpt: row.excerpt,
    body: body.success ? body.data : (row.body as RichTextDoc),
    keyTakeaways: row.keyTakeaways,
    seo: seo.success ? seo.data : row.seo,
    status: row.status,
    source: row.source,
    publishedAt: row.publishedAt,
    modifiedAt: row.modifiedAt,
    unpublishedAt: row.unpublishedAt,
    updatedAt: row.updatedAt,
    updatedBy: editor?.name ?? null,
  };
}

/** Posts with their title and slug per language, e.g. for the navigation editor. */
export async function postOptions(db: Executor) {
  const t = schema.postsTranslations;
  const rows = await db
    .select({ id: t.entityId, locale: t.locale, title: t.title, slug: t.slug, status: t.status })
    .from(t)
    .orderBy(asc(t.title));
  const posts = new Map<
    string,
    { id: string; titles: Localized; slugs: Localized; published: string[] }
  >();
  for (const row of rows) {
    const post = posts.get(row.id) ?? { id: row.id, titles: {}, slugs: {}, published: [] };
    post.titles[row.locale] = row.title;
    post.slugs[row.locale] = row.slug;
    if (row.status === 'published') post.published.push(row.locale);
    posts.set(row.id, post);
  }
  return [...posts.values()];
}

export interface PickedPost {
  id: string;
  /** Title in the requested language, else in another one (`locale` says which). */
  title: string;
  locale: string;
  /** Status in the requested language; null when the post has no version in it. */
  status: ContentStatus | null;
  publishedAt: Date | null;
}

/**
 * Posts for the post pickers of page blocks: by IDs, or the latest ones matching a category
 * and a search, with the title in the given language where there is one.
 */
export async function pickPosts(
  db: Executor,
  options: {
    locale: string;
    ids?: string[];
    categoryId?: string | null;
    query?: string;
    limit?: number;
  },
): Promise<PickedPost[]> {
  const t = schema.postsTranslations;
  const ids = options.ids?.filter(isUuid);
  if (options.ids && ids!.length === 0) return [];
  let postIds: string[];
  if (ids) {
    postIds = ids;
  } else {
    const query = options.query?.trim();
    const rows = await db
      .selectDistinct({ id: schema.posts.id, updatedAt: schema.posts.createdAt })
      .from(schema.posts)
      .innerJoin(t, eq(t.entityId, schema.posts.id))
      .where(
        and(
          query
            ? or(ilike(t.title, `%${escapeLike(query)}%`), ilike(t.slug, `%${escapeLike(query)}%`))
            : undefined,
          options.categoryId && isUuid(options.categoryId)
            ? exists(
                db
                  .select({ one: sql`1` })
                  .from(schema.postCategoryLinks)
                  .where(
                    and(
                      eq(schema.postCategoryLinks.postId, schema.posts.id),
                      eq(schema.postCategoryLinks.categoryId, options.categoryId),
                    ),
                  ),
              )
            : undefined,
        ),
      )
      .orderBy(desc(schema.posts.createdAt))
      .limit(Math.min(Math.max(options.limit ?? 50, 1), 100));
    postIds = rows.map((r) => r.id);
  }
  if (postIds.length === 0) return [];
  const versions = await db
    .select({
      id: t.entityId,
      locale: t.locale,
      title: t.title,
      status: t.status,
      publishedAt: t.publishedAt,
    })
    .from(t)
    .where(inArray(t.entityId, postIds))
    .orderBy(asc(t.locale));
  const byPost = new Map<string, typeof versions>();
  for (const v of versions) byPost.set(v.id, [...(byPost.get(v.id) ?? []), v]);
  return postIds.flatMap((id) => {
    const list = byPost.get(id) ?? [];
    const own = list.find((v) => v.locale === options.locale);
    const shown = own ?? list[0];
    if (!shown) return [];
    return [
      {
        id,
        title: shown.title,
        locale: shown.locale,
        status: own?.status ?? null,
        publishedAt: own?.publishedAt ?? null,
      },
    ];
  });
}

// ---------------------------------------------------------------------------------------------
// Writing

const idList = (max: number) =>
  z
    .array(z.uuid())
    .max(max)
    .transform((values) => [...new Set(values)]);

const sharedSchema = z.strictObject({
  cover: z.uuid().nullable(),
  categoryIds: idList(MAX_CATEGORIES),
  tagIds: idList(MAX_TAGS),
  authorIds: idList(MAX_AUTHORS),
});

const takeawaysSchema = z
  .array(z.string().trim().max(TAKEAWAY_MAX_LENGTH))
  .transform((values) => values.filter(Boolean))
  .pipe(z.array(z.string()).max(MAX_TAKEAWAYS));

function parseBody(value: unknown): RichTextDoc {
  const body = richTextSchema.safeParse(value ?? EMPTY_RICH_TEXT);
  if (!body.success) throw new PostError('invalid', { fields: ['body'] });
  return body.data;
}

function parseShared(value: unknown): PostShared {
  const shared = sharedSchema.safeParse(value);
  if (!shared.success) {
    throw new PostError('invalid', {
      fields: [...new Set(shared.error.issues.map((i) => String(i.path[0] ?? 'shared')))],
    });
  }
  return shared.data;
}

/** The publication date as submitted: a past moment, or null for "when first published". */
function parsePublishedAt(value: string | null): Date | null {
  if (value === null || value === '') return null;
  const date = new Date(value);
  // A future date would be scheduled publishing, which follows in M2.
  if (Number.isNaN(date.getTime()) || date.getTime() > Date.now() + 60_000) {
    throw new PostError('invalid', { fields: ['publishedAt'] });
  }
  if (date.getUTCFullYear() < 1900) throw new PostError('invalid', { fields: ['publishedAt'] });
  return date;
}

function contentMediaUses(content: Pick<PostContent, 'seo' | 'body'>): MediaUse[] {
  return [
    ...richTextMedia(content.body).map((mediaId) => ({
      ref: { mediaId, field: 'body', kind: 'image' as const },
      formField: 'body',
    })),
    ...ogImageUse(content.seo.ogImage),
  ];
}

/**
 * The cover is the OG image of every language without its own (chapter 3), so it gets the
 * purpose `og`: the 1200×630 JPG that the Delivery API returns is derived from it (chapter 5).
 */
function sharedMediaUses(shared: PostShared): MediaUse[] {
  return shared.cover
    ? [
        {
          ref: { mediaId: shared.cover, field: 'cover', kind: 'image', purpose: 'og' },
          formField: 'cover',
        },
      ]
    : [];
}

/** Locks the categories, tags and authors of the shared fields; unknown ones fail. */
async function requireLinked(tx: Executor, shared: PostShared): Promise<void> {
  const missing: string[] = [];
  const check = async (
    ids: string[],
    table: typeof schema.postCategories | typeof schema.tags | typeof schema.authors,
    field: string,
  ) => {
    if (ids.length === 0) return;
    const rows = await tx
      .select({ id: table.id })
      .from(table)
      .where(inArray(table.id, ids))
      .for('key share');
    if (rows.length !== ids.length) missing.push(field);
  };
  await check(shared.categoryIds, schema.postCategories, 'categoryIds');
  await check(shared.tagIds, schema.tags, 'tagIds');
  await check(shared.authorIds, schema.authors, 'authorIds');
  if (missing.length > 0) throw new PostError('invalid', { fields: missing });
}

async function writeLinks(tx: Executor, postId: string, shared: PostShared): Promise<void> {
  await tx.delete(schema.postCategoryLinks).where(eq(schema.postCategoryLinks.postId, postId));
  await tx.delete(schema.postTagLinks).where(eq(schema.postTagLinks.postId, postId));
  await tx.delete(schema.postAuthorLinks).where(eq(schema.postAuthorLinks.postId, postId));
  if (shared.categoryIds.length > 0) {
    await tx
      .insert(schema.postCategoryLinks)
      .values(
        shared.categoryIds.map((categoryId, sortOrder) => ({ postId, categoryId, sortOrder })),
      );
  }
  if (shared.tagIds.length > 0) {
    await tx
      .insert(schema.postTagLinks)
      .values(shared.tagIds.map((tagId, sortOrder) => ({ postId, tagId, sortOrder })));
  }
  if (shared.authorIds.length > 0) {
    await tx
      .insert(schema.postAuthorLinks)
      .values(shared.authorIds.map((authorId, sortOrder) => ({ postId, authorId, sortOrder })));
  }
}

/**
 * Writes the shared fields of a post: the cover with its media usage and the links. Callers
 * hold the post's row lock and have validated the fields. Publishing a working copy will reuse
 * this step in M2.
 */
async function writeShared(tx: Executor, postId: string, shared: PostShared): Promise<void> {
  await requireLinked(tx, shared);
  await tx
    .update(schema.posts)
    .set({ cover: shared.cover, updatedAt: sql`now()` })
    .where(eq(schema.posts.id, postId));
  await writeLinks(tx, postId, shared);
  await writeUsages(tx, target(postId, ''), sharedMediaUses(shared));
}

interface DateChange {
  /** The publication date to store; undefined keeps the stored one. */
  publishedAt?: Date | null;
  /** Whether the live content changed (dateModified). */
  liveChanged: boolean;
}

/**
 * Writes the content of one language: the translation row and its dates. Callers hold the row
 * lock and have validated the content. This is the step that publishing a working copy will
 * reuse in M2.
 */
async function writeContent(
  tx: Executor,
  translationId: string,
  content: PostContent,
  actor: Actor,
  dates: DateChange,
  statusChange?: StatusAction,
): Promise<void> {
  const t = schema.postsTranslations;
  const publishedAt =
    statusChange === 'publish'
      ? // The first publication sets the date; later ones keep it.
        dates.publishedAt === undefined || dates.publishedAt === null
        ? sql`coalesce(${t.publishedAt}, now())`
        : dates.publishedAt
      : dates.publishedAt;
  await tx
    .update(t)
    .set({
      title: content.title,
      slug: content.slug,
      excerpt: content.excerpt,
      body: content.body,
      keyTakeaways: content.keyTakeaways,
      seo: content.seo,
      updatedBy: actor.id,
      updatedAt: sql`now()`,
      ...(publishedAt !== undefined && { publishedAt }),
      ...((statusChange === 'publish' || dates.liveChanged) && { modifiedAt: sql`now()` }),
      ...(statusChange && { status: TRANSITIONS[statusChange].to }),
      ...(statusChange === 'unpublish' && { unpublishedAt: sql`now()` }),
    })
    .where(eq(t.id, translationId));
}

export interface NewTranslation {
  locale: string;
  title: string;
  slug: string;
}

/**
 * Creates a post with its first language version, as a draft. The author linked to the
 * creator's account is credited by default.
 */
export async function createPost(
  ctx: MediaContext,
  input: NewTranslation,
  actor: Actor,
): Promise<string> {
  const title = requiredText(input.title, 'title', TITLE_MAX_LENGTH);
  try {
    return await ctx.db.transaction(async (tx) => {
      await requireLanguage(tx, input.locale);
      await checkSlug(tx, 'post', input.locale, input.slug);
      const [post] = await tx
        .insert(schema.posts)
        .values({ createdBy: actor.id })
        .returning({ id: schema.posts.id });
      const id = post!.id;
      await tx.insert(schema.postsTranslations).values({
        entityId: id,
        locale: input.locale,
        slug: input.slug,
        title,
        body: EMPTY_RICH_TEXT,
        seo: emptySeo(),
        createdBy: actor.id,
        updatedBy: actor.id,
      });
      const author = await authorOfUser(tx, actor.id);
      if (author) {
        await tx
          .insert(schema.postAuthorLinks)
          .values({ postId: id, authorId: author, sortOrder: 0 });
      }
      await audit(tx, {
        action: 'posts.create',
        actorId: actor.id,
        targetType: 'post',
        targetId: id,
        details: { locale: input.locale, slug: input.slug },
        ip: actor.ip,
      });
      return id;
    });
  } catch (error) {
    if (error instanceof PostError) throw error;
    return uniqueRace('post', error);
  }
}

/**
 * Adds a language version to a post, as a draft. With `copyFrom`, the excerpt, body and key
 * takeaways of that language are copied to start the translation from.
 */
export async function createPostTranslation(
  ctx: MediaContext,
  postId: string,
  input: NewTranslation & { copyFrom?: string | undefined },
  actor: Actor,
): Promise<void> {
  const title = requiredText(input.title, 'title', TITLE_MAX_LENGTH);
  await getPost(ctx.db, postId);
  let copied: Pick<PostContent, 'excerpt' | 'body' | 'keyTakeaways'> = {
    excerpt: '',
    body: EMPTY_RICH_TEXT,
    keyTakeaways: [],
  };
  if (input.copyFrom) {
    const source = await findTranslation(ctx.db, postId, input.copyFrom);
    if (!source) throw new PostError('invalid', { fields: ['copyFrom'] });
    copied = {
      excerpt: source.excerpt,
      body: parseBody(source.body),
      keyTakeaways: source.keyTakeaways,
    };
  }
  const uses = contentMediaUses({ body: copied.body, seo: emptySeo() });
  await prepareMedia(ctx, uses);
  try {
    await ctx.db.transaction(async (tx) => {
      await requireLanguage(tx, input.locale);
      const [post] = await tx
        .select({ id: schema.posts.id })
        .from(schema.posts)
        .where(eq(schema.posts.id, postId))
        .for('update');
      if (!post) throw new PostError('not_found');
      if (await findTranslation(tx, postId, input.locale)) {
        throw new PostError('translation_exists', { fields: ['locale'] });
      }
      await checkSlug(tx, 'post', input.locale, input.slug, postId);
      await tx.insert(schema.postsTranslations).values({
        entityId: postId,
        locale: input.locale,
        slug: input.slug,
        title,
        ...copied,
        seo: emptySeo(),
        createdBy: actor.id,
        updatedBy: actor.id,
      });
      await writeUsages(tx, target(postId, input.locale), uses);
      await audit(tx, {
        action: 'posts.translation_create',
        actorId: actor.id,
        targetType: 'post',
        targetId: postId,
        details: {
          locale: input.locale,
          slug: input.slug,
          ...(input.copyFrom && { copyFrom: input.copyFrom }),
        },
        ip: actor.ip,
      });
    });
  } catch (error) {
    if (error instanceof PostError) throw error;
    uniqueRace('post', error);
  }
}

export interface PostInput {
  title: string;
  slug: string;
  excerpt: string;
  /** Rich text as submitted; see richTextSchema. */
  body: unknown;
  keyTakeaways: string[];
  /** SEO fields as submitted; see seoSchema. */
  seo: unknown;
  /**
   * The publication date as submitted (ISO 8601, empty for "when first published"); undefined
   * leaves it unchanged. Only for users who may publish.
   */
  publishedAt?: string | null | undefined;
  /** The shared fields, when the editor changed them; undefined leaves them unchanged. */
  shared?: unknown;
}

export interface SaveOptions {
  /**
   * `updatedAt` of the language when the editor opened it (ISO 8601). If someone saved it
   * since, the save is refused with `edit_conflict` (409) instead of overwriting their changes.
   */
  version?: string | undefined;
  /** `updatedAt` of the post's shared fields when the editor opened it, checked the same way. */
  sharedVersion?: string | undefined;
  /** A status change in the same transaction, e.g. save and publish. */
  status?: StatusAction | undefined;
}

/**
 * Saves the content of one language, optionally the shared fields and a status change. The
 * title, slug (format, reserved, unique in the language), excerpt, body, key takeaways, SEO
 * fields, publication date, the linked categories, tags and authors and the media are checked.
 * Published content changes directly in M1, and its dateModified moves on.
 */
export async function savePost(
  ctx: MediaContext,
  postId: string,
  locale: string,
  input: PostInput,
  actor: Actor,
  options: SaveOptions = {},
): Promise<{ slugChanged: boolean; status: ContentStatus }> {
  const current = await getPostTranslation(ctx.db, postId, locale);
  const checks = fieldChecks();
  const title = checks.attempt(() => requiredText(input.title, 'title', TITLE_MAX_LENGTH));
  const excerpt = checks.attempt(() => optionalText(input.excerpt, 'excerpt', EXCERPT_MAX_LENGTH));
  const body = checks.attempt(() => parseBody(input.body));
  const takeaways = takeawaysSchema.safeParse(input.keyTakeaways);
  if (!takeaways.success) checks.fail('keyTakeaways');
  const seo = checks.attempt(() => parseSeo(input.seo));
  const shared =
    input.shared === undefined ? undefined : checks.attempt(() => parseShared(input.shared));
  const publishedAt =
    input.publishedAt === undefined
      ? undefined
      : checks.attempt(() => parsePublishedAt(input.publishedAt ?? null));
  if (!isSlug(input.slug)) checks.fail('slug');
  checks.throwIfFailed();
  const content: PostContent = {
    title: title!,
    slug: input.slug,
    excerpt: excerpt!,
    body: body!,
    keyTakeaways: takeaways.data!,
    seo: seo!,
  };
  const uses = contentMediaUses(content);
  await prepareMedia(ctx, [...(shared ? sharedMediaUses(shared) : []), ...uses]);

  try {
    return await ctx.db.transaction(async (tx) => {
      const [post] = await tx
        .select({ updatedAt: schema.posts.updatedAt, cover: schema.posts.cover })
        .from(schema.posts)
        .where(eq(schema.posts.id, postId))
        .for('update');
      if (!post) throw new PostError('not_found');
      const row = await findTranslation(tx, postId, locale, true);
      if (!row) throw new PostError('not_found');
      if (options.version && row.updatedAt.toISOString() !== options.version) {
        throw new PostError('edit_conflict');
      }
      const before = await sharedOf(tx, postId, post.cover);
      const sharedFields = shared ? changedFields({ ...before }, { ...shared }) : [];
      if (
        sharedFields.length > 0 &&
        options.sharedVersion &&
        post.updatedAt.toISOString() !== options.sharedVersion
      ) {
        throw new PostError('edit_conflict');
      }
      if (content.slug !== row.slug) await checkSlug(tx, 'post', locale, content.slug, postId);
      if (options.status && !canTransition(row.status, options.status)) {
        throw new PostError('invalid_status');
      }
      const status = options.status ? TRANSITIONS[options.status].to : row.status;
      // A published version keeps its date; clearing it only takes effect while it is offline.
      const date = publishedAt === null && status === 'published' ? undefined : publishedAt;
      const contentFields = changedFields({ ...current, slug: row.slug }, { ...content });
      const dateChanged = date !== undefined && date?.getTime() !== row.publishedAt?.getTime();
      // Saving a live version changes what readers see, so its dateModified moves on.
      const liveChanged =
        row.status === 'published' &&
        status === 'published' &&
        contentFields.length + sharedFields.length > 0;
      await writeContent(
        tx,
        row.id,
        content,
        actor,
        { publishedAt: date, liveChanged },
        options.status,
      );
      await writeUsages(tx, target(postId, locale), uses);
      if (shared && sharedFields.length > 0) await writeShared(tx, postId, shared);
      const fields = [...contentFields, ...(dateChanged ? ['publishedAt'] : []), ...sharedFields];
      if (fields.length > 0) {
        await audit(tx, {
          action: 'posts.update',
          actorId: actor.id,
          targetType: 'post',
          targetId: postId,
          details: { locale, fields },
          ip: actor.ip,
        });
      }
      const slugChanged = content.slug !== row.slug;
      if (slugChanged) {
        // Kept so that the redirects of M2 (seo) can be written for addresses that were live.
        await audit(tx, {
          action: 'posts.slug_change',
          actorId: actor.id,
          targetType: 'post',
          targetId: postId,
          details: {
            locale,
            from: row.slug,
            to: content.slug,
            published: row.status === 'published',
          },
          ip: actor.ip,
        });
        // TODO(M2): write the 301 for a published address and emit `content.slug_changed`.
      }
      if (options.status) await auditStatus(tx, postId, locale, row.status, status, actor);
      return { slugChanged, status };
    });
  } catch (error) {
    if (error instanceof PostError) throw error;
    return uniqueRace('post', error);
  }
}

async function auditStatus(
  tx: Executor,
  postId: string,
  locale: string,
  from: ContentStatus,
  to: ContentStatus,
  actor: Actor,
): Promise<void> {
  const action =
    to === 'published'
      ? 'posts.publish'
      : to === 'unpublished'
        ? 'posts.unpublish'
        : 'posts.status';
  await audit(tx, {
    action,
    actorId: actor.id,
    targetType: 'post',
    targetId: postId,
    details: { locale, from, to },
    ip: actor.ip,
  });
  // TODO(M2): emit `content.published` / `content.unpublished` with the affected paths.
}

/** Changes the status of one language without saving content. */
export async function changePostStatus(
  db: Database,
  postId: string,
  locale: string,
  action: StatusAction,
  actor: Actor,
): Promise<ContentStatus> {
  return db.transaction(async (tx) => {
    const row = await findTranslation(tx, postId, locale, true);
    if (!row) throw new PostError('not_found');
    if (!canTransition(row.status, action)) throw new PostError('invalid_status');
    const t = schema.postsTranslations;
    const to = TRANSITIONS[action].to;
    await tx
      .update(t)
      .set({
        status: to,
        updatedBy: actor.id,
        updatedAt: sql`now()`,
        ...(action === 'publish' && {
          publishedAt: sql`coalesce(${t.publishedAt}, now())`,
          modifiedAt: sql`now()`,
        }),
        ...(action === 'unpublish' && { unpublishedAt: sql`now()` }),
      })
      .where(eq(t.id, row.id));
    await auditStatus(tx, postId, locale, row.status, to, actor);
    return to;
  });
}

/** Deletes one language version; the last one is refused (delete the post). */
export async function deletePostTranslation(
  db: Database,
  postId: string,
  locale: string,
  actor: Actor,
): Promise<void> {
  if (!isUuid(postId)) throw new PostError('not_found');
  await db.transaction(async (tx) => {
    const [post] = await tx
      .select({ id: schema.posts.id })
      .from(schema.posts)
      .where(eq(schema.posts.id, postId))
      .for('update');
    if (!post) throw new PostError('not_found');
    const row = await findTranslation(tx, postId, locale, true);
    if (!row) throw new PostError('not_found');
    const t = schema.postsTranslations;
    const [others] = await tx
      .select({ n: count() })
      .from(t)
      .where(and(eq(t.entityId, postId), ne(t.id, row.id)));
    if ((others?.n ?? 0) === 0) throw new PostError('last_translation');
    await tx.delete(t).where(eq(t.id, row.id));
    await clearMediaUsages(tx, target(postId, locale));
    await audit(tx, {
      action: 'posts.translation_delete',
      actorId: actor.id,
      targetType: 'post',
      targetId: postId,
      details: { locale, slug: row.slug, title: row.title, status: row.status },
      ip: actor.ip,
    });
    // TODO(M2): mark a published address as 410 and emit `content.deleted`.
  });
}

/**
 * Deletes a post with every language version. Refused while menu items or featured-posts blocks
 * point at it (`in_use`), so neither is left pointing nowhere.
 */
export async function deletePost(db: Database, postId: string, actor: Actor): Promise<void> {
  if (!isUuid(postId)) throw new PostError('not_found');
  await db.transaction(async (tx) => {
    const [post] = await tx
      .select({ id: schema.posts.id })
      .from(schema.posts)
      .where(eq(schema.posts.id, postId))
      .for('update');
    if (!post) throw new PostError('not_found');
    const { primary } = await contentSetup(tx);
    const items = [
      ...(await navUses(tx, { postId }, primary)),
      ...(await blockUses(tx, { postId })),
    ];
    if (items.length > 0) throw new PostError('in_use', { items });
    const t = schema.postsTranslations;
    const versions = await tx
      .select({ locale: t.locale, slug: t.slug, status: t.status })
      .from(t)
      .where(eq(t.entityId, postId));
    await clearMediaUsages(tx, target(postId));
    try {
      await tx.delete(schema.posts).where(eq(schema.posts.id, postId));
    } catch (error) {
      // A menu item was added meanwhile (nav_items.post_id is ON DELETE RESTRICT).
      if (pgError(error).code === '23503') throw new PostError('in_use', { items: [] });
      throw error;
    }
    await audit(tx, {
      action: 'posts.delete',
      actorId: actor.id,
      targetType: 'post',
      targetId: postId,
      details: { versions },
      ip: actor.ip,
    });
    // TODO(M2): mark published addresses as 410 and emit `content.deleted`.
  });
}
