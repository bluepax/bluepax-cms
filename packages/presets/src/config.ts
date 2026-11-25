// Instance configuration (docs/spec/README.md chapter 2, "实例配置项"): the YAML file in a
// site's deployment repository and the admin settings are the same data. A config file can
// initialise an empty instance unattended, and an instance can export its settings back.
// Sections for modules that are not built yet (routes, catalog, inquiries, ...) are added
// together with those modules; unknown keys are rejected so typos never pass silently.
import { isSlug, OPTIONAL_MODULES, type OptionalModuleId } from '@bluepax/core';
import { parse, stringify } from 'yaml';
import { z } from 'zod';
import { BLOCK_KEYS } from './blocks.ts';

export const CONFIG_VERSION = 1;
export const SITE_TYPES = ['corporate', 'blog'] as const;
export const ADMIN_LOCALES = ['zh', 'en'] as const;
/** Defaults of chapter 13: media cache 365 days; uploads 20 MB images, 50 MB documents, 200 MB videos. */
export const DEFAULT_CACHE_DAYS = 365;
export const DEFAULT_UPLOAD_LIMITS_MB = { image: 20, document: 50, video: 200 } as const;
/** Upper bound for the configurable upload limits; uploads are held in memory while processed. */
export const UPLOAD_LIMIT_MAX_MB = 1024;
/** JSON-LD publisher: Organization (corporate default) or Person (blog default). */
export const PUBLISHER_TYPES = ['organization', 'person'] as const;

export type SiteType = (typeof SITE_TYPES)[number];
export type AdminLocale = (typeof ADMIN_LOCALES)[number];
export type PublisherType = (typeof PUBLISHER_TYPES)[number];

/** Canonical BCP 47 form of a language tag (`zh-cn` → `zh-CN`), or null if it is not one. */
export function canonicalLocale(value: string): string | null {
  try {
    const [canonical] = Intl.getCanonicalLocales(value);
    return canonical ?? null;
  } catch {
    return null;
  }
}

/** Writing direction of a BCP 47 language, e.g. `rtl` for Arabic. */
export function textDirection(locale: string): 'ltr' | 'rtl' {
  const info = (
    new Intl.Locale(locale) as Intl.Locale & { getTextInfo?: () => { direction?: string } }
  ).getTextInfo?.();
  return info?.direction === 'rtl' ? 'rtl' : 'ltr';
}

const locale = z.string().transform((value, ctx) => {
  const canonical = canonicalLocale(value);
  if (!canonical) {
    ctx.addIssue({ code: 'custom', message: `"${value}" is not a BCP 47 language tag` });
    return z.NEVER;
  }
  return canonical;
});

