// Small client-side helpers shared by admin pages.
import type { SubmitFunction } from '$app/forms';
import { m } from '#lib/paraglide/messages.js';
import { getLocale } from '#lib/paraglide/runtime.js';

const messages = m as unknown as Record<string, (() => string) | undefined>;

/** Turns an error code returned by a form action into a message (`error_<code>`). */
export function errorText(code: string | null | undefined): string | null {
  if (!code) return null;
  return messages[`error_${code}`]?.() ?? code;
}

export function formatDate(value: Date | string | null | undefined): string {
  if (!value) return m.never();
  return new Date(value).toLocaleString(getLocale() === 'zh' ? 'zh-CN' : 'en');
}

/** Native <select> styled like the shadcn inputs. */
export const selectClass =
  'border-input bg-background h-9 w-full rounded-md border px-3 text-sm shadow-xs outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50';

/** Multi-line counterpart of the shadcn input. */
export const textareaClass =
  'border-input bg-background min-h-20 w-full rounded-md border px-3 py-2 text-sm shadow-xs outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 aria-invalid:border-destructive';

/**
 * `use:enhance` that keeps what is in the form after saving. Settings forms show the stored
 * values, which the reloaded data brings back; resetting would show the first page load's.
 */
export const keepValues: SubmitFunction =
  () =>
  async ({ update }) => {
    await update({ reset: false });
  };

/**
 * Field check for a form action result of the settings pages: whether `field`, or anything
 * below it (`content.1.code` under `content`), failed in the form called `name`.
 */
export function failedFields(form: unknown, name: string): (field: string) => boolean {
  const result = form as { failed?: string; invalid?: string[] } | null | undefined;
  const fields = result?.failed === name ? (result.invalid ?? []) : [];
  return (field) => fields.some((f) => f === field || f.startsWith(`${field}.`));
}
