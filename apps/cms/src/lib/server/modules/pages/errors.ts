// Errors of the pages module. The code is shown to the user as the message `pages_error_<code>`.

export const PAGE_ERROR_CODES = [
  /** Fields failed validation; `fields` names them. */
  'invalid',
  'not_found',
  /** The language version exists already. */
  'translation_exists',
  /** Another page uses the slug in this language (409). */
  'slug_taken',
  /** The slug is reserved by the frontend or the route templates. */
  'slug_reserved',
  /** Someone else saved this language since it was opened (409). */
  'edit_conflict',
  /** The status change is not possible from the current status. */
  'invalid_status',
  /** The home page cannot be deleted; choose another home page first. */
  'home_page',
  /** Menu items link to the page; `items` names them. */
  'in_navigation',
  /** The only language version; delete the page instead. */
  'last_translation',
  /** The block type is not available on this instance. */
  'block_unavailable',
  /** A media item does not fit its field; `reason` is the media error code. */
  'media',
] as const;

export type PageErrorCode = (typeof PAGE_ERROR_CODES)[number];

export interface PageErrorDetails {
  /** Form fields that failed, e.g. `slug` or `blocks.2.data.buttons.0.url`. */
  fields?: string[];
  /** `media`: the media error code, e.g. `not_image`. */
  reason?: string;
  /** `in_navigation`: labels of the menu items that link here. */
  items?: string[];
  /** `slug_taken`: title of the page that has the slug. */
  title?: string;
}

/** HTTP status of each code: conflicts are 409 (chapter 6), a missing page 404, others 400. */
export function pageErrorStatus(code: PageErrorCode): 400 | 404 | 409 {
  if (code === 'not_found') return 404;
  if (code === 'slug_taken' || code === 'edit_conflict') return 409;
  return 400;
}

export class PageError extends Error {
  override name = 'PageError';
  readonly code: PageErrorCode;
  readonly details: PageErrorDetails;

  constructor(code: PageErrorCode, details: PageErrorDetails = {}) {
    super(`pages: ${code}${details.fields ? ` (${details.fields.join(', ')})` : ''}`);
    this.code = code;
    this.details = details;
  }
}
