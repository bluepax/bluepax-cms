// Where a media item is used, for the "引用位置" list of the media library. Each module that
// writes media usages adds how its records are named and where they are edited.
import { schema, type Executor } from '@bluepax/db';
import { inArray } from 'drizzle-orm';
import { exportInstanceConfig } from './instance.ts';
import type { MediaUsage } from './modules/media/library.ts';

export interface UsageLink {
  /** Message key of the label, or null when the usage is unknown to the admin UI. */
  label: string | null;
  /** Shown when there is no label: module, record and field. */
  fallback: string;
  href: string | null;
  locale: string;
  /** Name of the record, e.g. the page title in the usage's language. */
  name?: string;
}

const KNOWN: Record<string, { label: string; href: string }> = {
  'site/settings/site.branding/logo': {
    label: 'media_usage_site_logo',
    href: '/settings/branding',
  },
  'site/settings/site.branding/icon': {
    label: 'media_usage_site_icon',
    href: '/settings/branding',
  },
  'site/settings/site.publisher/image': { label: 'media_usage_site_publisher', href: '/settings' },
};

/** Page usages: the OG image of the SEO panel, or an image in a block. */
function pageUsage(usage: MediaUsage): { label: string; href: string } {
  return {
    label: usage.field === 'seo.ogImage' ? 'media_usage_page_og' : 'media_usage_page_block',
    href: `/pages/${usage.targetId}?locale=${encodeURIComponent(usage.locale)}`,
  };
}

/** Admin pages of the posts module's records, by usage target type. */
const POST_PATHS: Record<string, string> = {
  post: '/posts',
  category: '/posts/categories',
  tag: '/posts/tags',
  author: '/posts/authors',
};

/**
 * Posts module usages: a post's cover, an image in its body, an author's avatar, or the OG
 * image of a post, category, tag or author (`media_usage_<type>_<field>`).
 */
function postsUsage(usage: MediaUsage): { label: string; href: string } | undefined {
  const path = POST_PATHS[usage.targetType];
  if (!path) return undefined;
  const field = usage.field === 'seo.ogImage' ? 'og' : usage.field;
  const query = usage.locale ? `?locale=${encodeURIComponent(usage.locale)}` : '';
  return {
    label: `media_usage_${usage.targetType}_${field}`,
    href: `${path}/${usage.targetId}${query}`,
  };
}

export function describeUsage(usage: MediaUsage): UsageLink {
  const known =
    usage.module === 'pages' && usage.targetType === 'page'
      ? pageUsage(usage)
      : usage.module === 'posts'
        ? postsUsage(usage)
        : KNOWN[`${usage.module}/${usage.targetType}/${usage.targetId}/${usage.field}`];
  return {
    label: known?.label ?? null,
    fallback: `${usage.module} · ${usage.targetType} ${usage.targetId} · ${usage.field}`,
    href: known?.href ?? null,
    locale: usage.locale,
  };
}

/** Translation tables with the name of each record per language, by module and target type. */
const NAMED = {
  'pages/page': {
    table: schema.pagesTranslations,
    id: schema.pagesTranslations.entityId,
    name: schema.pagesTranslations.title,
  },
  'posts/post': {
    table: schema.postsTranslations,
    id: schema.postsTranslations.entityId,
    name: schema.postsTranslations.title,
  },
  'posts/category': {
    table: schema.postCategoriesTranslations,
    id: schema.postCategoriesTranslations.entityId,
    name: schema.postCategoriesTranslations.name,
  },
  'posts/tag': {
    table: schema.tagsTranslations,
    id: schema.tagsTranslations.entityId,
    name: schema.tagsTranslations.name,
  },
  'posts/author': {
    table: schema.authorsTranslations,
    id: schema.authorsTranslations.entityId,
    name: schema.authorsTranslations.name,
  },
} as const;

/**
 * describeUsage for a list, with the names of the records (page and post titles, names of
 * categories, tags and authors) filled in: in the usage's language, or for a field shared by
 * all languages in the primary language (else any language the record has).
 */
export async function describeUsages(
  db: Executor,
  usages: readonly MediaUsage[],
): Promise<UsageLink[]> {
  const names = new Map<string, string>();
  const shared = usages.some((u) => u.locale === '' && u.module !== 'site');
  const primary = shared ? (await exportInstanceConfig(db)).languages.primary : '';
  for (const [key, t] of Object.entries(NAMED)) {
    const ids = [
      ...new Set(
        usages.filter((u) => `${u.module}/${u.targetType}` === key).map((u) => u.targetId),
      ),
    ];
    if (ids.length === 0) continue;
    const rows = await db
      .select({ id: t.id, locale: t.table.locale, name: t.name })
      .from(t.table)
      .where(inArray(t.id, ids));
    for (const row of rows) {
      names.set(`${key} ${row.id} ${row.locale}`, row.name);
      if (row.locale === primary || !names.has(`${key} ${row.id} `)) {
        names.set(`${key} ${row.id} `, row.name);
      }
    }
  }
  return usages.map((usage) => {
    const link = describeUsage(usage);
    const name = names.get(`${usage.module}/${usage.targetType} ${usage.targetId} ${usage.locale}`);
    return name ? { ...link, name } : link;
  });
}
