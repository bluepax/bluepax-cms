import { error, fail } from '@sveltejs/kit';
import { m } from '#lib/paraglide/messages.js';
import {
  BACKUPS_PERMISSION,
  backupOverview,
  deleteBackup,
  requestBackup,
  syncBackupSchedule,
} from '#lib/server/backups.ts';
import { field, requirePermission } from '#lib/server/guard.ts';
import { clientIp } from '#lib/server/http.ts';
import { saveBackupSettings } from '#lib/server/modules/site/settings.ts';
import { backupsDir, getDatabase, getJobs } from '#lib/server/runtime.ts';
import { SITE_PERMISSION, siteAction } from '#lib/server/site-actions.ts';
import type { Actions, PageServerLoad, RequestEvent } from './$types';

// "设置 → 备份" (chapter 9, "备份与可观测"; docs/adr/0019): schedule and retention, the
// backup files and the latest results. Admin only, like every settings page, and the
// backups have a permission of their own: downloading one hands out the whole database.

function allow(event: RequestEvent) {
  requirePermission(event.locals, SITE_PERMISSION);
  return requirePermission(event.locals, BACKUPS_PERMISSION);
}

export const load: PageServerLoad = async (event) => {
  allow(event);
  return { overview: await backupOverview(getDatabase(), getJobs(), backupsDir()) };
};

export const actions: Actions = {
  settings: (event) =>
    siteAction(event, 'settings', async (form, actor) => {
      allow(event);
      const db = getDatabase();
      await saveBackupSettings(
        db,
        {
          time: field(form, 'time'),
          keepDaily: Number(field(form, 'keepDaily') || Number.NaN),
          keepWeekly: Number(field(form, 'keepWeekly') || Number.NaN),
        },
        actor,
      );
      await syncBackupSchedule(db, getJobs());
    }),

  run: async (event) => {
    const user = allow(event);
    if (!backupsDir()) return fail(409, { failed: 'run', reason: 'backups_off' });
    const queued = await requestBackup(getDatabase(), getJobs(), {
      id: user.id,
      ip: clientIp(event),
    });
    if (!queued) return fail(409, { failed: 'run', reason: 'backup_pending' });
    return { saved: 'run' };
  },

  delete: async (event) => {
    const user = allow(event);
    const dir = backupsDir();
    const name = field(await event.request.formData(), 'name');
    if (!dir) error(404, m.error_not_found());
    const deleted = await deleteBackup(getDatabase(), dir, name, {
      id: user.id,
      ip: clientIp(event),
    });
    if (!deleted) error(404, m.error_not_found());
    return { saved: 'delete' };
  },
};
