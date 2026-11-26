// Link targets from the CMS are frontend paths, http(s) URLs, `mailto:` or `tel:`; the CMS
// refuses anything else when it is saved. The frontend checks again before rendering a link.

/** The target if it is one the CMS allows, else null (render the label without a link). */
export function safeHref(value: string | null | undefined): string | null {
  if (!value) return null;
  if (value.startsWith('/'))
    return value.startsWith('//') || value.startsWith('/\\') ? null : value;
  const lower = value.toLowerCase();
  return ['https://', 'http://', 'mailto:', 'tel:'].some((p) => lower.startsWith(p)) ? value : null;
}

/** A path of this frontend that a 301 may point to: no other host, no scheme. */
export function isLocalPath(value: string): boolean {
  return value.startsWith('/') && !value.startsWith('//') && !value.startsWith('/\\');
}

/** A link to an instant messaging channel, when the channel has a known web address. */
export function imHref(im: { channel: string; number: string; text: string }): string | null {
  const digits = [...im.number].filter((c) => c >= '0' && c <= '9').join('');
  if (digits === '') return null;
  switch (im.channel) {
    case 'whatsapp':
      return `https://wa.me/${digits}${im.text ? `?text=${encodeURIComponent(im.text)}` : ''}`;
    case 'telegram':
      return `https://t.me/+${digits}`;
    default:
      return null;
  }
}
