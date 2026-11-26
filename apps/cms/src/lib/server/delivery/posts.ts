// Delivery endpoints of the posts module (docs/spec/README.md chapter 6; docs/adr/0010, 0012):
// `/posts`, `/posts/{slug}`, `/post-categories`, `/tags`, `/authors`, `/authors/{slug}`. Only
// published languages; a category, tag or author exists in a language when it has a
// translation there, so references without one are left out (no fallback to other languages).
import { richTextMedia } from '@bluepax/cms-blocks';
import { schema, type ContentStatus, type RichTextJson, type SeoFields } from '@bluepax/db';
import { absoluteUrl } from '@bluepax/presets';
import { and, asc, count, desc, eq, exists, inArray, max, sql, type SQL } from 'drizzle-orm';
import { addressesOf, entryPath, type RoutableType } from '../content/routes.ts';
import type {
  Author,
  AuthorRef,
  List,
  Media,
  Post,
  PostSummary,
  Term,
  TermRef,
} from './contract.ts';
import {
  iso,
  notFound,
  pagination,
  requestLocale,
  slugParam,
  type DeliveryContext,
} from './context.ts';
import { richTextHtml } from './html.ts';
import { buildSeo, firstImage, PublisherCache, websiteNode } from './seo.ts';

/** Drops undefined values so JSON-LD only carries what is known. */
export function compact(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined));
}

function pathOf(
  ctx: DeliveryContext,
  type: RoutableType,
  locale: string,
  id: string,
  slug: string,
) {
  return entryPath(ctx.routing.templates, { type, route: type, id, locale, slug });
}

export interface ListResult<T> {
  body: List<T>;
  lastModified: Date | null;
}

// ---------------------------------------------------------------------------------------------
// Posts

const pt = schema.postsTranslations;

const postColumns = {
  id: pt.entityId,
  locale: pt.locale,
  slug: pt.slug,
  title: pt.title,
  excerpt: pt.excerpt,
  publishedAt: pt.publishedAt,
  modifiedAt: pt.modifiedAt,
  updatedAt: pt.updatedAt,
  status: pt.status,
  seo: pt.seo,
  body: pt.body,
  keyTakeaways: pt.keyTakeaways,
  cover: schema.posts.cover,
  sharedUpdatedAt: schema.posts.updatedAt,
};

interface PostRow {
  id: string;
  locale: string;
  slug: string;
  title: string;
  excerpt: string;
  publishedAt: Date | null;
  modifiedAt: Date | null;
  updatedAt: Date;
  status: ContentStatus;
  seo: SeoFields;
  body: RichTextJson;
  keyTakeaways: string[];
  cover: string | null;
  sharedUpdatedAt: Date;
}

const newestFirst = [sql`${pt.publishedAt} desc nulls last`, desc(pt.entityId)];

