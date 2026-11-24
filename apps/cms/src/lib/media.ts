// Client-side helpers of the media pages.
import { m } from '#lib/paraglide/messages.js';
import { getLocale } from '#lib/paraglide/runtime.js';

const messages = m as unknown as Record<
  string,
  ((inputs?: Record<string, unknown>) => string) | undefined
>;

/** Message for a media error code (`media_error_<code>`), with its details filled in. */
export function mediaErrorText(
  code: string,
  details: { limitMb?: number; minSize?: number } = {},
): string {
  const message = messages[`media_error_${code}`];
  return message ? message({ limit: details.limitMb ?? '', size: details.minSize ?? '' }) : code;
}

export function formatBytes(bytes: number): string {
  const format = (value: number, unit: string) =>
    `${value.toLocaleString(getLocale() === 'zh' ? 'zh-CN' : 'en', { maximumFractionDigits: 1 })} ${unit}`;
  if (bytes < 1024) return format(bytes, 'B');
  if (bytes < 1024 * 1024) return format(bytes / 1024, 'KB');
  if (bytes < 1024 * 1024 * 1024) return format(bytes / 1024 / 1024, 'MB');
  return format(bytes / 1024 / 1024 / 1024, 'GB');
}
