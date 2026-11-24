// Where a media item is used, for the "引用位置" list of the media library. Each module that
// writes media usages adds how its records are named and where they are edited.
import type { MediaUsage } from './modules/media/library.ts';

export interface UsageLink {
  /** Message key of the label, or null when the usage is unknown to the admin UI. */
  label: string | null;
  /** Shown when there is no label: module, record and field. */
  fallback: string;
  href: string | null;
  locale: string;
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

export function describeUsage(usage: MediaUsage): UsageLink {
  const known = KNOWN[`${usage.module}/${usage.targetType}/${usage.targetId}/${usage.field}`];
  return {
    label: known?.label ?? null,
    fallback: `${usage.module} · ${usage.targetType} ${usage.targetId} · ${usage.field}`,
    href: known?.href ?? null,
    locale: usage.locale,
  };
}