/** Categories, tags and authors of posts in a language, in the editor's order. */
async function postLinks(ctx: DeliveryContext, locale: string, ids: readonly string[]) {
  const cl = schema.postCategoryLinks;
  const ct = schema.postCategoriesTranslations;
  const tl = schema.postTagLinks;
  const tt = schema.tagsTranslations;
  const al = schema.postAuthorLinks;
  const at = schema.authorsTranslations;
  const [categories, tags, authors] = await Promise.all([
    ctx.db
      .select({ postId: cl.postId, id: ct.entityId, slug: ct.slug, name: ct.name })
      .from(cl)
      .innerJoin(ct, and(eq(ct.entityId, cl.categoryId), eq(ct.locale, locale)))
      .where(inArray(cl.postId, [...ids]))
      .orderBy(asc(cl.sortOrder)),
    ctx.db
      .select({ postId: tl.postId, id: tt.entityId, slug: tt.slug, name: tt.name })
      .from(tl)
      .innerJoin(tt, and(eq(tt.entityId, tl.tagId), eq(tt.locale, locale)))
      .where(inArray(tl.postId, [...ids]))
      .orderBy(asc(tl.sortOrder)),
    ctx.db
      .select({
        postId: al.postId,
        id: at.entityId,
        slug: at.slug,
        name: at.name,
        avatar: schema.authors.avatar,
        publicPage: schema.authors.publicPage,
      })
      .from(al)
      .innerJoin(schema.authors, eq(schema.authors.id, al.authorId))
      .innerJoin(at, and(eq(at.entityId, al.authorId), eq(at.locale, locale)))
      .where(inArray(al.postId, [...ids]))
      .orderBy(asc(al.sortOrder)),
  ]);
  await ctx.media.load(authors.map((a) => a.avatar));
  const byPost = <T extends { postId: string }, R>(rows: T[], map: (row: T) => R) => {
    const result = new Map<string, R[]>();
    for (const row of rows) result.set(row.postId, [...(result.get(row.postId) ?? []), map(row)]);
    return result;
  };
  return {
    categories: byPost(categories, (c): TermRef => ({
      id: c.id,
      slug: c.slug,
      name: c.name,
      path: pathOf(ctx, 'postCategory', locale, c.id, c.slug),
    })),
    tags: byPost(tags, (t): TermRef => ({
      id: t.id,
      slug: t.slug,
      name: t.name,
      path: pathOf(ctx, 'tag', locale, t.id, t.slug),
    })),
    authors: byPost(authors, (a): AuthorRef => ({
      id: a.id,
      slug: a.slug,
      name: a.name,
      path: a.publicPage ? pathOf(ctx, 'author', locale, a.id, a.slug) : null,
      avatar: ctx.media.get(a.avatar),
    })),
  };
}

async function summaries(ctx: DeliveryContext, rows: readonly PostRow[]): Promise<PostSummary[]> {
  if (rows.length === 0) return [];
  const locale = rows[0]!.locale;
  const links = await postLinks(
    ctx,
    locale,
    rows.map((r) => r.id),
  );
  await ctx.media.load(rows.map((r) => r.cover));
  return rows.map((row) => ({
    id: row.id,
    locale: row.locale,
    slug: row.slug,
    path: pathOf(ctx, 'post', row.locale, row.id, row.slug),
    title: row.title,
    excerpt: row.excerpt,
    cover: ctx.media.get(row.cover),
    publishedAt: iso(row.publishedAt),
    modifiedAt: iso(row.modifiedAt),
    categories: links.categories.get(row.id) ?? [],
    tags: links.tags.get(row.id) ?? [],
    authors: links.authors.get(row.id) ?? [],
  }));
}

function postQuery(ctx: DeliveryContext) {
  return ctx.db
    .select(postColumns)
    .from(pt)
    .innerJoin(schema.posts, eq(schema.posts.id, pt.entityId));
}

/** Published posts in a language: picked IDs in their order, or the newest of a category. */
export async function publishedPostSummaries(
  ctx: DeliveryContext,
  locale: string,
  options: { ids?: readonly string[]; categoryId?: string | null; limit: number },
): Promise<PostSummary[]> {
  const where: SQL[] = [eq(pt.locale, locale), eq(pt.status, 'published')];
  if (options.ids) {
    if (options.ids.length === 0) return [];
    where.push(inArray(pt.entityId, [...options.ids]));
  }
  if (options.categoryId)
    where.push(inCategory(eq(schema.postCategoryLinks.categoryId, options.categoryId)));
  const rows = await postQuery(ctx)
    .where(and(...where))
    .orderBy(...newestFirst)
    .limit(options.limit);
  const ordered = options.ids
    ? options.ids.flatMap((id) => rows.find((r) => r.id === id) ?? [])
    : rows;
  return summaries(ctx, ordered);
}

function inCategory(condition: SQL): SQL {
  const l = schema.postCategoryLinks;
  return exists(sql`(select 1 from ${l} where ${l.postId} = ${pt.entityId} and ${condition})`);
}

