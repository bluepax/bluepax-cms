import { error, redirect } from '@sveltejs/kit';
import { pageParam } from '#lib/format.ts';
import { isLocalPath } from '#lib/links.ts';
import { cms } from '#lib/server/cms.ts';
import { fromCms, viewOf } from '#lib/server/content.ts';
import type { PageServerLoad } from './$types';

// Every address goes to `/routes/resolve` (chapter 6, checklist step 2): the frontend follows the
// route templates the CMS sends instead of keeping its own list of addresses.
export const load: PageServerLoad = async ({ url, fetch, locals }) => {
  const client = cms(fetch);
  const route = await fromCms(client.resolveRoute(url.pathname), locals);
  if (route.status === 301) {
    if (!isLocalPath(route.location)) error(404, 'Not found', { code: 'not_found' });
    redirect(301, `${route.location}${url.search}`);
  }
  if (route.status !== 200) {
    // 404 now; the CMS adds 410 for permanently deleted content in M2.
    const gone = (route.status as number) === 410;
    error(gone ? 410 : 404, 'Not found', { code: gone ? 'gone' : 'not_found' });
  }
  const page = pageParam(url);
  if (page === null) error(404, 'Not found', { code: 'not_found' });
  return {
    view: await fromCms(viewOf(client, route, page), locals),
    alternates: route.alternates,
  };
};
