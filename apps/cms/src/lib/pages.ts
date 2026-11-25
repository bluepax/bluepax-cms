// Client-side helpers of the page editor.
import { m } from '#lib/paraglide/messages.js';

const messages = m as unknown as Record<
  string,
  ((inputs?: Record<string, unknown>) => string) | undefined
>;

export type Status = 'draft' | 'in_review' | 'published' | 'unpublished';

export function statusText(status: string): string {
  return messages[`pages_status_${status}`]?.() ?? status;
}

/** Badge colours per status. */
export function statusClass(status: string | null): string {
  switch (status) {
    case 'published':
      return 'bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200';
    case 'in_review':
      return 'bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200';
    case 'unpublished':
      return 'bg-zinc-200 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300';
    case 'draft':
      return 'bg-sky-100 text-sky-900 dark:bg-sky-950 dark:text-sky-200';
    default:
      return 'border border-dashed text-muted-foreground';
  }
}

/** Name of a block type (`block_<key>` with hyphens as underscores). */
export function blockName(key: string): string {
  return messages[`block_${key.replaceAll('-', '_')}`]?.() ?? key;
}

/** Message for a page error code (`pages_error_<code>`), with its details filled in. */
export function pageErrorText(
  code: string,
  details: { reason?: string; title?: string } = {},
): string {
  if (code === 'media' && details.reason) {
    return messages[`media_error_${details.reason}`]?.({ limit: '', size: '' }) ?? details.reason;
  }
  return messages[`pages_error_${code}`]?.({ title: details.title ?? '' }) ?? code;
}

/** The result of a page form action, as the editor reads it. */
export interface PageFormResult {
  saved?: string;
  failed?: string;
  error?: string;
  invalid?: string[];
  details?: { fields?: string[]; reason?: string; items?: string[]; title?: string };
  slugChanged?: boolean;
}

/** Whether `field`, or anything below it, failed in the last action. */
export function failedIn(form: unknown): (field: string) => boolean {
  const fields = (form as PageFormResult | null | undefined)?.invalid ?? [];
  return (field) => fields.some((f) => f === field || f.startsWith(`${field}.`));
}