/** A filter on a category, tag or author slug in the request's language. */
function linkedTo(
  link:
    typeof schema.postCategoryLinks | typeof schema.postTagLinks | typeof schema.postAuthorLinks,
  linkColumn: SQL,
  translations:
    | typeof schema.postCategoriesTranslations
    | typeof schema.tagsTranslations
    | typeof schema.authorsTranslations,
  locale: string,
  slug: string,
): SQL {
  return exists(
    sql`(select 1 from ${link} join ${translations} on ${translations.entityId} = ${linkColumn} where ${link.postId} = ${pt.entityId} and ${translations.locale} = ${locale} and ${translations.slug} = ${slug})`,
  );
}

/** `GET /posts`: published posts in a language, newest first, optionally of a category, tag or author. */
export async function listPosts(
  ctx: DeliveryContext,
  params: URLSearchParams,
): Promise<ListResult<PostSummary>> {
  const locale = requestLocale(ctx, params.get('locale'));
  const { page, pageSize, offset } = pagination(params);
  const where: SQL[] = [eq(pt.locale, locale), eq(pt.status, 'published')];
  const category = slugParam(params.get('category'));
  const tag = slugParam(params.get('tag'));
  const author = slugParam(params.get('author'));
  if (category) {
    const l = schema.postCategoryLinks;
    where.push(
      linkedTo(l, sql`${l.categoryId}`, schema.postCategoriesTranslations, locale, category),
    );
  }
  if (tag) {
    const l = schema.postTagLinks;
    where.push(linkedTo(l, sql`${l.tagId}`, schema.tagsTranslations, locale, tag));
  }
  if (author) {
    const l = schema.postAuthorLinks;
    where.push(linkedTo(l, sql`${l.authorId}`, schema.authorsTranslations, locale, author));
  }
  const [total] = await ctx.db
    .select({ n: count(), latest: max(pt.updatedAt) })
    .from(pt)
    .where(and(...where));
  const rows = await postQuery(ctx)
    .where(and(...where))
    .orderBy(...newestFirst)
    .limit(pageSize)
    .offset(offset);
  return {
    body: { items: await summaries(ctx, rows), page, pageSize, total: total?.n ?? 0 },
    lastModified: total?.latest ?? null,
  };
}

/** The full post of a language version (published, or any status for previews). */
export async function postBody(
  ctx: DeliveryContext,
  row: PostRow,
  options: { preview?: boolean } = {},
): Promise<Post> {
  const [summary] = await summaries(ctx, [row]);
  const bodyMedia = richTextMedia(row.body as never);
  await ctx.media.load([...bodyMedia, row.seo.ogImage]);
  const alternates = (await addressesOf(ctx.db, ctx.routing, 'post', [row.id])).get(row.id)!;
  if (options.preview) alternates[row.locale] ??= summary!.path;
  const publishers = new PublisherCache(ctx);
  const { baseUrl } = ctx.config.frontend;
  const seo = await buildSeo(ctx, publishers, {
    type: 'post',
    locale: row.locale,
    path: summary!.path,
    alternates,
    title: row.title,
    description: row.excerpt,
    seo: row.seo,
    image: firstImage([
      ctx.media.get(row.seo.ogImage),
      summary!.cover,
      ...bodyMedia.map((id) => ctx.media.get(id)),
    ]),
    noindex: options.preview,
    jsonLd: ({ canonical, image }) =>
      compact({
        '@type': 'BlogPosting',
        headline: row.title,
        description: row.seo.metaDescription || row.excerpt || undefined,
        image: image ? [image.url] : undefined,
        datePublished: iso(row.publishedAt) ?? undefined,
        dateModified: iso(row.modifiedAt ?? row.publishedAt) ?? undefined,
        author: summary!.authors.map((a) =>
          compact({
            '@type': 'Person',
            name: a.name,
            url: a.path ? absoluteUrl(baseUrl, a.path) : undefined,
          }),
        ),
        mainEntityOfPage: canonical,
        keywords: row.seo.keywords.length > 0 ? row.seo.keywords.join(', ') : undefined,
        articleSection: summary!.categories[0]?.name,
      }),
  });
  return {
    ...summary!,
    body: row.body as unknown as Record<string, unknown>,
    bodyHtml: richTextHtml(row.body, (id) => ctx.media.get(id), row.locale),
    keyTakeaways: row.keyTakeaways,
    media: ctx.media.map(bodyMedia),
    seo,
  };
}

