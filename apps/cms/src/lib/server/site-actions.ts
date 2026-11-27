// Form actions of the settings pages (site module). Admin only: the default editor role has no
// `site.*` permission, so pages, actions and downloads all answer 403 (chapter 12).
import { error, fail, type RequestEvent } from '@sveltejs/kit';
import { m } from '#lib/paraglide/messages.js';
import { requirePermission } from './guard.ts';
import { clientIp } from './http.ts';
import type { Actor } from './modules/site/settings.ts';
import { InvalidInputError } from './modules/site/values.ts';

export const SITE_PERMISSION = 'site.manage';

/**
 * Runs one settings form. Invalid input comes back as 400 with the form's name and the
 * failing fields, a missing record as 404; `run` may redirect. The name tells the page which
 * of its forms the result belongs to; it may depend on the form, e.g. `location:<id>`.
 */
export async function siteAction(
  event: RequestEvent,
  formName: string | ((form: FormData) => string),
  run: (form: FormData, actor: Actor) => Promise<unknown>,
) {
  const user = requirePermission(event.locals, SITE_PERMISSION);
  const form = await event.request.formData();
  const name = typeof formName === 'string' ? formName : formName(form);
  try {
    await run(form, { id: user.id, ip: clientIp(event) });
  } catch (err) {
    if (!(err instanceof InvalidInputError)) throw err;
    if (err.fields.includes('not_found')) error(404, m.error_not_found());
    return fail(400, {
      failed: name,
      invalid: err.fields,
      ...(err.reason && { reason: err.reason }),
      ...(err.details && { details: err.details }),
    });
  }
  return { saved: name };
}
