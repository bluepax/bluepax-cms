// Small client-side helpers shared by admin pages.
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
