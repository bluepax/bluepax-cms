// Form actions of the page editor. Every action needs `pages.edit`; publishing, taking offline
// and choosing the home page also `pages.publish`, deleting `pages.delete` (chapter 3). UI and
// API refuse alike (chapter 12).
import { error, fail, type RequestEvent } from '@sveltejs/kit';
import { m } from '#lib/paraglide/messages.js';
import { requirePermission } from './guard.ts';
import { clientIp } from './http.ts';
import { activeModules } from './instance.ts';
import { registry } from './modules.ts';
import { PageError, pageErrorStatus } from './modules/pages/errors.ts';
import { PAGES_EDIT } from './modules/pages/manifest.ts';
import { pagesSetup, type Actor } from './modules/pages/pages.ts';
import { getDatabase } from './runtime.ts';

export { PAGES_DELETE, PAGES_EDIT, PAGES_PUBLISH } from './modules/pages/manifest.ts';

/** Content languages, reserved slugs and the blocks on offer, for the current instance. */
export async function currentSetup() {
  const db = getDatabase();
  return pagesSetup(db, registry, await activeModules(db, registry));
}

/**
 * Runs one page form after checking `pages.edit` and the extra permissions. A PageError comes
 * back as 400 / 409 with its code, fields and details; a missing page is a 404. `run` may
 * redirect.
 */
export async function pageAction(
  event: RequestEvent,
  permissions: readonly string[],
  formName: string,
  run: (form: FormData, actor: Actor) => Promise<unknown>,
) {
  let user = requirePermission(event.locals, PAGES_EDIT);
  for (const permission of permissions) user = requirePermission(event.locals, permission);
  const form = await event.request.formData();
  let result: unknown;
  try {
    result = await run(form, { id: user.id, ip: clientIp(event) });
  } catch (err) {
    if (!(err instanceof PageError)) throw err;
    if (err.code === 'not_found') error(404, m.error_not_found());
    return fail(pageErrorStatus(err.code), {
      failed: formName,
      error: err.code,
      invalid: err.details.fields ?? [],
      details: err.details,
    });
  }
  return { saved: formName, ...(result && typeof result === 'object' ? result : {}) };
}
