import { cms } from '#lib/server/cms.ts';
import { directionOf, fromCms, siteFor } from '#lib/server/content.ts';
import type { LayoutServerLoad } from './$types';

// Rendered on the server only: no client-side JavaScript, so nothing about the CMS or its token
// can reach the browser beyond the HTML itself.
export const csr = false;
// The CMS decides about trailing slashes: `/routes/resolve` answers them with a 301.
export const trailingSlash = 'ignore';

export const load: LayoutServerLoad = async ({ url, fetch, locals }) => {
  const first = url.pathname.split('/')[1];
  const site = await fromCms(siteFor(cms(fetch), first || undefined), locals);
  locals.layoutLanguage = { lang: site.locale, dir: directionOf(site, site.locale) };
  locals.mediaOrigin = new URL(site.mediaOrigin.baseUrl).origin;
  return { site };
};
