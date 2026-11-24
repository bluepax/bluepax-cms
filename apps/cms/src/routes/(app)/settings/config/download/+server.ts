import { stringifyConfig } from '@bluepax/presets';
import { audit } from '#lib/server/audit.ts';
import { requirePermission } from '#lib/server/guard.ts';
import { clientIp } from '#lib/server/http.ts';
import { exportInstanceConfig } from '#lib/server/instance.ts';
import { getDatabase } from '#lib/server/runtime.ts';
import { SITE_PERMISSION } from '#lib/server/site-actions.ts';
import type { RequestHandler } from './$types';

/** The instance configuration as a YAML file (no secrets), to commit to the deployment repository. */
export const GET: RequestHandler = async (event) => {
  const user = requirePermission(event.locals, SITE_PERMISSION);
  const db = getDatabase();
  const yaml = stringifyConfig(await exportInstanceConfig(db));
  await audit(db, { action: 'site.config_export', actorId: user.id, ip: clientIp(event) });
  return new Response(yaml, {
    headers: {
      'Content-Type': 'application/yaml; charset=utf-8',
      'Content-Disposition': 'attachment; filename="instance-config.yaml"',
      'Cache-Control': 'no-store',
    },
  });
};
