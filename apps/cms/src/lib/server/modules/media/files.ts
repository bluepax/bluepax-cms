// Upload checks, see docs/spec/README.md chapter 5 ("媒体处理") and chapter 9 ("安全"): the type
// is sniffed from the content (the browser's type and the file name are not trusted), only the
// listed types are accepted, executables are refused, sizes are limited per kind and SVG files
// are sanitised before they are stored.
import createDOMPurify from 'dompurify';
import { fileTypeFromBuffer } from 'file-type';
import { JSDOM } from 'jsdom';
import { MediaError } from './errors.ts';

/** URL path the local storage is served under (routes/uploads). */
export const UPLOADS_PATH = '/uploads';

export const MEDIA_KINDS = ['image', 'video', 'document'] as const;
export type MediaKind = (typeof MEDIA_KINDS)[number];

export interface FileType {
  mimeType: string;
  /** Extension used in the object key. */
  ext: string;
  kind: MediaKind;
}

/** The accepted types. PDF and office documents share the document limit (chapter 13). */
const ACCEPTED: Readonly<Record<string, Omit<FileType, 'mimeType'>>> = {
  'image/jpeg': { ext: 'jpg', kind: 'image' },
  'image/png': { ext: 'png', kind: 'image' },
  'image/gif': { ext: 'gif', kind: 'image' },
  'image/webp': { ext: 'webp', kind: 'image' },
  'image/avif': { ext: 'avif', kind: 'image' },
  'image/svg+xml': { ext: 'svg', kind: 'image' },
  'video/mp4': { ext: 'mp4', kind: 'video' },
  'video/webm': { ext: 'webm', kind: 'video' },
  'video/quicktime': { ext: 'mov', kind: 'video' },
  'application/pdf': { ext: 'pdf', kind: 'document' },
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': {
    ext: 'docx',
    kind: 'document',
  },
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': {
    ext: 'xlsx',
    kind: 'document',
  },
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': {
    ext: 'pptx',
    kind: 'document',
  },
  'application/vnd.oasis.opendocument.text': { ext: 'odt', kind: 'document' },
  'application/vnd.oasis.opendocument.spreadsheet': { ext: 'ods', kind: 'document' },
  'application/vnd.oasis.opendocument.presentation': { ext: 'odp', kind: 'document' },
};

/** For the file input's `accept` attribute; the server checks the content regardless. */
export const ACCEPT_ATTRIBUTE = [
  ...Object.keys(ACCEPTED),
  ...Object.values(ACCEPTED).map((t) => `.${t.ext}`),
].join(',');

/** Content type of a stored object from its key's extension (originals and derived files). */
export function contentTypeOfExt(ext: string): string | null {
  if (ext === 'ico') return 'image/x-icon';
  return Object.entries(ACCEPTED).find(([, t]) => t.ext === ext)?.[0] ?? null;
}

/**
 * File names that run as programs or scripts are refused even when the content is a harmless
 * type, so the library never offers a download named like an executable.
 */
const EXECUTABLE_NAME =
  /\.(exe|dll|com|scr|msi|msp|bat|cmd|ps1|psm1|vbs|vbe|js|mjs|cjs|jse|wsf|wsh|hta|jar|sh|bash|zsh|csh|command|app|apk|ipa|dmg|pkg|deb|rpm|run|bin|elf|so|dylib|py|pl|rb|php|cgi|html?|xhtml|lnk|reg|cpl)$/i;

/** Magic numbers of programs: PE (MZ), ELF, Mach-O (incl. universal) and `#!` scripts. */
function looksExecutable(data: Uint8Array): boolean {
  const b = data;
  if (b.length >= 2 && b[0] === 0x4d && b[1] === 0x5a) return true;
  if (b.length >= 4 && b[0] === 0x7f && b[1] === 0x45 && b[2] === 0x4c && b[3] === 0x46) {
    return true;
  }
  if (b.length >= 4) {
    const word = ((b[0]! << 24) | (b[1]! << 16) | (b[2]! << 8) | b[3]!) >>> 0;
    if ([0xfeedface, 0xfeedfacf, 0xcefaedfe, 0xcffaedfe, 0xcafebabe].includes(word)) return true;
  }
  return b.length >= 2 && b[0] === 0x23 && b[1] === 0x21;
}