const timezone = z.string().refine((value) => {
  try {
    new Intl.DateTimeFormat('en', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}, 'must be an IANA time zone, e.g. Asia/Shanghai');

export const httpUrl = z.url({ protocol: /^https?$/, message: 'must be an http(s) URL' });

/**
 * Removes trailing slashes. A loop instead of `/\/+$/`, which backtracks quadratically on long
 * runs of slashes that do not end the string (CodeQL js/polynomial-redos).
 */
function withoutTrailingSlashes(value: string): string {
  let end = value.length;
  while (end > 0 && value.charCodeAt(end - 1) === 0x2f) end--;
  return value.slice(0, end);
}

const baseUrl = httpUrl.transform(withoutTrailingSlashes);

/** A slug of routable content, see `isSlug`. */
export const slug = z
  .string()
  .trim()
  .refine(isSlug, 'must be lowercase a-z, 0-9 and single hyphens');

/** The `frontend` section (chapter 2, "前台"). Route templates follow with their own item. */
export const frontendConfigSchema = z.strictObject({
  baseUrl,
  /**
   * Paths taken by fixed sections of the frontend; page and post slugs may not use them. The
   * fixed segments of the route templates (`blog`, `authors`, ...) are reserved on top.
   */
  reservedSlugs: z
    .array(slug)
    .max(200)
    .default([])
    .transform((values) => unique(values).sort()),
});

export type FrontendConfig = z.output<typeof frontendConfigSchema>;

/**
 * Lowercase key of an instant messaging channel or social network, e.g. `whatsapp`.
 * Not a fixed list: the frontend maps the key to its link format and icon.
 */
export const serviceKey = z
  .string()
  .trim()
  .regex(/^[a-z][a-z0-9-]{1,31}$/, 'must be a lowercase key such as whatsapp');

/** Instant messaging (chapter 8): one channel, its number and a prefilled text per language. */
const instantMessaging = z.strictObject({
  channel: serviceKey,
  /** Phone number or account name, in the form the channel expects. */
  number: z.string().trim().min(1).max(64),
  /** Prefilled message per content language; languages without a text are left out. */
  text: z.record(z.string(), z.string().trim().max(500)).default({}),
});

function unique<T>(values: readonly T[]): T[] {
  return [...new Set(values)];
}

const contentLanguage = z.strictObject({
  code: locale,
  /** Defaults to the language's own direction. */
  dir: z.enum(['ltr', 'rtl']).optional(),
});

/** The `storage` section (chapter 2, "存储"; chapter 5). */
export const storageConfigSchema = z.strictObject({
  /** R2 is added later in the admin (chapter 5); a fresh instance is local only. */
  mode: z.literal('local'),
  /** Media cache lifetime in days: `Cache-Control: max-age=<days × 86400>` (chapter 5). */
  cacheDays: z.int().min(1).max(3650).default(DEFAULT_CACHE_DAYS),
  /** Upload limits per kind of file in MB (chapter 13). */
  uploadLimitsMb: z
    .strictObject({
      image: z.int().min(1).max(UPLOAD_LIMIT_MAX_MB).default(DEFAULT_UPLOAD_LIMITS_MB.image),
      document: z.int().min(1).max(UPLOAD_LIMIT_MAX_MB).default(DEFAULT_UPLOAD_LIMITS_MB.document),
      video: z.int().min(1).max(UPLOAD_LIMIT_MAX_MB).default(DEFAULT_UPLOAD_LIMITS_MB.video),
    })
    .prefault({}),
});

export type StorageConfig = z.output<typeof storageConfigSchema>;

/** Longest name of a post category, as in the admin. */
export const CATEGORY_NAME_MAX_LENGTH = 200;

/**
 * A post category of the `posts` section: its name and slug per content language. `slug` may
 * be one slug for every named language. Descriptions and SEO fields are content, entered in
 * the admin, and not part of the configuration (docs/adr/0010).
 */
const postCategory = z.strictObject({
  name: z.record(z.string(), z.string().trim().max(CATEGORY_NAME_MAX_LENGTH)),
  slug: z.union([slug, z.record(z.string(), slug)]),
});

/**
 * The `posts` section (chapter 2, "文章：预置分类"): the post categories an instance starts with.
 * The export writes the current categories, so a fresh instance gets the same ones.
 */
export const postsConfigSchema = z
  .strictObject({ categories: z.array(postCategory).max(200).default([]) })
  .prefault({});

export interface PostCategorySeed {
  /** Name per content language, in the order of the content languages. */
  name: Record<string, string>;
  /** Slug per language; the same languages as `name`. */
  slug: Record<string, string>;
}

export const instanceConfigSchema = z
  .strictObject({
    version: z.literal(CONFIG_VERSION),
    site: z.strictObject({
      type: z.enum(SITE_TYPES),
      name: z.string().trim().min(1),
      /** Time zone used by the frontend to display dates. */
      timezone: timezone.default('UTC'),
      publisher: z.strictObject({
        type: z.enum(PUBLISHER_TYPES),
        /** Empty means the site name. The logo or avatar is site data (docs/adr/0008). */
        name: z.string().trim().max(200).default(''),
        /** Profiles of the publisher elsewhere (JSON-LD `sameAs`). */
        sameAs: z.array(httpUrl).default([]),
      }),
      /** Names the brand is known by, e.g. for brand-mention checks. */
      brandTerms: z.array(z.string().trim().min(1).max(100)).default([]),
      im: instantMessaging.nullable().default(null),
    }),
    languages: z.strictObject({
      content: z.array(contentLanguage).min(1),
      primary: locale,
      /** Default admin UI language, e.g. for new accounts. */
      admin: z.enum(ADMIN_LOCALES),
    }),
    frontend: frontendConfigSchema,
    modules: z.strictObject({
      /** Optional modules that are switched on; core modules are always on. */
      enabled: z.array(z.enum(OPTIONAL_MODULES)),
    }),
    blocks: z.strictObject({ available: z.array(z.enum(BLOCK_KEYS)).min(1) }),
    storage: storageConfigSchema,
    posts: postsConfigSchema,
  })
  .transform((config, ctx) => {
    const codes = config.languages.content.map((l) => l.code);
    if (new Set(codes).size !== codes.length) {
      ctx.addIssue({
        code: 'custom',
        path: ['languages', 'content'],
        message: 'languages must be unique',
      });
    }
    if (!codes.includes(config.languages.primary)) {
      ctx.addIssue({
        code: 'custom',
        path: ['languages', 'primary'],
        message: 'the primary language must be one of the content languages',
      });
    }
    let im = config.site.im;
    if (im) {
      const given = new Map<string, string>();
      for (const [key, value] of Object.entries(im.text)) {
        const code = canonicalLocale(key);
        if (!code || !codes.includes(code)) {
          ctx.addIssue({
            code: 'custom',
            path: ['site', 'im', 'text', key],
            message: 'must be one of the content languages',
          });
        } else if (value) given.set(code, value);
      }
      // Keys follow the order of the content languages so exports are stable.
      const text: Record<string, string> = {};
      for (const code of codes) {
        const value = given.get(code);
        if (value) text[code] = value;
      }
      im = { ...im, text };
    }
    const categories = postCategories(config.posts.categories, codes, ctx);
    return {
      ...config,
      site: {
        ...config.site,
        publisher: { ...config.site.publisher, sameAs: unique(config.site.publisher.sameAs) },
        brandTerms: unique(config.site.brandTerms),
        im,
      },
      languages: {
        ...config.languages,
        content: config.languages.content.map((l) => ({
          code: l.code,
          dir: l.dir ?? textDirection(l.code),
        })),
      },
      modules: { enabled: [...new Set(config.modules.enabled)].sort() as OptionalModuleId[] },
      blocks: { available: BLOCK_KEYS.filter((k) => config.blocks.available.includes(k)) },
      posts: { categories },
    };
  });

/**
 * Checks the post categories against the content languages: every named language needs a
 * slug, slugs are unique per language, and each category has a name in at least one language.
 */
function postCategories(
  input: readonly z.output<typeof postCategory>[],
  codes: readonly string[],
  ctx: z.RefinementCtx,
): PostCategorySeed[] {
  const taken = new Map<string, Set<string>>();
  return input.map((category, index) => {
    const path = ['posts', 'categories', index];
    const names = new Map<string, string>();
    for (const [key, value] of Object.entries(category.name)) {
      const code = canonicalLocale(key);
      if (!code || !codes.includes(code)) {
        ctx.addIssue({
          code: 'custom',
          path: [...path, 'name', key],
          message: 'must be one of the content languages',
        });
      } else if (value) names.set(code, value);
    }
    if (names.size === 0) {
      ctx.addIssue({
        code: 'custom',
        path: [...path, 'name'],
        message: 'needs a name in at least one content language',
      });
    }
    const slugs = new Map<string, string>();
    if (typeof category.slug === 'string') {
      for (const code of names.keys()) slugs.set(code, category.slug);
    } else {
      for (const [key, value] of Object.entries(category.slug)) {
        const code = canonicalLocale(key);
        if (!code || !names.has(code)) {
          ctx.addIssue({
            code: 'custom',
            path: [...path, 'slug', key],
            message: 'must be a language the category has a name in',
          });
        } else slugs.set(code, value);
      }
    }
    const result: PostCategorySeed = { name: {}, slug: {} };
    for (const code of codes) {
      const name = names.get(code);
      if (!name) continue;
      const value = slugs.get(code);
      if (!value) {
        ctx.addIssue({ code: 'custom', path: [...path, 'slug', code], message: 'is missing' });
        continue;
      }
      const used = taken.get(code) ?? new Set<string>();
      if (used.has(value)) {
        ctx.addIssue({
          code: 'custom',
          path: [...path, 'slug', code],
          message: `"${value}" is used by another category in this language`,
        });
      }
      used.add(value);
      taken.set(code, used);
      result.name[code] = name;
      result.slug[code] = value;
    }
    return result;
  });
}

export type InstanceConfigInput = z.input<typeof instanceConfigSchema>;
export type InstanceConfig = z.output<typeof instanceConfigSchema>;

export class ConfigError extends Error {
  override name = 'ConfigError';
  readonly issues: string[];

  constructor(issues: string[]) {
    super(`invalid instance configuration:\n${issues.map((i) => `  - ${i}`).join('\n')}`);
    this.issues = issues;
  }
}

export function validateConfig(input: unknown): InstanceConfig {
  const result = instanceConfigSchema.safeParse(input);
  if (!result.success) {
    throw new ConfigError(
      result.error.issues.map(
        (i) => `${i.path.length ? i.path.join('.') : '(root)'}: ${i.message}`,
      ),
    );
  }
  return result.data;
}

export function parseConfigYaml(text: string): InstanceConfig {
  let data: unknown;
  try {
    data = parse(text);
  } catch (error) {
    throw new ConfigError([`YAML: ${error instanceof Error ? error.message : String(error)}`]);
  }
  return validateConfig(data);
}

/** Same format as the config file; never contains secrets. */
export function stringifyConfig(config: InstanceConfig): string {
  const header =
    '# BluePax CMS instance configuration, see docs/spec/README.md chapter 2.\n' +
    "# Keep it in the site's deployment repository; it initialises an empty instance unattended.\n";
  return header + stringify(config, { lineWidth: 0 });
}
