// Image processing with sharp, see docs/spec/README.md chapter 5 ("媒体处理"): AVIF and WebP
// variants about 480 / 960 / 1600 wide, a 1200×630 JPG of at most about 300 KB for images used
// as OG image, and favicon / Apple Touch / PWA icons for the site icon (chapter 3, `site`).
// sharp works in libuv's thread pool, so requests are not blocked; at most two images are
// processed at once (chapter 9, "图片处理默认 2").
import sharp, { type Sharp } from 'sharp';
import { MediaError } from './errors.ts';

export const RESPONSIVE_WIDTHS = [480, 960, 1600] as const;
export const OG_WIDTH = 1200;
export const OG_HEIGHT = 630;
export const OG_MAX_BYTES = 300 * 1024;
/** The site icon must be a square PNG at least this large (the largest PWA icon). */
export const SITE_ICON_MIN = 512;
const FAVICON_SIZES = [16, 32, 48];
const CONCURRENCY = 2;

let running = 0;
const waiting: (() => void)[] = [];

/** Runs `task` when fewer than CONCURRENCY image tasks are running. */
async function limited<T>(task: () => Promise<T>): Promise<T> {
  if (running >= CONCURRENCY) await new Promise<void>((resolve) => waiting.push(resolve));
  running++;
  try {
    return await task();
  } finally {
    running--;
    waiting.shift()?.();
  }
}

export interface ImageInfo {
  width: number;
  height: number;
  format: string;
  /** More than one frame (animated GIF or WebP). */
  animated: boolean;
}

export interface DerivedFile {
  /** Variant name used in the key, e.g. `w960`, `og` or `apple-touch`. */
  variant: string;
  ext: string;
  contentType: string;
  width: number;
  height: number;
  data: Buffer;
}

/** Size of an image as displayed, i.e. after applying the EXIF orientation. */
export async function readImage(data: Uint8Array): Promise<ImageInfo> {
  try {
    const meta = await sharp(data, { animated: true }).metadata();
    const pages = meta.pages ?? 1;
    const width = meta.autoOrient?.width ?? meta.width;
    const height =
      pages > 1 ? (meta.pageHeight ?? meta.height) : (meta.autoOrient?.height ?? meta.height);
    if (!width || !height) throw new Error('no size');
    return { width, height, format: meta.format ?? '', animated: pages > 1 };
  } catch {
    throw new MediaError('invalid_file');
  }
}

/**
 * Widths of the responsive variants: 480, 960 and 1600 where the original is wider, plus one
 * at the original's own width when it is narrower than 1600. Images are never enlarged.
 */
export function variantWidths(width: number): number[] {
  const widths: number[] = RESPONSIVE_WIDTHS.filter((w) => w < width);
  if (width <= RESPONSIVE_WIDTHS[RESPONSIVE_WIDTHS.length - 1]!) widths.push(width);
  return widths;
}

/** Whether an image gets AVIF / WebP variants; SVG is vector and animations would be lost. */
export function hasResponsiveVariants(mimeType: string, info: ImageInfo): boolean {
  return mimeType !== 'image/svg+xml' && !info.animated;
}

/** Density so that an SVG is rasterised at least `minWidth` × `minHeight` pixels. */
function svgDensity(info: ImageInfo, minWidth: number, minHeight: number): number {
  const scale = Math.max(minWidth / info.width, minHeight / info.height, 1);
  return Math.min(Math.ceil(72 * scale), 2400);
}

function input(data: Uint8Array, info: ImageInfo, minWidth: number, minHeight: number) {
  const options = info.format === 'svg' ? { density: svgDensity(info, minWidth, minHeight) } : {};
  return sharp(data, options).rotate();
}

async function encode(
  pipeline: Sharp,
  variant: string,
  ext: string,
  contentType: string,
): Promise<DerivedFile> {
  const { data, info } = await pipeline.toBuffer({ resolveWithObject: true });
  return { variant, ext, contentType, width: info.width, height: info.height, data };
}