const SVG_NS = 'http://www.w3.org/2000/svg';

/** Whether the bytes are an SVG document: XML whose root element is `<svg>`. */
function looksLikeSvg(data: Uint8Array): boolean {
  const head = new TextDecoder('utf-8', { fatal: false })
    .decode(data.subarray(0, 4096))
    .replace(/^\uFEFF/, '');
  // XML declaration, comments, processing instructions and a doctype may precede the root.
  const rest = head.replace(
    /^(\s+|<\?[\s\S]*?\?>|<!--[\s\S]*?-->|<!DOCTYPE[^>[]*(\[[\s\S]*?\])?\s*>)*/i,
    '',
  );
  return /^<svg[\s>/]/.test(rest);
}

/** Detects the type from the content; null for anything that is not accepted. */
export async function detectType(data: Uint8Array): Promise<FileType | null> {
  // SVG first: file-type reports SVG files that start with an XML declaration as plain XML.
  if (looksLikeSvg(data)) return { mimeType: 'image/svg+xml', ext: 'svg', kind: 'image' };
  const found = await fileTypeFromBuffer(data);
  const accepted = found && ACCEPTED[found.mime];
  return accepted ? { mimeType: found.mime, ...accepted } : null;
}

export interface UploadLimitsMb {
  image: number;
  document: number;
  video: number;
}

const MB = 1024 * 1024;

export interface CheckedFile extends FileType {
  /** The bytes to store: the upload itself, or the sanitised SVG. */
  data: Uint8Array;
}

/**
 * Checks an upload and returns what to store. Refuses executables, unknown types and files
 * over the limit of their kind.
 */
export async function checkUpload(
  name: string,
  data: Uint8Array,
  limits: UploadLimitsMb,
): Promise<CheckedFile> {
  if (data.length === 0) throw new MediaError('empty_file');
  if (EXECUTABLE_NAME.test(name) || looksExecutable(data)) throw new MediaError('executable');
  const type = await detectType(data);
  if (!type) throw new MediaError('unsupported_type');
  const limitMb = limits[type.kind];
  if (data.length > limitMb * MB) throw new MediaError('too_large', { limitMb });
  if (type.mimeType === 'image/svg+xml') return { ...type, data: sanitizeSvg(data) };
  return { ...type, data };
}

/**
 * Removes scripts, event handlers, `javascript:` links, foreign objects and anything else that
 * is not plain SVG (DOMPurify's SVG profile), then serialises the result as XML.
 */
export function sanitizeSvg(data: Uint8Array): Uint8Array {
  const source = new TextDecoder('utf-8', { fatal: false }).decode(data);
  let parsed: JSDOM;
  try {
    parsed = new JSDOM(source, { contentType: 'image/svg+xml' });
  } catch {
    throw new MediaError('invalid_file');
  }
  const root = parsed.window.document.documentElement;
  if (
    !root ||
    root.localName !== 'svg' ||
    root.namespaceURI !== SVG_NS ||
    parsed.window.document.getElementsByTagName('parsererror').length > 0
  ) {
    throw new MediaError('invalid_file');
  }
  const window = new JSDOM('').window;
  const purify = createDOMPurify(window as unknown as Parameters<typeof createDOMPurify>[0]);
  const clean = purify.sanitize(root.outerHTML, {
    USE_PROFILES: { svg: true, svgFilters: true },
    FORBID_TAGS: ['foreignObject', 'script', 'iframe', 'embed', 'object'],
    RETURN_DOM: true,
  });
  const svg = (clean as unknown as Element).querySelector('svg');
  if (!svg) throw new MediaError('invalid_file');
  const xml = new window.XMLSerializer().serializeToString(svg);
  return new TextEncoder().encode(`<?xml version="1.0" encoding="UTF-8"?>\n${xml}\n`);
}

/** Display name from an upload's file name: no folders, no control characters, at most 200 chars. */
export function displayName(fileName: string, fallback: string): string {
  const base = fileName.split(/[/\\]/).pop() ?? '';
  // eslint-disable-next-line no-control-regex
  const clean = base.replace(/[\u0000-\u001f\u007f]/g, '').trim();
  return (clean || fallback).slice(0, 200);
}
