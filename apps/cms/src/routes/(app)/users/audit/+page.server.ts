import { listAudit } from '#lib/server/audit.ts';
import { requirePermission } from '#lib/server/guard.ts';
import { getDatabase } from '#lib/server/runtime.ts';
import type { PageServerLoad } from './$types';

const PAGE_SIZE = 50;

export const load: PageServerLoad = async ({ locals, url }) => {
  requirePermission(locals, 'users.manage');
  const before = Number(url.searchParams.get('before'));
  const entries = await listAudit(getDatabase(), {
    limit: PAGE_SIZE,
    ...(Number.isInteger(before) && before > 0 ? { beforeId: before } : {}),
  });
  return { entries, next: entries.length === PAGE_SIZE ? entries.at(-1)!.id : null };
};