/** `GET /posts/{slug}`. */
export async function getPost(ctx: DeliveryContext, slug: string, params: URLSearchParams) {
  const locale = requestLocale(ctx, params.get('locale'));
  const [row] = await postQuery(ctx).where(
    and(eq(pt.locale, locale), eq(pt.slug, slug), eq(pt.status, 'published')),
  );
  if (!row) throw notFound('post');
  const lastModified = row.updatedAt > row.sharedUpdatedAt ? row.updatedAt : row.sharedUpdatedAt;
  return { body: await postBody(ctx, row), lastModified };
}

/** A post language version by ID in any status, for previews. */
export async function postForPreview(ctx: DeliveryContext, id: string, locale: string) {
  const [row] = await postQuery(ctx).where(and(eq(pt.entityId, id), eq(pt.locale, locale)));
  return row ? { status: row.status, post: await postBody(ctx, row, { preview: true }) } : null;
}

// ---------------------------------------------------------------------------------------------
// Categories and tags

type TermKind = 'postCategory' | 'tag';

/** `GET /post-categories` and `GET /tags`: in the editor's order or by name; `slug` picks one. */
export async function listTerms(
  ctx: DeliveryContext,
  kind: TermKind,
  params: URLSearchParams,
): Promise<ListResult<Term>> {
  const locale = requestLocale(ctx, params.get('locale'));
  const { page, pageSize, offset } = pagination(params);
  const slug = slugParam(params.get('slug'));
  const t = kind === 'tag' ? schema.tagsTranslations : schema.postCategoriesTranslations;
  const where = and(eq(t.locale, locale), slug ? eq(t.slug, slug) : undefined);
  const [total] = await ctx.db
    .select({ n: count(), latest: max(t.updatedAt) })
    .from(t)
    .where(where);
  const columns = {
    id: t.entityId,
    slug: t.slug,
    name: t.name,
    description: t.description,
    seo: t.seo,
  };
  const rows =
    kind === 'tag'
      ? await ctx.db
          .select(columns)
          .from(t)
          .where(where)
          .orderBy(asc(t.name), asc(t.entityId))
          .limit(pageSize)
          .offset(offset)
      : await ctx.db
          .select(columns)
          .from(t)
          .innerJoin(schema.postCategories, eq(schema.postCategories.id, t.entityId))
          .where(where)
          .orderBy(asc(schema.postCategories.sortOrder), asc(t.name), asc(t.entityId))
          .limit(pageSize)
          .offset(offset);
  const alternates = await addressesOf(
    ctx.db,
    ctx.routing,
    kind,
    rows.map((r) => r.id),
  );
  await ctx.media.load(rows.map((r) => r.seo.ogImage));
  const publishers = new PublisherCache(ctx);
  const items: Term[] = [];
  for (const row of rows) {
    const path = pathOf(ctx, kind, locale, row.id, row.slug);
    items.push({
      id: row.id,
      locale,
      slug: row.slug,
      name: row.name,
      description: row.description,
      path,
      seo: await buildSeo(ctx, publishers, {
        type: kind,
        locale,
        path,
        alternates: alternates.get(row.id)!,
        title: row.name,
        description: row.description,
        seo: row.seo,
        image: firstImage([ctx.media.get(row.seo.ogImage)]),
        jsonLd: () =>
          compact({
            '@type': 'CollectionPage',
            name: row.name,
            description: row.seo.metaDescription || row.description || undefined,
            isPartOf: websiteNode(ctx, locale),
          }),
      }),
    });
  }
  return {
    body: { items, page, pageSize, total: total?.n ?? 0 },
    lastModified: total?.latest ?? null,
  };
}

