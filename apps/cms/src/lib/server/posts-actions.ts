// Form actions of the posts module. Posts need `posts.edit`; publishing, taking offline and the
// publication date also `posts.publish`, deleting `posts.delete`. Categories and tags need
// `posts.taxonomy`, authors `posts.authors` (chapter 3). UI and API refuse alike (chapter 12).
import { error, fail, type RequestEvent } from '@sveltejs/kit';
import { m } from '#lib/paraglide/messages.js';
import { requirePermission } from './guard.ts';
import { clientIp } from './http.ts';
import type { Actor } from './modules/posts/common.ts';
import { PostError, postErrorStatus } from './modules/posts/errors.ts';
import { postsSetup } from './modules/posts/posts.ts';
import { getDatabase } from './runtime.ts';

export {
  POSTS_AUTHORS,
  POSTS_DELETE,
  POSTS_EDIT,
  POSTS_PUBLISH,
  POSTS_TAXONOMY,
} from './modules/posts/manifest.ts';

/** Content languages and reserved slugs of the current instance. */
export function currentPostsSetup() {
  return postsSetup(getDatabase());
}

/** The language asked for in the URL if it is a content language, else the fallback. */
export function chosenLocale(
  url: URL,
  languages: readonly { code: string }[],
  fallback: string,
): string {
  const requested = url.searchParams.get('locale');
  return languages.some((l) => l.code === requested) ? requested! : fallback;
}

/**
 * Runs one posts form after checking every permission in `permissions` (the first is the
 * area's own). A PostError comes back as 400 / 409 with its code, fields and details; a
 * missing record is a 404. `run` may redirect.
 */
export async function postAction(
  event: RequestEvent,
  permissions: readonly [string, ...string[]],
  formName: string,
  run: (form: FormData, actor: Actor) => Promise<unknown>,
) {
  let user = requirePermission(event.locals, permissions[0]);
  for (const permission of permissions.slice(1)) {
    user = requirePermission(event.locals, permission);
  }
  const form = await event.request.formData();
  let result: unknown;
  try {
    result = await run(form, { id: user.id, ip: clientIp(event) });
  } catch (err) {
    if (!(err instanceof PostError)) throw err;
    if (err.code === 'not_found') error(404, m.error_not_found());
    return fail(postErrorStatus(err.code), {
      failed: formName,
      error: err.code,
      invalid: err.details.fields ?? [],
      details: err.details,
    });
  }
  return { saved: formName, ...(result && typeof result === 'object' ? result : {}) };
}

/** Loads a record, turning a missing one into a 404. */
export async function loadOr404<T>(load: () => Promise<T>): Promise<T> {
  try {
    return await load();
  } catch (err) {
    if (err instanceof PostError && err.code === 'not_found') error(404, m.error_not_found());
    throw err;
  }
}
