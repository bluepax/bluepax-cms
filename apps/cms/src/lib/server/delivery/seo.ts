// The `seo` object of routable content (docs/spec/README.md chapters 3 and 6, docs/adr/0012):
// title, description, canonical, robots, OG with the fallbacks filled in, hreflang and JSON-LD
// with the publisher of chapter 2 ("发布者"). The global defaults (default OG text and share
// image) belong to the `seo` module (M2); until then the fallbacks end at the content itself.
import { schema, type SeoFields } from '@bluepax/db';
import { absoluteUrl, routePath } from '@bluepax/presets';
import { and, eq } from 'drizzle-orm';
import { entryPath, type RoutableType } from '../content/routes.ts';
import { readSiteData } from '../modules/site/settings.ts';
import type { Media, OgImage, Publisher, Seo } from '@bluepax/cms-client/contract';
import type { DeliveryContext } from './context.ts';
import { ogImageOf } from './media.ts';

export function robotsValue(robots: { index: boolean; follow: boolean }): string {
  return `${robots.index ? 'index' : 'noindex'}, ${robots.follow ? 'follow' : 'nofollow'}`;
}

/** `zh-CN` → `zh_CN`, the form `og:locale` uses. */
export function ogLocale(locale: string): string {
  return locale.replace(/-/g, '_');
}

/** The first of the candidates that is an image (chapter 3: OG image → cover or first image). */
export function firstImage(candidates: readonly (Media | null)[]): Media | null {
  return candidates.find((m) => m?.kind === 'image') ?? null;
}

// ---------------------------------------------------------------------------------------------
// Publisher (chapter 2, "发布者")

/**
 * The publisher in a language: Organization — the configured name or the site name, its own
 * logo or else the site logo; Person with a main author — that author's display name, avatar,
 * sameAs and author page; Person without one — the configured name or the site name, sameAs and
 * the avatar of the site settings.
 */
export async function resolvePublisher(ctx: DeliveryContext, locale: string): Promise<Publisher> {
  const { site, frontend } = ctx.config;
  const stored = await readSiteData(ctx.db, 'site.publisher');
  const name = site.publisher.name || site.name;
  if (site.publisher.type === 'organization') {
    const branding = await readSiteData(ctx.db, 'site.branding');
    return {
      type: 'organization',
      name,
      sameAs: site.publisher.sameAs,
      image: (await ctx.media.one(stored.image)) ?? (await ctx.media.one(branding.logo)),
      url: frontend.baseUrl,
      authorId: null,
    };
  }
  if (stored.authorId) {
    const [author] = await ctx.db
      .select({
        avatar: schema.authors.avatar,
        sameAs: schema.authors.sameAs,
        publicPage: schema.authors.publicPage,
      })
      .from(schema.authors)
      .where(eq(schema.authors.id, stored.authorId));
    if (author) {
      const t = schema.authorsTranslations;
      const [translation] = await ctx.db
        .select({ name: t.name, slug: t.slug })
        .from(t)
        .where(and(eq(t.entityId, stored.authorId), eq(t.locale, locale)));
      const page =
        translation && author.publicPage
          ? absoluteUrl(
              frontend.baseUrl,
              entryPath(ctx.routing.templates, {
                type: 'author',
                route: 'author',
                id: stored.authorId,
                locale,
                slug: translation.slug,
              }),
            )
          : null;
      return {
        type: 'person',
        name: translation?.name || name,
        sameAs: author.sameAs,
        image: await ctx.media.one(author.avatar),
        url: page ?? frontend.baseUrl,
        authorId: stored.authorId,
      };
    }
  }
  return {
    type: 'person',
    name,
    sameAs: site.publisher.sameAs,
    image: await ctx.media.one(stored.image),
    url: frontend.baseUrl,
    authorId: null,
  };
}

