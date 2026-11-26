// JSON-LD for `<head>` (docs/spec/README.md chapter 6, "按 `seo` 对象输出 `<head>` 与 JSON-LD").
// JSON.stringify alone is not safe inside `<script>`: a string containing `</script>` would end
// the element and let the rest be parsed as HTML. Escaping `<`, `>` and `&` as JSON unicode
// escapes keeps the data identical for JSON-LD parsers while no markup can appear; U+2028 and
// U+2029 are escaped as well for older JavaScript parsers.

const ESCAPES: Record<string, string> = {
  '<': '\\u003c',
  '>': '\\u003e',
  '&': '\\u0026',
  ' ': '\\u2028',
  ' ': '\\u2029',
};

/** `JSON.stringify(value)` that can be placed inside a `<script>` element as is. */
export function serializeJsonLd(value: unknown): string {
  const json = JSON.stringify(value) ?? 'null';
  let out = '';
  for (const c of json) out += ESCAPES[c] ?? c;
  return out;
}

/** A complete `<script type="application/ld+json">` element for `seo.jsonLd`. */
export function jsonLdScript(value: unknown): string {
  return `<script type="application/ld+json">${serializeJsonLd(value)}</script>`;
}
