/** A date in the site's time zone (UTC if that is unknown), e.g. `November 26, 2026`. */
export function formatDate(iso: string, locale: string, timeZone: string): string {
  const date = new Date(iso);
  try {
    return new Intl.DateTimeFormat(locale, { dateStyle: 'long', timeZone }).format(date);
  } catch {
    return new Intl.DateTimeFormat(locale, { dateStyle: 'long', timeZone: 'UTC' }).format(date);
  }
}

/** Date and time with the time zone's name, e.g. `2026年11月27日 GMT+8 02:40:37`. */
export function formatDateTime(iso: string, locale: string, timeZone: string): string {
  const date = new Date(iso);
  try {
    return new Intl.DateTimeFormat(locale, {
      dateStyle: 'medium',
      timeStyle: 'long',
      timeZone,
    }).format(date);
  } catch {
    return new Intl.DateTimeFormat(locale, {
      dateStyle: 'medium',
      timeStyle: 'long',
      timeZone: 'UTC',
    }).format(date);
  }
}

/** A BCP 47 tag that is safe to write into the `lang` attribute, else the fallback. */
export function htmlLang(value: string | undefined, fallback = 'en'): string {
  if (!value || value.length > 35) return fallback;
  for (const c of value) {
    const ok =
      (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') || c === '-';
    if (!ok) return fallback;
  }
  return value;
}

/** `?page=` of a list: 1 when missing, null when it is not a page number. */
export function pageParam(url: URL): number | null {
  const value = url.searchParams.get('page');
  if (value === null) return 1;
  if (value === '' || value.length > 5 || ![...value].every((c) => c >= '0' && c <= '9'))
    return null;
  const page = Number(value);
  return page >= 1 && page <= 10_000 ? page : null;
}
