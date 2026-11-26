// Safe HTML of rich text (docs/spec/README.md chapter 6: "富文本同时返回 JSON 与安全 HTML";
// docs/adr/0012). Written out node by node from the JSON, never parsed from HTML: only the
// semantic elements of chapter 3 exist, every text and attribute is escaped, links keep only
// the targets the editor accepts and images come from the media library. No dependency, so
// there is nothing to sanitise afterwards.
import { isLinkUrl } from '@bluepax/cms-blocks';
import type { Media } from './contract.ts';

const ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => ESCAPES[c]!);
}

type Json = Record<string, unknown>;
const isObject = (v: unknown): v is Json =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const children = (node: Json): unknown[] => (Array.isArray(node.content) ? node.content : []);

interface Context {
  media: (id: string) => Media | null;
  locale: string;
}

/** Deeper nesting than the editor allows is cut off rather than followed. */
const MAX_DEPTH = 16;

function inline(nodes: readonly unknown[]): string {
  let html = '';
  for (const node of nodes) {
    if (!isObject(node)) continue;
    if (node.type === 'hardBreak') {
      html += '<br>';
      continue;
    }
    if (node.type !== 'text' || typeof node.text !== 'string') continue;
    let text = escapeHtml(node.text);
    const marks = Array.isArray(node.marks) ? node.marks.filter(isObject) : [];
    // Fixed nesting order, whatever order the marks are stored in.
    if (marks.some((m) => m.type === 'italic')) text = `<em>${text}</em>`;
    if (marks.some((m) => m.type === 'bold')) text = `<strong>${text}</strong>`;
    const link = marks.find((m) => m.type === 'link');
    const href = link && isObject(link.attrs) ? link.attrs.href : undefined;
    if (typeof href === 'string' && isLinkUrl(href)) {
      text = `<a href="${escapeHtml(href)}">${text}</a>`;
    }
    html += text;
  }
  return html;
}

function image(node: Json, ctx: Context): string {
  const id = isObject(node.attrs) ? node.attrs.mediaId : undefined;
  const media = typeof id === 'string' ? ctx.media(id) : null;
  if (!media || media.kind !== 'image') return '';
  const attrs = [
    `src="${escapeHtml(media.url)}"`,
    `alt="${escapeHtml(media.alt[ctx.locale] ?? '')}"`,
  ];
  if (media.width && media.height) attrs.push(`width="${media.width}"`, `height="${media.height}"`);
  const srcset = media.variants
    .filter((v) => v.name.startsWith('w') && v.contentType === 'image/webp' && v.width)
    .map((v) => `${escapeHtml(v.url)} ${v.width}w`);
  if (srcset.length > 0) attrs.push(`srcset="${srcset.join(', ')}"`, 'sizes="100vw"');
  attrs.push('loading="lazy"', 'decoding="async"');
  return `<img ${attrs.join(' ')}>`;
}

function span(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 2 && value <= 100
    ? value
    : null;
}

function blocks(nodes: readonly unknown[], ctx: Context, depth: number): string {
  if (depth > MAX_DEPTH) return '';
  let html = '';
  for (const node of nodes) {
    if (!isObject(node)) continue;
    const inner = () => blocks(children(node), ctx, depth + 1);
    switch (node.type) {
      case 'paragraph':
        html += `<p>${inline(children(node))}</p>`;
        break;
      case 'heading': {
        const level = isObject(node.attrs) ? node.attrs.level : undefined;
        const tag = level === 2 || level === 3 || level === 4 ? `h${level}` : 'h2';
        html += `<${tag}>${inline(children(node))}</${tag}>`;
        break;
      }
      case 'bulletList':
        html += `<ul>${listItems(node, ctx, depth)}</ul>`;
        break;
      case 'orderedList': {
        const start = isObject(node.attrs) ? node.attrs.start : undefined;
        const attr =
          typeof start === 'number' && Number.isInteger(start) && start !== 1 && start >= 0
            ? ` start="${start}"`
            : '';
        html += `<ol${attr}>${listItems(node, ctx, depth)}</ol>`;
        break;
      }
      case 'blockquote':
        html += `<blockquote>${inner()}</blockquote>`;
        break;
      case 'table':
        html += `<table><tbody>${tableRows(node, ctx, depth)}</tbody></table>`;
        break;
      case 'image':
        html += image(node, ctx);
        break;
      default:
        // Unknown nodes (e.g. catalog item cards before the catalog module) are left out.
        break;
    }
  }
  return html;
}

function listItems(list: Json, ctx: Context, depth: number): string {
  return children(list)
    .filter((item): item is Json => isObject(item) && item.type === 'listItem')
    .map((item) => `<li>${blocks(children(item), ctx, depth + 2)}</li>`)
    .join('');
}

function tableRows(table: Json, ctx: Context, depth: number): string {
  return children(table)
    .filter((row): row is Json => isObject(row) && row.type === 'tableRow')
    .map((row) => {
      const cells = children(row)
        .filter(
          (cell): cell is Json =>
            isObject(cell) && (cell.type === 'tableCell' || cell.type === 'tableHeader'),
        )
        .map((cell) => {
          const tag = cell.type === 'tableHeader' ? 'th' : 'td';
          const attrs = isObject(cell.attrs) ? cell.attrs : {};
          const colspan = span(attrs.colspan);
          const rowspan = span(attrs.rowspan);
          const extra = `${colspan ? ` colspan="${colspan}"` : ''}${rowspan ? ` rowspan="${rowspan}"` : ''}`;
          return `<${tag}${extra}>${blocks(children(cell), ctx, depth + 3)}</${tag}>`;
        })
        .join('');
      return `<tr>${cells}</tr>`;
    })
    .join('');
}

/** The HTML of a rich text document; images are looked up in `media`. */
export function richTextHtml(
  doc: unknown,
  media: (id: string) => Media | null,
  locale: string,
): string {
  if (!isObject(doc) || doc.type !== 'doc') return '';
  return blocks(children(doc), { media, locale }, 0);
}