// ---------------------------------------------------------------------------------------------
// Authors

const aut = schema.authorsTranslations;

async function authorItems(
  ctx: DeliveryContext,
  locale: string,
  where: SQL | undefined,
  page: { limit: number; offset: number },
) {
  const rows = await ctx.db
    .select({
      id: aut.entityId,
      slug: aut.slug,
      name: aut.name,
      jobTitle: aut.jobTitle,
      bio: aut.bio,
      seo: aut.seo,
      avatar: schema.authors.avatar,
      sameAs: schema.authors.sameAs,
    })
    .from(aut)
    .innerJoin(schema.authors, eq(schema.authors.id, aut.entityId))
    .where(where)
    .orderBy(asc(aut.name), asc(aut.entityId))
    .limit(page.limit)
    .offset(page.offset);
  await ctx.media.load(rows.flatMap((r) => [r.avatar, r.seo.ogImage]));
  const alternates = await addressesOf(
    ctx.db,
    ctx.routing,
    'author',
    rows.map((r) => r.id),
  );
  const publishers = new PublisherCache(ctx);
  const { baseUrl } = ctx.config.frontend;
  const items: Author[] = [];
  for (const row of rows) {
    const path = pathOf(ctx, 'author', locale, row.id, row.slug);
    const avatar: Media | null = ctx.media.get(row.avatar);
    items.push({
      id: row.id,
      locale,
      slug: row.slug,
      name: row.name,
      jobTitle: row.jobTitle,
      bio: row.bio,
      avatar,
      sameAs: row.sameAs,
      path,
      seo: await buildSeo(ctx, publishers, {
        type: 'author',
        locale,
        path,
        alternates: alternates.get(row.id)!,
        title: row.name,
        description: row.bio,
        seo: row.seo,
        image: firstImage([ctx.media.get(row.seo.ogImage), avatar]),
        jsonLd: () => ({
          '@type': 'ProfilePage',
          mainEntity: compact({
            '@type': 'Person',
            name: row.name,
            jobTitle: row.jobTitle || undefined,
            description: row.bio || undefined,
            image: avatar?.url,
            sameAs: row.sameAs.length > 0 ? row.sameAs : undefined,
            url: absoluteUrl(baseUrl, path),
          }),
        }),
      }),
    });
  }
  return items;
}

/** Authors exist on the frontend only with a public author page (chapter 6). */
const publicAuthors = (locale: string) =>
  and(eq(aut.locale, locale), eq(schema.authors.publicPage, true));

/** `GET /authors`: authors with a public author page in a language, by name. */
export async function listAuthors(
  ctx: DeliveryContext,
  params: URLSearchParams,
): Promise<ListResult<Author>> {
  const locale = requestLocale(ctx, params.get('locale'));
  const { page, pageSize, offset } = pagination(params);
  const [total] = await ctx.db
    .select({ n: count(), latest: max(aut.updatedAt) })
    .from(aut)
    .innerJoin(schema.authors, eq(schema.authors.id, aut.entityId))
    .where(publicAuthors(locale));
  const items = await authorItems(ctx, locale, publicAuthors(locale), { limit: pageSize, offset });
  return {
    body: { items, page, pageSize, total: total?.n ?? 0 },
    lastModified: total?.latest ?? null,
  };
}

/** `GET /authors/{slug}`. */
export async function getAuthor(ctx: DeliveryContext, slug: string, params: URLSearchParams) {
  const locale = requestLocale(ctx, params.get('locale'));
  const [item] = await authorItems(ctx, locale, and(publicAuthors(locale), eq(aut.slug, slug)), {
    limit: 1,
    offset: 0,
  });
  if (!item) throw notFound('author');
  return { body: item, lastModified: null };
}
