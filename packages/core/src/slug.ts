// Slugs of routable content (docs/spec/README.md chapters 4 and 6): lowercase Latin letters and
// digits in groups joined by single hyphens, e.g. `about-us`. Addresses are always lowercase.
// Checked with a loop rather than a regex, so long input never backtracks.

export const SLUG_MAX_LENGTH = 100;

const isLowerAlnum = (code: number) =>
  (code >= 0x61 && code <= 0x7a) || (code >= 0x30 && code <= 0x39);

/** `about-us`: lowercase a–z and 0–9, single hyphens between groups, at most 100 characters. */
export function isSlug(value: string): boolean {
  if (value.length === 0 || value.length > SLUG_MAX_LENGTH) return false;
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (isLowerAlnum(code)) continue;
    // A hyphen only between two letters or digits.
    if (code !== 0x2d || i === 0 || i === value.length - 1 || value.charCodeAt(i - 1) === 0x2d) {
      return false;
    }
  }
  return true;
}

/**
 * A slug suggestion from a title: accents are dropped (`Café` → `cafe`), everything that is not
 * a Latin letter or digit becomes a hyphen. Titles in other scripts give an empty string; the
 * editor then types the slug.
 */
export function slugify(title: string): string {
  const plain = title.normalize('NFKD').toLowerCase();
  let result = '';
  let pendingHyphen = false;
  for (const char of plain) {
    const code = char.charCodeAt(0);
    if (char.length === 1 && isLowerAlnum(code)) {
      if (pendingHyphen && result.length > 0) result += '-';
      pendingHyphen = false;
      result += char;
    } else if (!(code >= 0x300 && code <= 0x36f)) {
      // Combining marks (the accents split off by NFKD) are dropped; anything else separates.
      pendingHyphen = true;
    }
    if (result.length >= SLUG_MAX_LENGTH) break;
  }
  result = result.slice(0, SLUG_MAX_LENGTH);
  while (result.endsWith('-')) result = result.slice(0, -1);
  return result;
}
