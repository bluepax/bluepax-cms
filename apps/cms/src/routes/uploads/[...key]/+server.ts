// The local media source (chapter 5): serves stored objects without login, with the cache
// lifetime from the storage settings, `X-Robots-Tag: noindex` and `X-BluePax-Origin: local`.
// Keys are content hashes, so responses are immutable; byte ranges are supported for video.
import { schema } from '@bluepax/db';
import { isMediaKey } from '@bluepax/storage';
import { and, eq } from 'drizzle-orm';
import { parseRange } from '#lib/server/modules/media/http.ts';
import { mediaCacheControl, readStorageConfig } from '#lib/server/modules/media/storage.ts';
import { getDatabase, getStorage } from '#lib/server/runtime.ts';
import type { RequestHandler } from './$types';

const COMMON = { 'X-Robots-Tag': 'noindex', 'X-BluePax-Origin': 'local' };
/** SVG may be opened directly: it runs nothing and loads nothing (defence in depth, chapter 9). */
const SVG_CSP = "default-src 'none'; style-src 'unsafe-inline'; img-src data:; sandbox";

function notFound(): Response {
  return new Response('Not Found', {
    status: 404,
    headers: { ...COMMON, 'Cache-Control': 'no-store', 'Content-Type': 'text/plain' },
  });
}

export const GET: RequestHandler = async ({ params, request }) => {
  const key = params.key;
  if (!isMediaKey(key)) return notFound();
  const storage = getStorage();
  const db = getDatabase();
  const [object] = await db
    .select({
      contentType: schema.mediaObjects.contentType,
      size: schema.mediaObjects.size,
      sha256: schema.mediaObjects.sha256,
      updatedAt: schema.mediaObjects.updatedAt,
    })
    .from(schema.mediaObjects)
    .where(and(eq(schema.mediaObjects.driver, storage.name), eq(schema.mediaObjects.key, key)));
  if (!object) return notFound();

  const { cacheDays } = await readStorageConfig(db);
  const etag = `"${object.sha256}"`;
  const headers: Record<string, string> = {
    ...COMMON,
    'Cache-Control': mediaCacheControl(cacheDays),
    'Content-Type': object.contentType,
    ETag: etag,
    'Last-Modified': object.updatedAt.toUTCString(),
    'Accept-Ranges': 'bytes',
  };
  if (object.contentType === 'image/svg+xml') headers['Content-Security-Policy'] = SVG_CSP;

  if (request.headers.get('if-none-match') === etag) {
    return new Response(null, { status: 304, headers });
  }

  const range = parseRange(request.headers.get('range'), object.size);
  if (range === 'invalid') {
    return new Response(null, {
      status: 416,
      headers: { ...headers, 'Content-Range': `bytes */${object.size}` },
    });
  }
  const body = await storage.get(key, range ?? undefined);
  if (!body) return notFound();
  if (range) {
    return new Response(body, {
      status: 206,
      headers: {
        ...headers,
        'Content-Range': `bytes ${range.start}-${range.end}/${object.size}`,
        'Content-Length': String(range.end - range.start + 1),
      },
    });
  }
  return new Response(body, {
    headers: { ...headers, 'Content-Length': String(object.size) },
  });
};