/** The publisher as a schema.org node. */
export function publisherJsonLd(publisher: Publisher): Record<string, unknown> {
  const image = publisher.image;
  const node: Record<string, unknown> = {
    '@type': publisher.type === 'organization' ? 'Organization' : 'Person',
    name: publisher.name,
  };
  if (publisher.url) node.url = publisher.url;
  if (image) {
    if (publisher.type === 'organization') {
      node.logo = {
        '@type': 'ImageObject',
        url: image.url,
        width: image.width,
        height: image.height,
      };
    } else {
      node.image = image.url;
    }
  }
  if (publisher.sameAs.length > 0) node.sameAs = publisher.sameAs;
  return node;
}

/** Publishers are the same for every item of a response; resolved once per language. */
export class PublisherCache {
  readonly #ctx: DeliveryContext;
  readonly #byLocale = new Map<string, Promise<Publisher>>();

  constructor(ctx: DeliveryContext) {
    this.#ctx = ctx;
  }

  get(locale: string): Promise<Publisher> {
    let value = this.#byLocale.get(locale);
    if (!value) {
      value = resolvePublisher(this.#ctx, locale);
      this.#byLocale.set(locale, value);
    }
    return value;
  }
}

// ---------------------------------------------------------------------------------------------
// The seo object

export interface SeoInput {
  type: RoutableType;
  locale: string;
  /** The content's own address. */
  path: string;
  /** Addresses of the published languages (route templates). */
  alternates: Record<string, string>;
  /** Title or name of the content. */
  title: string;
  /** Used when the meta description is empty, e.g. a post's excerpt. */
  description: string;
  seo: SeoFields;
  /** The OG image after the fallbacks (explicit, cover or first image). */
  image: Media | null;
  /** Forces `noindex, nofollow`, e.g. for previews. */
  noindex?: boolean;
  /** The schema.org node of the content; `url`, `inLanguage` and `publisher` are added. */
  jsonLd: (common: {
    canonical: string;
    image: OgImage | null;
    publisher: Record<string, unknown>;
  }) => Record<string, unknown>;
}

const OG_TYPES: Record<RoutableType, Seo['og']['type']> = {
  page: 'website',
  post: 'article',
  postCategory: 'website',
  tag: 'website',
  author: 'profile',
};

export async function buildSeo(
  ctx: DeliveryContext,
  publishers: PublisherCache,
  input: SeoInput,
): Promise<Seo> {
  const { baseUrl } = ctx.config.frontend;
  const canonical = input.seo.canonical || absoluteUrl(baseUrl, input.path);
  const title = input.seo.metaTitle || input.title;
  const description = input.seo.metaDescription || input.description;
  const image = ogImageOf(input.image, input.locale);
  const hreflang = Object.entries(input.alternates).map(([hreflang, path]) => ({
    hreflang,
    href: absoluteUrl(baseUrl, path),
  }));
  const primary = input.alternates[ctx.routing.primary];
  if (primary) hreflang.push({ hreflang: 'x-default', href: absoluteUrl(baseUrl, primary) });
  const publisher = publisherJsonLd(await publishers.get(input.locale));
  return {
    title,
    description,
    canonical,
    robots: input.noindex ? 'noindex, nofollow' : robotsValue(input.seo.robots),
    og: {
      type: OG_TYPES[input.type],
      title: input.seo.ogTitle || title,
      description: input.seo.ogDescription || description,
      url: canonical,
      siteName: ctx.config.site.name,
      locale: ogLocale(input.locale),
      image,
    },
    hreflang,
    keywords: input.seo.keywords,
    summary: input.seo.summary,
    jsonLd: {
      '@context': 'https://schema.org',
      ...input.jsonLd({ canonical, image, publisher }),
      url: canonical,
      inLanguage: input.locale,
      ...(input.type !== 'author' && { publisher }),
    },
  };
}

/** `isPartOf` of pages, categories and tags: the frontend's website in that language. */
export function websiteNode(ctx: DeliveryContext, locale: string): Record<string, unknown> {
  return {
    '@type': 'WebSite',
    name: ctx.config.site.name,
    url: absoluteUrl(
      ctx.config.frontend.baseUrl,
      routePath(ctx.routing.templates.home, { locale }),
    ),
  };
}

/** Media IDs of OG images set on a list of SEO values. */
export function ogImageIds(values: readonly SeoFields[]): string[] {
  return values.flatMap((v) => (v.ogImage ? [v.ogImage] : []));
}