/** AVIF and WebP at each width of variantWidths. */
export function responsiveVariants(data: Uint8Array, info: ImageInfo): Promise<DerivedFile[]> {
  return limited(async () => {
    const files: DerivedFile[] = [];
    for (const width of variantWidths(info.width)) {
      const resized = sharp(data).rotate().resize({ width, withoutEnlargement: true });
      const name = `w${width}`;
      files.push(
        await encode(resized.clone().avif({ quality: 55, effort: 4 }), name, 'avif', 'image/avif'),
        await encode(resized.clone().webp({ quality: 78 }), name, 'webp', 'image/webp'),
      );
    }
    return files;
  });
}

/**
 * The OG image: 1200×630, cropped around the most interesting part, as JPG of at most about
 * 300 KB (the quality is lowered step by step until it fits).
 */
export function ogImage(data: Uint8Array, info: ImageInfo): Promise<DerivedFile> {
  return limited(async () => {
    const base = input(data, info, OG_WIDTH, OG_HEIGHT)
      .resize(OG_WIDTH, OG_HEIGHT, { fit: 'cover', position: sharp.strategy.attention })
      .flatten({ background: '#ffffff' });
    let file: DerivedFile | undefined;
    for (const quality of [82, 74, 66, 58, 50, 42, 34]) {
      file = await encode(base.clone().jpeg({ quality, mozjpeg: true }), 'og', 'jpg', 'image/jpeg');
      if (file.data.length <= OG_MAX_BYTES) break;
    }
    return file!;
  });
}

/** Whether an image can be the site icon: a square PNG of at least SITE_ICON_MIN pixels. */
export function isSiteIconSource(mimeType: string, width: number | null, height: number | null) {
  return mimeType === 'image/png' && width !== null && width === height && width >= SITE_ICON_MIN;
}

/**
 * Icons derived from the site icon: `favicon.ico` (16, 32 and 48 px), the Apple Touch icon
 * (180 px, on white since iOS shows transparency as black) and the PWA icons (192 and 512 px).
 */
export function siteIcons(data: Uint8Array): Promise<DerivedFile[]> {
  return limited(async () => {
    const png = (size: number) => sharp(data).resize(size, size).png();
    const favicons = await Promise.all(FAVICON_SIZES.map((size) => png(size).toBuffer()));
    const ico = encodeIco(FAVICON_SIZES.map((size, i) => ({ size, png: favicons[i]! })));
    return [
      {
        variant: 'favicon',
        ext: 'ico',
        contentType: 'image/x-icon',
        width: 48,
        height: 48,
        data: ico,
      },
      await encode(
        sharp(data).resize(180, 180).flatten({ background: '#ffffff' }).png(),
        'apple-touch',
        'png',
        'image/png',
      ),
      await encode(png(192), 'pwa-192', 'png', 'image/png'),
      await encode(png(512), 'pwa-512', 'png', 'image/png'),
    ];
  });
}

/** An ICO file holding PNG images (supported by every current browser). */
export function encodeIco(images: { size: number; png: Buffer }[]): Buffer {
  const header = Buffer.alloc(6 + 16 * images.length);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  let offset = header.length;
  images.forEach((image, i) => {
    const entry = 6 + 16 * i;
    header.writeUInt8(image.size >= 256 ? 0 : image.size, entry);
    header.writeUInt8(image.size >= 256 ? 0 : image.size, entry + 1);
    header.writeUInt8(0, entry + 2);
    header.writeUInt8(0, entry + 3);
    header.writeUInt16LE(1, entry + 4);
    header.writeUInt16LE(32, entry + 6);
    header.writeUInt32LE(image.png.length, entry + 8);
    header.writeUInt32LE(offset, entry + 12);
    offset += image.png.length;
  });
  return Buffer.concat([header, ...images.map((i) => i.png)]);
}
