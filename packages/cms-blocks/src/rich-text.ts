// Rich text (docs/spec/README.md chapter 3): only semantic elements — headings H2–H4,
// paragraphs, lists, tables, quotes, images and links — stored as JSON; no inline styles and no
// custom HTML. The format is the ProseMirror document that the Tiptap editor produces, limited
// to these nodes. Inline text may be strong or emphasised (docs/adr/0009). Catalog item cards
// are added with the catalog module.
import { z } from 'zod';
import { isLinkUrl } from './links.ts';

export const HEADING_LEVELS = [2, 3, 4] as const;
/** Deepest nesting of nodes (lists in quotes in table cells …) that is accepted. */
export const RICH_TEXT_MAX_DEPTH = 12;
/** Largest stored document, in characters of JSON. */
export const RICH_TEXT_MAX_LENGTH = 200_000;

export interface SimpleMark {
  type: 'bold' | 'italic';
}
export interface LinkMark {
  type: 'link';
  attrs: { href: string };
}
export type Mark = SimpleMark | LinkMark;

export interface TextNode {
  type: 'text';
  text: string;
  marks?: Mark[] | undefined;
}
export interface HardBreakNode {
  type: 'hardBreak';
}
export type InlineNode = TextNode | HardBreakNode;

export interface ParagraphNode {
  type: 'paragraph';
  content?: InlineNode[] | undefined;
}
export interface HeadingNode {
  type: 'heading';
  attrs: { level: (typeof HEADING_LEVELS)[number] };
  content?: InlineNode[] | undefined;
}
export interface ListItemNode {
  type: 'listItem';
  content: BlockNode[];
}
export interface BulletListNode {
  type: 'bulletList';
  content: ListItemNode[];
}
export interface OrderedListNode {
  type: 'orderedList';
  /** Left out when the list starts at 1. */
  attrs?: { start: number } | undefined;
  content: ListItemNode[];
}
export interface BlockquoteNode {
  type: 'blockquote';
  content: BlockNode[];
}
export interface TableCellNode {
  /** `tableHeader` is a header cell (`th`). */
  type: 'tableCell' | 'tableHeader';
  /** Spans other than 1; left out otherwise. */
  attrs?: { colspan?: number | undefined; rowspan?: number | undefined } | undefined;
  content: BlockNode[];
}
export interface TableRowNode {
  type: 'tableRow';
  content: TableCellNode[];
}
export interface TableNode {
  type: 'table';
  content: TableRowNode[];
}
/** An image from the media library; its URL, size and alt texts come from the media item. */
export interface ImageNode {
  type: 'image';
  attrs: { mediaId: string };
}
export type BlockNode =
  | ParagraphNode
  | HeadingNode
  | BulletListNode
  | OrderedListNode
  | BlockquoteNode
  | TableNode
  | ImageNode;

export interface RichTextDoc {
  type: 'doc';
  content: BlockNode[];
}

const mark = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('bold') }),
  z.strictObject({ type: z.literal('italic') }),
  z.strictObject({
    type: z.literal('link'),
    attrs: z.strictObject({
      href: z.string().refine(isLinkUrl, 'must be a path, URL, mailto: or tel:'),
    }),
  }),
]);

const text = z.strictObject({
  type: z.literal('text'),
  text: z.string().min(1).max(20_000),
  marks: z
    .array(mark)
    .max(3)
    .refine((marks) => new Set(marks.map((m) => m.type)).size === marks.length, 'marks repeat')
    .optional(),
});
const inline = z.discriminatedUnion('type', [
  text,
  z.strictObject({ type: z.literal('hardBreak') }),
]);

const paragraph = z.strictObject({
  type: z.literal('paragraph'),
  content: z.array(inline).optional(),
});
const heading = z.strictObject({
  type: z.literal('heading'),
  attrs: z.strictObject({ level: z.literal(HEADING_LEVELS) }),
  content: z.array(inline).optional(),
});
const image = z.strictObject({
  type: z.literal('image'),
  attrs: z.strictObject({ mediaId: z.uuid() }),
});

const blockRef: z.ZodType<BlockNode> = z.lazy(() => block);
const listItem = z.strictObject({
  type: z.literal('listItem'),
  content: z.array(blockRef).min(1),
});
const bulletList = z.strictObject({
  type: z.literal('bulletList'),
  content: z.array(listItem).min(1),
});
const orderedList = z.strictObject({
  type: z.literal('orderedList'),
  attrs: z.strictObject({ start: z.int().min(0).max(1_000_000) }).optional(),
  content: z.array(listItem).min(1),
});
const blockquote = z.strictObject({
  type: z.literal('blockquote'),
  content: z.array(blockRef).min(1),
});
const span = z.int().min(2).max(100).optional();
const tableCell = z.strictObject({
  type: z.enum(['tableCell', 'tableHeader']),
  attrs: z.strictObject({ colspan: span, rowspan: span }).optional(),
  content: z.array(blockRef).min(1),
});
const tableRow = z.strictObject({
  type: z.literal('tableRow'),
  content: z.array(tableCell).min(1),
});
const table = z.strictObject({
  type: z.literal('table'),
  content: z.array(tableRow).min(1),
});
const block = z.discriminatedUnion('type', [
  paragraph,
  heading,
  bulletList,
  orderedList,
  blockquote,
  table,
  image,
]);

