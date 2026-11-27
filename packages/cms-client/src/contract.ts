// The Delivery API contract (docs/spec/README.md chapter 6, docs/adr/0012, 0013): Zod schemas of
// every response, published as `@bluepax/cms-client/contract`. The CMS generates its OpenAPI 3.1
// document from them and parses real responses with them in its contract tests, and the client's
// types are inferred from them, so documentation, behaviour and SDK types share one source
// (chapter 12). Pure Zod, no server imports. Importing this module registers the schemas, with
// their `.meta({ id })`, in Zod's global registry.
import { z } from 'zod';

const isoDate = z.iso.datetime({ offset: true }).describe('ISO 8601, UTC');
const nullableDate = isoDate.nullable();
/** A frontend path from the route templates, e.g. `/en/blog/hello`. */
const path = z.string().describe('Frontend path from the route templates');

export const errorSchema = z
  .object({
    error: z.object({
      code: z.string(),
      message: z.string(),
      details: z.record(z.string(), z.unknown()).optional(),
    }),
  })
  .meta({ id: 'Error' });

export const mediaVariantSchema = z
  .object({
    name: z.string().describe('`w480`, `w960`, `w1600`, `og`, `favicon`, …'),
    url: z.url(),
    contentType: z.string(),
    width: z.int().nullable(),
    height: z.int().nullable(),
  })
  .meta({ id: 'MediaVariant' });

export const mediaSchema = z
  .object({
    id: z.uuid(),
    kind: z.enum(['image', 'video', 'document']),
    mimeType: z.string(),
    url: z.url().describe('Absolute URL at the current distribution origin'),
    width: z.int().nullable(),
    height: z.int().nullable(),
    size: z.int(),
    alt: z.record(z.string(), z.string()).describe('Alt text per content language'),
    variants: z.array(mediaVariantSchema),
  })
  .meta({ id: 'Media' });

export const ogImageSchema = z
  .object({
    url: z.url(),
    width: z.int().nullable(),
    height: z.int().nullable(),
    type: z.string(),
    alt: z.string(),
  })
  .meta({ id: 'OgImage' });

export const seoSchema = z
  .object({
    title: z.string(),
    description: z.string(),
    canonical: z.url(),
    robots: z.string().describe('e.g. `index, follow`'),
    og: z.object({
      type: z.enum(['website', 'article', 'profile']),
      title: z.string(),
      description: z.string(),
      url: z.url(),
      siteName: z.string(),
      locale: z.string().describe('e.g. `zh_CN`'),
      image: ogImageSchema.nullable(),
    }),
    hreflang: z.array(z.object({ hreflang: z.string(), href: z.url() })),
    keywords: z.array(z.string()),
    summary: z.string(),
    jsonLd: z.record(z.string(), z.unknown()).describe('schema.org JSON-LD, with `@context`'),
  })
  .meta({ id: 'Seo' });

export const termRefSchema = z
  .object({ id: z.uuid(), slug: z.string(), name: z.string(), path })
  .meta({ id: 'TermRef' });

export const authorRefSchema = z
  .object({
    id: z.uuid(),
    slug: z.string(),
    name: z.string(),
    path: path.nullable().describe('Null when the author has no public author page'),
    avatar: mediaSchema.nullable(),
  })
  .meta({ id: 'AuthorRef' });

export const postSummarySchema = z
  .object({
    id: z.uuid(),
    locale: z.string(),
    slug: z.string(),
    path,
    title: z.string(),
    excerpt: z.string(),
    cover: mediaSchema.nullable(),
    publishedAt: nullableDate,
    modifiedAt: nullableDate,
    categories: z.array(termRefSchema).describe('The first one is the main category'),
    tags: z.array(termRefSchema),
    authors: z.array(authorRefSchema),
  })
  .meta({ id: 'PostSummary' });

