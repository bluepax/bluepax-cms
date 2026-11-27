// `GET /pages/{slug}` (docs/spec/README.md chapter 6; docs/adr/0009, 0012): a published block page
// in one language. Block `data` stays exactly as the block JSON Schema describes it; what the CMS
// derives sits next to it: the safe HTML of rich text fields and the posts of post blocks. Media
// referenced by blocks and rich text come once, in `media`, by ID. Blocks this instance no longer
// offers are left out, features of switched-off modules get their "off" value (chapter 3).
import {
  BLOCK_FEATURES,
  blockMedia,
  blockSchemas,
  isBlockKey,
  type BlockContent,
} from '@bluepax/cms-blocks';
import { schema, type ContentStatus, type SeoFields } from '@bluepax/db';
import { and, asc, eq } from 'drizzle-orm';
import { addressesOf, entryPath } from '../content/routes.ts';
import { log } from '../log.ts';
import { blockOffer } from '../modules/pages/blocks.ts';
import type { DeliveredBlock, Page } from '@bluepax/cms-client/contract';
import { iso, notFound, requestLocale, type DeliveryContext } from './context.ts';
import { richTextHtml } from './html.ts';
import { compact, publishedPostSummaries } from './posts.ts';
import { buildSeo, firstImage, PublisherCache, websiteNode } from './seo.ts';

const t = schema.pagesTranslations;

interface PageRow {
  id: string;
  translationId: string;
  locale: string;
  slug: string;
  title: string;
  status: ContentStatus;
  publishedAt: Date | null;
  updatedAt: Date;
  seo: SeoFields;
  isHome: boolean;
}

function pageQuery(ctx: DeliveryContext) {
  return ctx.db
    .select({
      id: t.entityId,
      translationId: t.id,
      locale: t.locale,
      slug: t.slug,
      title: t.title,
      status: t.status,
      publishedAt: t.publishedAt,
      updatedAt: t.updatedAt,
      seo: t.seo,
      isHome: schema.pages.isHome,
    })
    .from(t)
    .innerJoin(schema.pages, eq(schema.pages.id, t.entityId));
}

/** The blocks of a language version that this instance offers, in their current schema form. */
async function offeredBlocks(
  ctx: DeliveryContext,
  row: PageRow,
): Promise<(BlockContent & { id: string })[]> {
  const stored = await ctx.db
    .select()
    .from(schema.pageBlocks)
    .where(eq(schema.pageBlocks.translationId, row.translationId))
    .orderBy(asc(schema.pageBlocks.sortOrder));
  const offer = blockOffer(ctx.config, ctx.registry, ctx.active);
  const blocks: (BlockContent & { id: string })[] = [];
  for (const block of stored) {
    if (!isBlockKey(block.type) || !offer.blocks.includes(block.type)) continue;
    const parsed = blockSchemas[block.type].safeParse(block.data);
    if (!parsed.success) {
      log('warn', 'stored block does not match its schema, left out', {
        blockId: block.id,
        type: block.type,
      });
      continue;
    }
    const data = { ...parsed.data } as Record<string, unknown>;
    for (const [field, feature] of Object.entries(BLOCK_FEATURES[block.type] ?? {})) {
      if (!offer.modules.has(feature.module)) data[field] = feature.off;
    }
    blocks.push({ id: block.id, type: block.type, data } as BlockContent & { id: string });
  }
  return blocks;
}

async function deliverBlock(
  ctx: DeliveryContext,
  locale: string,
  block: BlockContent & { id: string },
): Promise<DeliveredBlock> {
  const delivered: DeliveredBlock = {
    id: block.id,
    type: block.type,
    data: block.data as unknown as Record<string, unknown>,
    html: {},
  };
  const media = (id: string) => ctx.media.get(id);
  switch (block.type) {
    case 'text-media':
    case 'rich-text':
      delivered.html.body = richTextHtml(block.data.body, media, locale);
      break;
    case 'featured-posts':
      delivered.posts = await publishedPostSummaries(ctx, locale, {
        ...(block.data.mode === 'manual'
          ? { ids: block.data.postIds }
          : { categoryId: block.data.categoryId }),
        limit: block.data.mode === 'manual' ? block.data.postIds.length : block.data.limit,
      });
      break;
    case 'latest-posts':
      delivered.posts = await publishedPostSummaries(ctx, locale, {
        categoryId: block.data.categoryId,
        limit: block.data.limit,
      });
      break;
    default:
      break;
  }
  return delivered;
}

/** The delivered page of a language version (published, or any status for previews). */
export async function pageBody(
  ctx: DeliveryContext,
  row: PageRow,
  options: { preview?: boolean } = {},
): Promise<Page> {
  const blocks = await offeredBlocks(ctx, row);
  const mediaIds = blocks.flatMap((block) => blockMedia(block).map((ref) => ref.mediaId));
  await ctx.media.load([...mediaIds, row.seo.ogImage]);
  const delivered: DeliveredBlock[] = [];
  for (const block of blocks) delivered.push(await deliverBlock(ctx, row.locale, block));
  const route = row.isHome ? 'home' : 'page';
  const path = entryPath(ctx.routing.templates, {
    type: 'page',
    route,
    id: row.id,
    locale: row.locale,
    slug: row.slug,
  });
  const alternates = (await addressesOf(ctx.db, ctx.routing, 'page', [row.id])).get(row.id)!;
  if (options.preview) alternates[row.locale] ??= path;
  const seo = await buildSeo(ctx, new PublisherCache(ctx), {
    type: 'page',
    locale: row.locale,
    path,
    alternates,
    title: row.title,
    description: row.seo.summary,
    seo: row.seo,
    image: firstImage([ctx.media.get(row.seo.ogImage), ...mediaIds.map((id) => ctx.media.get(id))]),
    noindex: options.preview,
    jsonLd: ({ image }) =>
      compact({
        '@type': 'WebPage',
        name: row.title,
        description: row.seo.metaDescription || row.seo.summary || undefined,
        isPartOf: websiteNode(ctx, row.locale),
        primaryImageOfPage: image ? { '@type': 'ImageObject', url: image.url } : undefined,
        datePublished: iso(row.publishedAt) ?? undefined,
        dateModified: row.updatedAt.toISOString(),
      }),
  });
  return {
    id: row.id,
    locale: row.locale,
    slug: row.slug,
    path,
    isHome: row.isHome,
    title: row.title,
    publishedAt: iso(row.publishedAt),
    updatedAt: row.updatedAt.toISOString(),
    blocks: delivered,
    media: ctx.media.map(mediaIds),
    seo,
  };
}

/** `GET /pages/{slug}`: the home page is found by its own slug too. */
export async function getPage(ctx: DeliveryContext, slug: string, params: URLSearchParams) {
  const locale = requestLocale(ctx, params.get('locale'));
  const [row] = await pageQuery(ctx).where(
    and(eq(t.locale, locale), eq(t.slug, slug), eq(t.status, 'published')),
  );
  if (!row) throw notFound('page');
  return { body: await pageBody(ctx, row), lastModified: row.updatedAt };
}

/** A page language version by ID in any status, for previews. */
export async function pageForPreview(ctx: DeliveryContext, id: string, locale: string) {
  const [row] = await pageQuery(ctx).where(and(eq(t.entityId, id), eq(t.locale, locale)));
  return row ? { status: row.status, page: await pageBody(ctx, row, { preview: true }) } : null;
}