type Json = Record<string, unknown>;
const isObject = (value: unknown): value is Json =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Attributes kept per node type; everything else the editor adds (classes, widths) is dropped. */
const NODE_ATTRS: Record<string, (attrs: Json) => Json | undefined> = {
  heading: (a) => ({ level: a.level }),
  orderedList: (a) =>
    a.start === undefined || a.start === null || a.start === 1 ? undefined : { start: a.start },
  tableCell: cellAttrs,
  tableHeader: cellAttrs,
  image: (a) => ({ mediaId: a.mediaId }),
};

function cellAttrs(attrs: Json): Json | undefined {
  const result: Json = {};
  for (const key of ['colspan', 'rowspan']) {
    const value = attrs[key];
    if (value !== undefined && value !== null && value !== 1) result[key] = value;
  }
  return Object.keys(result).length > 0 ? result : undefined;
}

function canonicalMark(value: unknown): unknown {
  if (!isObject(value)) return value;
  if (value.type === 'link') {
    const attrs = isObject(value.attrs) ? value.attrs : {};
    return { type: 'link', attrs: { href: attrs.href } };
  }
  return { type: value.type };
}

function canonicalNode(value: unknown, depth: number): unknown {
  // Too deep: an invalid node, so validation fails instead of recursing further.
  if (depth > RICH_TEXT_MAX_DEPTH) return null;
  if (!isObject(value)) return value;
  const node: Json = { type: value.type };
  if (typeof value.text === 'string') node.text = value.text;
  const pick = typeof value.type === 'string' ? NODE_ATTRS[value.type] : undefined;
  if (pick) {
    const attrs = pick(isObject(value.attrs) ? value.attrs : {});
    if (attrs) node.attrs = attrs;
  } else if (value.attrs !== undefined && value.attrs !== null) {
    // Attributes on a node that has none (e.g. a style) fail validation.
    node.attrs = value.attrs;
  }
  if (Array.isArray(value.marks) && value.marks.length > 0) {
    node.marks = value.marks.map(canonicalMark);
  }
  if (Array.isArray(value.content) && value.content.length > 0) {
    node.content = value.content.map((child) => canonicalNode(child, depth + 1));
  }
  return node;
}

/**
 * The stored form of an editor document: only known attributes, no defaults, no empty content
 * arrays, no empty paragraphs at the start or end. Unknown nodes and marks are kept so that
 * validation refuses them.
 */
export function canonicalRichText(value: unknown): unknown {
  if (value === undefined || value === null) return { type: 'doc', content: [] };
  if (!isObject(value)) return value;
  const doc = canonicalNode(value, 0) as Json;
  const content = Array.isArray(doc.content) ? [...doc.content] : [];
  // Empty paragraphs at the start and end are editor artefacts (e.g. the trailing paragraph
  // that lets the cursor go below a table), not content.
  const isEmpty = (n: unknown) => isObject(n) && n.type === 'paragraph' && !n.content;
  while (content.length > 0 && isEmpty(content[0])) content.shift();
  while (content.length > 0 && isEmpty(content.at(-1))) content.pop();
  return { ...doc, content };
}

const doc = z.strictObject({
  type: z.literal('doc'),
  content: z.array(block),
});

/** A rich text document; editor output is brought into its stored form first. */
export const richTextSchema: z.ZodType<RichTextDoc> = z
  .preprocess(canonicalRichText, doc)
  .refine(
    (value) => JSON.stringify(value).length <= RICH_TEXT_MAX_LENGTH,
    `must be at most ${RICH_TEXT_MAX_LENGTH} characters of JSON`,
  );

export const EMPTY_RICH_TEXT: RichTextDoc = { type: 'doc', content: [] };

function walk(nodes: readonly BlockNode[] | undefined, visit: (node: BlockNode) => void): void {
  for (const node of nodes ?? []) {
    visit(node);
    if (node.type === 'table') {
      for (const row of node.content) for (const cell of row.content) walk(cell.content, visit);
    } else if (node.type === 'bulletList' || node.type === 'orderedList') {
      for (const item of node.content) walk(item.content, visit);
    } else if (node.type === 'blockquote') {
      walk(node.content, visit);
    }
  }
}

/** Media items shown in a document, in order of first appearance. */
export function richTextMedia(value: RichTextDoc): string[] {
  const ids = new Set<string>();
  walk(value.content, (node) => {
    if (node.type === 'image') ids.add(node.attrs.mediaId);
  });
  return [...ids];
}

/** Whether a document has no content. */
export function isEmptyRichText(value: RichTextDoc): boolean {
  return value.content.length === 0;
}
