// Helpers shared by posts, categories, tags and authors (docs/adr/0010): languages, slugs,
// media checks and the errors of concurrent saves.
import { isSlug } from '@bluepax/core';
import { schema, type Executor } from '@bluepax/db';
import type { RouteTemplates } from '@bluepax/presets';
import { and, eq, ne, type SQL } from 'drizzle-orm';
import type { PgColumn, PgTable } from 'drizzle-orm/pg-core';
import { z } from 'zod';
import { pgError } from '../../content/status.ts';
import { seoSchema } from '../../content/seo.ts';
import { exportInstanceConfig } from '../../instance.ts';
import { MediaError } from '../media/errors.ts';
import {
  prepareMediaUse,
  setMediaUsages,
  type MediaContext,
  type UsageRef,
  type UsageTarget,
} from '../media/library.ts';
import { reservedSlugs } from '../pages/slugs.ts';
import { PostError } from './errors.ts';

export interface Actor {
  id: string;
  ip: string | null;
}

export interface Language {
  code: string;
  dir: 'ltr' | 'rtl';
}

/** Content languages with their direction, and the primary language. */
export async function contentSetup(db: Executor): Promise<{
  languages: Language[];
  primary: string;
  frontendBaseUrl: string;
  /** Route templates, for the address preview. */
  routes: RouteTemplates;
}> {
  const config = await exportInstanceConfig(db);
  return {
    languages: config.languages.content.map((l) => ({ code: l.code, dir: l.dir })),
    primary: config.languages.primary,
    frontendBaseUrl: config.frontend.baseUrl,
    routes: config.frontend.routes,
  };
}

export async function requireLanguage(db: Executor, locale: string): Promise<void> {
  const { languages } = await contentSetup(db);
  if (!languages.some((l) => l.code === locale)) {
    throw new PostError('invalid', { fields: ['locale'] });
  }
}

/** A translation table: entity, language, slug and a display column (title or name). */
export interface TranslationTable {
  table: PgTable;
  entityId: PgColumn;
  locale: PgColumn;
  slug: PgColumn;
  label: PgColumn;
  /** Names of the unique indexes, to tell a concurrent save's conflict apart. */
  slugUnique: string;
  localeUnique: string;
}

export const TRANSLATIONS = {
  post: {
    table: schema.postsTranslations,
    entityId: schema.postsTranslations.entityId,
    locale: schema.postsTranslations.locale,
    slug: schema.postsTranslations.slug,
    label: schema.postsTranslations.title,
    slugUnique: 'posts_translations_locale_slug_unique',
    localeUnique: 'posts_translations_entity_locale_unique',
  },
  category: {
    table: schema.postCategoriesTranslations,
    entityId: schema.postCategoriesTranslations.entityId,
    locale: schema.postCategoriesTranslations.locale,
    slug: schema.postCategoriesTranslations.slug,
    label: schema.postCategoriesTranslations.name,
    slugUnique: 'post_categories_translations_locale_slug_unique',
    localeUnique: 'post_categories_translations_entity_locale_unique',
  },
  tag: {
    table: schema.tagsTranslations,
    entityId: schema.tagsTranslations.entityId,
    locale: schema.tagsTranslations.locale,
    slug: schema.tagsTranslations.slug,
    label: schema.tagsTranslations.name,
    slugUnique: 'tags_translations_locale_slug_unique',
    localeUnique: 'tags_translations_entity_locale_unique',
  },
  author: {
    table: schema.authorsTranslations,
    entityId: schema.authorsTranslations.entityId,
    locale: schema.authorsTranslations.locale,
    slug: schema.authorsTranslations.slug,
    label: schema.authorsTranslations.name,
    slugUnique: 'authors_translations_locale_slug_unique',
    localeUnique: 'authors_translations_entity_locale_unique',
  },
} as const satisfies Record<string, TranslationTable>;

export type TranslatedKind = keyof typeof TRANSLATIONS;

/**
 * Checks a slug for one language: lowercase Latin (`isSlug`), not used by another record of
 * the same kind in that language (`slug_taken`, 409). Post slugs may not be reserved either
 * (chapter 2: "页面与文章 slug 不得重名"). Categories, tags and authors are not checked against
 * reserved slugs; the route template check never lets their `{slug}` meet a fixed segment
 * (routeTemplateIssues, docs/adr/0011).
 */