export const blockSchema = z
  .object({
    id: z.uuid(),
    type: z.string().describe('Block key; ignore unknown types'),
    data: z.record(z.string(), z.unknown()).describe('Follows the block JSON Schema'),
    html: z
      .record(z.string(), z.string())
      .describe('Safe HTML of the rich text fields of `data`, by field name'),
    posts: z
      .array(postSummarySchema)
      .optional()
      .describe('Posts a featured-posts or latest-posts block shows'),
  })
  .meta({ id: 'Block' });

const mediaMap = z
  .record(z.string(), mediaSchema)
  .describe('Media used by block data and rich text, by ID');

export const pageSchema = z
  .object({
    id: z.uuid(),
    locale: z.string(),
    slug: z.string(),
    path,
    isHome: z.boolean(),
    title: z.string(),
    publishedAt: nullableDate,
    updatedAt: isoDate,
    blocks: z.array(blockSchema),
    media: mediaMap,
    seo: seoSchema,
  })
  .meta({ id: 'Page' });

export const postSchema = postSummarySchema
  .extend({
    body: z.record(z.string(), z.unknown()).describe('Rich text JSON (see /schema/blocks)'),
    bodyHtml: z.string(),
    keyTakeaways: z.array(z.string()),
    media: mediaMap,
    seo: seoSchema,
  })
  .meta({ id: 'Post' });

export const termSchema = z
  .object({
    id: z.uuid(),
    locale: z.string(),
    slug: z.string(),
    name: z.string(),
    description: z.string(),
    path,
    seo: seoSchema,
  })
  .meta({ id: 'Term' });

export const authorSchema = z
  .object({
    id: z.uuid(),
    locale: z.string(),
    slug: z.string(),
    name: z.string(),
    jobTitle: z.string(),
    bio: z.string(),
    avatar: mediaSchema.nullable(),
    sameAs: z.array(z.url()),
    path,
    seo: seoSchema,
  })
  .meta({ id: 'Author' });

function listOf<T extends z.ZodType>(item: T, id: string) {
  return z
    .object({ items: z.array(item), page: z.int(), pageSize: z.int(), total: z.int() })
    .meta({ id });
}

export const postListSchema = listOf(postSummarySchema, 'PostList');
export const termListSchema = listOf(termSchema, 'TermList');
export const authorListSchema = listOf(authorSchema, 'AuthorList');

export interface NavItem {
  id: string;
  label: string;
  href: string | null;
  newTab: boolean;
  target: { type: 'page' | 'post' | 'postCategory'; id: string } | null;
  children: NavItem[];
}

export const navItemSchema: z.ZodType<NavItem> = z
  .object({
    id: z.uuid(),
    label: z.string(),
    href: z
      .string()
      .nullable()
      .describe('Path, URL, mailto: or tel:; null for a heading or a target without an address'),
    newTab: z.boolean(),
    target: z.object({ type: z.enum(['page', 'post', 'postCategory']), id: z.uuid() }).nullable(),
    get children() {
      return z.array(navItemSchema);
    },
  })
  .meta({ id: 'NavItem' });

export const publisherSchema = z
  .object({
    type: z.enum(['organization', 'person']),
    name: z.string(),
    sameAs: z.array(z.url()),
    image: mediaSchema.nullable().describe('Logo (Organization) or avatar (Person)'),
    url: z.url().nullable().describe('Author page of the main author, or the frontend'),
    authorId: z.uuid().nullable(),
  })
  .meta({ id: 'Publisher' });

const routeTemplates = z.object({
  home: z.string(),
  page: z.string(),
  post: z.string(),
  postCategory: z.string(),
  tag: z.string(),
  author: z.string(),
});

