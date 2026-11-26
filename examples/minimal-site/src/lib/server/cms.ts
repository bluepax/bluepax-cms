// The Delivery API client of this frontend. Server-only: the token comes from `$app/env/private`
// and `$lib/server` cannot be imported by browser code (SvelteKit refuses to build that).
import { createCmsClient, memoryCache, type CmsClient } from '@bluepax/cms-client';
import { BLUEPAX_CMS_URL, BLUEPAX_DELIVERY_TOKEN } from '$app/env/private';

let client: CmsClient | undefined;

function create(): CmsClient {
  if (!BLUEPAX_CMS_URL || !BLUEPAX_DELIVERY_TOKEN) {
    throw new Error('Set BLUEPAX_CMS_URL and BLUEPAX_DELIVERY_TOKEN (see .env.example)');
  }
  return createCmsClient({
    baseUrl: BLUEPAX_CMS_URL,
    token: BLUEPAX_DELIVERY_TOKEN,
    // Revalidates with ETags, and keeps serving cached pages while the CMS is unreachable
    // (chapter 6, frontend checklist step 7).
    cache: memoryCache({ maxEntries: 1000 }),
    staleIfError: true,
    onStale: ({ url, error }) => console.warn(`[cms] ${error.code}: serving the cached ${url}`),
  });
}

/** The client for one request, sending through that request's `event.fetch`. */
export function cms(fetch: typeof globalThis.fetch): CmsClient {
  client ??= create();
  return client.withFetch(fetch);
}

/** The CMS's origin, for the Content-Security-Policy (media URLs start with it). */
export function cmsOrigin(): string | null {
  return BLUEPAX_CMS_URL ? new URL(BLUEPAX_CMS_URL).origin : null;
}
