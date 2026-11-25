import { schema } from '@bluepax/db';
import { requirePermission } from '#lib/server/guard.ts';
import { PAGES_EDIT, currentSetup } from '#lib/server/pages-actions.ts';
import { listPages, type PageFilter } from '#lib/server/modules/pages/pages.ts';
import { getDatabase } from '#lib/server/runtime.ts';
import type { PageServerLoad } from './$types';

const STATUS_FILTERS = [...schema.CONTENT_STATUSES, 'missing'] as const;

export const load: PageServerLoad = async ({ locals, url }) => {
  requirePermission(locals, PAGES_EDIT);
  const setup = await currentSetup();
  const requested = url.searchParams.get('locale');
  const locale = setup.languages.some((l) => l.code === requested) ? requested! : setup.primary;
  const status = url.searchParams.get('status');
  const filter: PageFilter = {
    locale,
    ...((STATUS_FILTERS as readonly string[]).includes(status ?? '') && {
      status: status as PageFilter['status'] & string,
    }),
    query: url.searchParams.get('q') ?? '',
    page: Number(url.searchParams.get('page')) || 1,
  };
  return {
    list: await listPages(getDatabase(), filter),
    filter: { locale, status: filter.status ?? '', query: filter.query ?? '' },
    languages: setup.languages,
    primary: setup.primary,
    statuses: STATUS_FILTERS,
  };
};
