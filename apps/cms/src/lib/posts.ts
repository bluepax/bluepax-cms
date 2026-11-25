// Client-side helpers of the posts pages: error messages and names of categories, tags and
// authors in the language being edited.
import { m } from '#lib/paraglide/messages.js';

const messages = m as unknown as Record<
  string,
  ((inputs?: Record<string, unknown>) => string) | undefined
>;

/** Message for a posts error code (`posts_error_<code>`), with its details filled in. */
export function postErrorText(
  code: string,
  details: { reason?: string; title?: string; count?: number } = {},
): string {
  if (code === 'media' && details.reason) {
    return messages[`media_error_${details.reason}`]?.({ limit: '', size: '' }) ?? details.reason;
  }
  return (
    messages[`posts_error_${code}`]?.({ title: details.title ?? '', count: details.count ?? 0 }) ??
    code
  );
}

/** The result of a posts form action, as the pages read it. */
export interface PostFormResult {
  saved?: string;
  failed?: string;
  error?: string;
  invalid?: string[];
  details?: {
    fields?: string[];
    reason?: string;
    items?: string[];
    title?: string;
    count?: number;
  };
  slugChanged?: boolean;
  created?: boolean;
}

/** A name in the given language, else in the primary language, else in any; with the language. */
export function nameIn(
  names: Record<string, string>,
  locale: string,
  primary: string,
): { text: string; locale: string | null } {
  if (names[locale]) return { text: names[locale], locale };
  if (names[primary]) return { text: names[primary], locale: primary };
  const [first] = Object.entries(names);
  return first ? { text: first[1], locale: first[0] } : { text: '—', locale: null };
}

/** `name` or `name (en)` when the name is from another language. */
export function labelIn(names: Record<string, string>, locale: string, primary: string): string {
  const name = nameIn(names, locale, primary);
  return name.locale && name.locale !== locale ? `${name.text} (${name.locale})` : name.text;
}
