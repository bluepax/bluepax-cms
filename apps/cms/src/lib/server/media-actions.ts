// Form actions of the media library. The media pages need `media.edit` (editors have it); the
// storage settings need `media.storage` (admins only). UI and API refuse alike (chapter 12).
import { error, fail, type RequestEvent } from '@sveltejs/kit';
import { m } from '#lib/paraglide/messages.js';
import { requirePermission } from './guard.ts';
import { clientIp } from './http.ts';
import { MediaError } from './modules/media/errors.ts';
import type { Actor, MediaContext } from './modules/media/library.ts';
import { InvalidInputError } from './modules/site/values.ts';
import { getDatabase, getStorage } from './runtime.ts';

export { MEDIA_PERMISSION, STORAGE_PERMISSION } from './modules/media/manifest.ts';

export function mediaContext(): MediaContext {
  return { db: getDatabase(), storage: getStorage() };
}

/**
 * Runs one media form. A MediaError comes back as 400 with its code and details, invalid
 * fields as 400 with the field names, a missing item as 404. `run` may redirect.
 */
export async function mediaAction(
  event: RequestEvent,
  permission: string,
  formName: string,
  run: (form: FormData, actor: Actor) => Promise<unknown>,
) {
  const user = requirePermission(event.locals, permission);
  const form = await event.request.formData();
  let result: unknown;
  try {
    result = await run(form, { id: user.id, ip: clientIp(event) });
  } catch (err) {
    if (err instanceof MediaError) {
      if (err.code === 'not_found') error(404, m.error_not_found());
      return fail(400, { failed: formName, error: err.code, details: err.details });
    }
    if (err instanceof InvalidInputError) {
      return fail(400, { failed: formName, invalid: err.fields });
    }
    throw err;
  }
  return { saved: formName, ...(result && typeof result === 'object' ? result : {}) };
}

/** An uploaded file from a form field, or null when none was chosen. */
export async function uploadedFile(
  form: FormData,
  name: string,
): Promise<{ name: string; data: Uint8Array } | null> {
  const value = form.get(name);
  if (!(value instanceof File) || value.size === 0) return null;
  return { name: value.name, data: new Uint8Array(await value.arrayBuffer()) };
}