export const siteSchema = z
  .object({
    type: z.enum(['corporate', 'blog']),
    name: z.string(),
    locale: z.string().describe('The language of the texts in this response'),
    timezone: z.string(),
    languages: z.object({
      content: z.array(z.object({ code: z.string(), dir: z.enum(['ltr', 'rtl']) })),
      primary: z.string(),
    }),
    publisher: publisherSchema,
    legalEntities: z.array(
      z.object({
        id: z.uuid(),
        legalName: z.string(),
        role: z.string(),
        registrationNumber: z.string().nullable().describe('Null unless public'),
        taxId: z.string().nullable().describe('Null unless public'),
        email: z.string(),
        phone: z.string(),
        locations: z.array(
          z.object({
            id: z.uuid(),
            name: z.string(),
            address: z.object({ street: z.string(), locality: z.string(), region: z.string() }),
            postalCode: z.string(),
            country: z.string(),
            phone: z.string(),
            email: z.string(),
            latitude: z.number().nullable(),
            longitude: z.number().nullable(),
            openingHours: z.string(),
          }),
        ),
      }),
    ),
    contact: z.object({ email: z.string(), phone: z.string() }),
    social: z.array(z.object({ network: z.string(), url: z.url() })),
    im: z.object({ channel: z.string(), number: z.string(), text: z.string() }).nullable(),
    navigation: z.object({ header: z.array(navItemSchema), footer: z.array(navItemSchema) }),
    footer: z.object({ text: z.string() }),
    branding: z.object({
      logo: mediaSchema.nullable(),
      icon: mediaSchema.nullable().describe('Site icon with favicon, Apple Touch and PWA variants'),
      themeColor: z.string(),
    }),
    modules: z.array(z.string()).describe('Active modules, core and optional'),
    frontend: z.object({
      baseUrl: z.url(),
      routes: routeTemplates,
      reservedSlugs: z.array(z.string()),
    }),
    mediaOrigin: z.object({ driver: z.string(), baseUrl: z.url() }),
  })
  .meta({ id: 'Site' });

export const resolutionSchema = z
  .discriminatedUnion('status', [
    z.object({
      status: z.literal(200),
      type: z.enum(['page', 'post', 'postCategory', 'tag', 'author']),
      route: z.enum(['home', 'page', 'post', 'postCategory', 'tag', 'author']),
      id: z.uuid(),
      locale: z.string(),
      slug: z.string(),
      path,
      alternates: z.record(z.string(), path).describe('Address per published language'),
    }),
    z.object({ status: z.literal(301), location: path }),
    z.object({ status: z.literal(404) }),
  ])
  .meta({ id: 'Resolution' });

export const blockSchemasSchema = z
  .object({
    richText: z.record(z.string(), z.unknown()),
    blocks: z.record(z.string(), z.record(z.string(), z.unknown())),
  })
  .meta({ id: 'BlockSchemas' });

const previewMeta = {
  expiresAt: isoDate,
  status: z.enum(['draft', 'in_review', 'published', 'unpublished']),
};

export const previewSchema = z
  .discriminatedUnion('type', [
    z.object({ type: z.literal('page'), ...previewMeta, page: pageSchema }),
    z.object({ type: z.literal('post'), ...previewMeta, post: postSchema }),
  ])
  .meta({ id: 'Preview' });

export type ErrorBody = z.infer<typeof errorSchema>;
export type Media = z.infer<typeof mediaSchema>;
export type MediaVariant = z.infer<typeof mediaVariantSchema>;
export type OgImage = z.infer<typeof ogImageSchema>;
export type Seo = z.infer<typeof seoSchema>;
export type TermRef = z.infer<typeof termRefSchema>;
export type AuthorRef = z.infer<typeof authorRefSchema>;
export type PostSummary = z.infer<typeof postSummarySchema>;
export type DeliveredBlock = z.infer<typeof blockSchema>;
export type Page = z.infer<typeof pageSchema>;
export type Post = z.infer<typeof postSchema>;
export type Term = z.infer<typeof termSchema>;
export type Author = z.infer<typeof authorSchema>;
export type Publisher = z.infer<typeof publisherSchema>;
export type Site = z.infer<typeof siteSchema>;
export type Resolution = z.infer<typeof resolutionSchema>;
export type Preview = z.infer<typeof previewSchema>;
export type BlockSchemas = z.infer<typeof blockSchemasSchema>;
export type PostList = z.infer<typeof postListSchema>;
export type TermList = z.infer<typeof termListSchema>;
export type AuthorList = z.infer<typeof authorListSchema>;
export interface List<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
}
