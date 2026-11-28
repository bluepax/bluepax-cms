import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { error } from '@sveltejs/kit';
import { m } from '#lib/paraglide/messages.js';
import { audit } from '#lib/server/audit.ts';
import { BACKUPS_PERMISSION, backupName } from '#lib/server/backups.ts';
import { requirePermission } from '#lib/server/guard.ts';
import { clientIp } from '#lib/server/http.ts';
import { backupsDir, getDatabase } from '#lib/server/runtime.ts';
import { SITE_PERMISSION } from '#lib/server/site-actions.ts';
import type { RequestHandler } from './$types';

/**
 * Downloads one backup file (a pg_dump custom-format archive, restored with pg_restore). The
 * whole database is in it, so only `site.backups` may, and every download is audited.
 */
export const GET: RequestHandler = async (event) => {
  requirePermission(event.locals, SITE_PERMISSION);
  const user = requirePermission(event.locals, BACKUPS_PERMISSION);
  const dir = backupsDir();
  const name = backupName(event.params.name);
  if (!dir || !name) error(404, m.error_not_found());
  const path = join(dir, name);
  const info = await stat(path).catch(() => null);
  if (!info?.isFile()) error(404, m.error_not_found());
  const size = info.size;
  await audit(getDatabase(), {
    action: 'site.backup_download',
    actorId: user.id,
    targetType: 'backup',
    targetId: name,
    ip: clientIp(event),
  });
  const body = Readable.toWeb(createReadStream(path)) as ReadableStream<Uint8Array>;
  return new Response(body, {
    headers: {
      'Content-Type': 'application/octet-stream',
      'Content-Length': String(size),
      'Content-Disposition': `attachment; filename="${name}"`,
      'Cache-Control': 'no-store',
    },
  });
};
