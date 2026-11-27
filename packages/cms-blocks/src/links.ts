/** Longest link target accepted, in characters. */
export const LINK_MAX_LENGTH = 2000;

/**
 * A link target in blocks, rich text and menus: a frontend path (`/en/about`), an http(s) URL,
 * `mailto:` or `tel:`. Protocol-relative (`//host`) and other schemes such as `javascript:` are
 * refused.
 */
export function isLinkUrl(value: string): boolean {
  if (value === '' || value.length > LINK_MAX_LENGTH || /\s/.test(value)) return false;
  if (value.startsWith('/')) return !value.startsWith('//') && !value.startsWith('/\\');
  try {
    return ['http:', 'https:', 'mailto:', 'tel:'].includes(new URL(value).protocol);
  } catch {
    return false;
  }
}
