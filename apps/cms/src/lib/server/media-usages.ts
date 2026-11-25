// Where a media item is used, for the "引用位置" list of the media library. Each module that
// writes media usages adds how its records are named and where they are edited.
import { schema, type Executor } from '@bluepax/db';
import { inArray } from 'drizzle-orm';
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

export function describeUsage(usage: MediaUsage): UsageLink {
  const known =
    usage.module === 'pages' && usage.targetType === 'page'
      ? pageUsage(usage)
      : KNOWN[`${usage.module}/${usage.targetType}/${usage.targetId}/${usage.field}`];
  return {
    label: known?.label ?? null,
    fallback: `${usage.module} · ${usage.targetType} ${usage.targetId} · ${usage.field}`,
    href: known?.href ?? null,
    locale: usage.locale,
  };
}

/** describeUsage for a list, with the names of the records (page titles) filled in. */
export async function describeUsages(
  db: Executor,
  usages: readonly MediaUsage[],
): Promise<UsageLink[]> {
  const pageIds = [...new Set(usages.filter((u) => u.module === 'pages').map((u) => u.targetId))];
  const titles = new Map<string, string>();
  if (pageIds.length > 0) {
    const rows = await db
      .select({
        pageId: schema.pagesTranslations.entityId,
        locale: schema.pagesTranslations.locale,
        title: schema.pagesTranslations.title,
      })
      .from(schema.pagesTranslations)
      .where(inArray(schema.pagesTranslations.entityId, pageIds));
    for (const row of rows) titles.set(`${row.pageId} ${row.locale}`, row.title);
  }
  return usages.map((usage) => {
    const link = describeUsage(usage);
    const name =
      usage.module === 'pages' ? titles.get(`${usage.targetId} ${usage.locale}`) : undefined;
    return name ? { ...link, name } : link;
  });
}
