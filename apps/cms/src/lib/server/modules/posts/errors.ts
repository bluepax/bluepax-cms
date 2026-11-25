// Errors of the posts module. The code is shown to the user as the message `posts_error_<code>`.

export const POST_ERROR_CODES = [
  /** Fields failed validation; `fields` names them. */
  'invalid',
  'not_found',
  /** The language version exists already. */
  'translation_exists',
  /** Another post (category, tag, author) uses the slug in this language (409). */
  'slug_taken',
  /** The slug is reserved by the frontend or the route templates. */
  'slug_reserved',
  /** Someone else saved this since it was opened (409). */
  'edit_conflict',
  /** The status change is not possible from the current status. */
  'invalid_status',
  /** The only language version; delete the whole record instead. */
  'last_translation',
  /** Still used elsewhere; `items` names where (menu items, pages). */
  'in_use',
  /** The category or author still has posts; `count` says how many. */
  'has_posts',
  /** The author is the site's main author (the Person publisher). */
  'primary_author',
  /** Another author is linked to this account already; `title` names it. */
  'account_taken',
  /** A media item does not fit its field; `reason` is the media error code. */
  'media',
] as const;

export type PostErrorCode = (typeof POST_ERROR_CODES)[number];

export interface PostErrorDetails {
  /** Form fields that failed, e.g. `slug` or `categoryIds`. */
  fields?: string[];
  /** `media`: the media error code, e.g. `not_image`. */
  reason?: string;
  /** `in_use`: where the record is used, e.g. `header: Blog` or `Page: Home (en)`. */
  items?: string[];
  /** `slug_taken`, `account_taken`: title or name of the record that has it. */
  title?: string;
  /** `has_posts`: number of posts. */
  count?: number;
}

/** HTTP status of each code: conflicts are 409 (chapter 6), a missing record 404, others 400. */
export function postErrorStatus(code: PostErrorCode): 400 | 404 | 409 {
  if (code === 'not_found') return 404;
  if (code === 'slug_taken' || code === 'edit_conflict') return 409;
  return 400;
}

export class PostError extends Error {
  override name = 'PostError';
  readonly code: PostErrorCode;
  readonly details: PostErrorDetails;

  constructor(code: PostErrorCode, details: PostErrorDetails = {}) {
    super(`posts: ${code}${details.fields ? ` (${details.fields.join(', ')})` : ''}`);
    this.code = code;
    this.details = details;
  }
}