export async function checkSlug(
  db: Executor,
  kind: TranslatedKind,
  locale: string,
  slug: string,
  entityId?: string,
): Promise<void> {
  if (!isSlug(slug)) throw new PostError('invalid', { fields: ['slug'] });
  if (kind === 'post' && (await reservedSlugs(db)).has(slug)) {
    throw new PostError('slug_reserved', { fields: ['slug'] });
  }
  const t = TRANSLATIONS[kind];
  const [taken] = await db
    .select({ label: t.label })
    .from(t.table)
    .where(
      and(
        eq(t.locale, locale),
        eq(t.slug, slug),
        entityId ? ne(t.entityId, entityId) : undefined,
      ) as SQL,
    );
  if (taken) {
    throw new PostError('slug_taken', { fields: ['slug'], title: String(taken.label) });
  }
}

/** A unique violation from a concurrent save: the slug or the language version is taken. */
export function uniqueRace(kind: TranslatedKind, error: unknown): never {
  const { code, constraint } = pgError(error);
  const t = TRANSLATIONS[kind];
  if (code === '23505' && constraint === t.slugUnique) {
    throw new PostError('slug_taken', { fields: ['slug'] });
  }
  if (code === '23505' && constraint === t.localeUnique) {
    throw new PostError('translation_exists', { fields: ['locale'] });
  }
  throw error;
}

export function parseSeo(value: unknown) {
  const seo = seoSchema.safeParse(value);
  if (!seo.success) {
    throw new PostError('invalid', {
      fields: seo.error.issues.map((i) => ['seo', ...i.path].join('.')),
    });
  }
  return seo.data;
}

/** A required single-line text. */
export function requiredText(value: string, field: string, max: number): string {
  const parsed = z.string().trim().min(1).max(max).safeParse(value);
  if (!parsed.success) throw new PostError('invalid', { fields: [field] });
  return parsed.data;
}

/** An optional text, trimmed; empty is allowed. */
export function optionalText(value: string, field: string, max: number): string {
  const parsed = z.string().trim().max(max).safeParse(value);
  if (!parsed.success) throw new PostError('invalid', { fields: [field] });
  return parsed.data;
}

/**
 * Collects the field errors of several checks, so one save reports every failing field. Each
 * check runs; PostError('invalid') adds its fields, other errors stop.
 */
export function fieldChecks() {
  const errors: string[] = [];
  return {
    errors,
    attempt<T>(run: () => T): T | undefined {
      try {
        return run();
      } catch (error) {
        if (error instanceof PostError && error.code === 'invalid') {
          errors.push(...(error.details.fields ?? []));
          return undefined;
        }
        throw error;
      }
    },
    fail(field: string) {
      errors.push(field);
    },
    throwIfFailed() {
      if (errors.length > 0) throw new PostError('invalid', { fields: [...new Set(errors)] });
    },
  };
}

/** A media usage with the form field it comes from, for error messages. */
export interface MediaUse {
  ref: UsageRef;
  formField: string;
}

/**
 * Checks the media of a record and derives what they need (the OG image), before the
 * transaction. A media item that does not fit fails its form field with the reason.
 */
export async function prepareMedia(ctx: MediaContext, uses: readonly MediaUse[]): Promise<void> {
  for (const use of uses) {
    try {
      await prepareMediaUse(ctx, [use.ref]);
    } catch (error) {
      if (!(error instanceof MediaError)) throw error;
      throw new PostError('media', { fields: [use.formField], reason: error.code });
    }
  }
}

/** Replaces the media usages of a target in the save's transaction. */
export async function writeUsages(
  tx: Executor,
  target: UsageTarget,
  uses: readonly MediaUse[],
): Promise<void> {
  try {
    await setMediaUsages(
      tx,
      target,
      uses.map((u) => u.ref),
    );
  } catch (error) {
    // Deleted between the check and the save.
    if (error instanceof MediaError) {
      throw new PostError('media', { fields: uses.map((u) => u.formField), reason: error.code });
    }
    throw error;
  }
}

/** The OG image of an SEO value as a media use (purpose `og`, a 1200×630 JPG is derived). */
export function ogImageUse(ogImage: string | null): MediaUse[] {
  return ogImage
    ? [
        {
          ref: { mediaId: ogImage, field: 'seo.ogImage', purpose: 'og', kind: 'image' },
          formField: 'seo.ogImage',
        },
      ]
    : [];
}

/** Fields whose values differ, for the audit log (names only). */
export function changedFields(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): string[] {
  return Object.keys(after).filter(
    (key) => JSON.stringify(before[key]) !== JSON.stringify(after[key]),
  );
}

/** Display text of a record in a language: that language, else the primary, else any. */
export function pickLabel(labels: Record<string, string>, locale: string, primary: string): string {
  return labels[locale] ?? labels[primary] ?? Object.values(labels)[0] ?? '';
}
