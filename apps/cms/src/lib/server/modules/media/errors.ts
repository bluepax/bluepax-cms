// Errors of the media module. The code is shown to the user as the message `media_error_<code>`.

export const MEDIA_ERROR_CODES = [
  'empty_file',
  'executable',
  'unsupported_type',
  'too_large',
  'invalid_file',
  'duplicate',
  'same_file',
  'kind_mismatch',
  'in_use',
  'not_found',
  'folder_not_found',
  'folder_exists',
  'folder_not_empty',
  'folder_too_deep',
  'folder_cycle',
  'invalid_name',
  'not_image',
  'not_image_or_video',
  'not_square_png',
] as const;

export type MediaErrorCode = (typeof MEDIA_ERROR_CODES)[number];

export interface MediaErrorDetails {
  /** `too_large`: the limit of the file's kind. */
  limitMb?: number;
  /** `duplicate`: the media item that already has this file. */
  existingId?: string;
  /** `not_square_png`: the minimum edge length. */
  minSize?: number;
}

export class MediaError extends Error {
  override name = 'MediaError';
  readonly code: MediaErrorCode;
  readonly details: MediaErrorDetails;

  constructor(code: MediaErrorCode, details: MediaErrorDetails = {}) {
    super(`media: ${code}`);
    this.code = code;
    this.details = details;
  }
}
