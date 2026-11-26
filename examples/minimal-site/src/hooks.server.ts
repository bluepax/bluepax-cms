import type { Handle, HandleServerError } from '@sveltejs/kit/hooks';
import { htmlLang } from '#lib/format.ts';
import { cmsOrigin } from '#lib/server/cms.ts';

/**
 * Pages render on the server only (no client JavaScript, see +layout.server.ts), so the policy
 * allows no scripts at all; JSON-LD is a data block, not a script, and is not affected. Media
 * come from the CMS (or its distribution origin, which `/site` names).
 */
function contentSecurityPolicy(locals: App.Locals): string {
  const sources = ["'self'", 'data:', cmsOrigin(), locals.mediaOrigin].filter(Boolean);
  const media = [...new Set(sources)].join(' ');
  return [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    `img-src ${media}`,
    `media-src ${media}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; ');
}

export const handle: Handle = async ({ event, resolve }) => {
  let response = await resolve(event, {
    // The loads, which run before the page is rendered, say the language (see app.d.ts).
    transformPageChunk: ({ html }) => {
      const language = event.locals.contentLanguage ?? event.locals.layoutLanguage;
      return html
        .replace('%lang%', htmlLang(language?.lang))
        .replace('%dir%', language?.dir === 'rtl' ? 'rtl' : 'ltr');
    },
  });
  const headers: Record<string, string> = {
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Content-Security-Policy': contentSecurityPolicy(event.locals),
  };
  // Previews are never cached or indexed (chapter 6, checklist step 5), error pages included.
  if (event.route.id === '/preview') {
    headers['Cache-Control'] = 'no-store';
    headers['X-Robots-Tag'] = 'noindex, nofollow';
  }
  // While the CMS is unreachable and nothing is cached: 503 with Retry-After (step 7).
  if (response.status === 503) headers['Retry-After'] = String(event.locals.retryAfter ?? 30);
  try {
    for (const [name, value] of Object.entries(headers)) response.headers.set(name, value);
  } catch {
    // Some responses (e.g. redirects) have immutable headers; copy them into a new response.
    response = new Response(response.body, response);
    for (const [name, value] of Object.entries(headers)) response.headers.set(name, value);
  }
  return response;
};

/** Unexpected errors are logged; the visitor sees SvelteKit's default "Internal Error". */
export const handleError: HandleServerError = ({ kind, error }) => {
  if (kind === 'unknown') console.error(error);
};
