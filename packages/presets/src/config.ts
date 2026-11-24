// Instance configuration (docs/spec/README.md chapter 2, "实例配置项"): the YAML file in a
// site's deployment repository and the admin settings are the same data. A config file can
// initialise an empty instance unattended, and an instance can export its settings back.
// Sections for modules that are not built yet (routes, catalog, inquiries, ...) are added
// together with those modules; unknown keys are rejected so typos never pass silently.
import { OPTIONAL_MODULES, type OptionalModuleId } from '@bluepax/core';
import { parse, stringify } from 'yaml';
import { z } from 'zod';
import { BLOCK_KEYS } from './blocks.ts';

export const CONFIG_VERSION = 1;
export const SITE_TYPES = ['corporate', 'blog'] as const;
export const ADMIN_LOCALES = ['zh', 'en'] as const;

export type SiteType = (typeof SITE_TYPES)[number];
export type AdminLocale = (typeof ADMIN_LOCALES)[number];

function canonicalLocale(value: string): string | null {
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

const baseUrl = z
  .url({ protocol: /^https?$/, message: 'must be an http(s) URL' })
  .transform((value) => value.replace(/\/+$/, ''));

const contentLanguage = z.strictObject({
  code: locale,
  /** Defaults to the language's own direction. */
  dir: z.enum(['ltr', 'rtl']).optional(),
});

export const instanceConfigSchema = z
  .strictObject({
    version: z.literal(CONFIG_VERSION),
    site: z.strictObject({
      type: z.enum(SITE_TYPES),
      name: z.string().trim().min(1),
      /** Time zone used by the frontend to display dates. */
      timezone: timezone.default('UTC'),
      publisher: z.strictObject({ type: z.enum(['organization', 'person']) }),
    }),
    languages: z.strictObject({
      content: z.array(contentLanguage).min(1),
      primary: locale,
      /** Default admin UI language, e.g. for new accounts. */
      admin: z.enum(ADMIN_LOCALES),
    }),
    frontend: z.strictObject({ baseUrl }),
    modules: z.strictObject({
      /** Optional modules that are switched on; core modules are always on. */
      enabled: z.array(z.enum(OPTIONAL_MODULES)),
    }),
    blocks: z.strictObject({ available: z.array(z.enum(BLOCK_KEYS)).min(1) }),
    storage: z.strictObject({
      /** R2 is added later in the admin (chapter 5); a fresh instance is local only. */
      mode: z.literal('local'),
    }),
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
    return {
      ...config,
      languages: {
        ...config.languages,
        content: config.languages.content.map((l) => ({
          code: l.code,
          dir: l.dir ?? textDirection(l.code),
        })),
      },
      modules: { enabled: [...new Set(config.modules.enabled)].sort() as OptionalModuleId[] },
      blocks: { available: BLOCK_KEYS.filter((k) => config.blocks.available.includes(k)) },
    };
  });

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
