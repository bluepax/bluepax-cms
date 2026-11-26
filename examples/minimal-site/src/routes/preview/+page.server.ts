import { isCmsError, verifyPreviewToken, type Preview } from '@bluepax/cms-client';
import { error } from '@sveltejs/kit';
import { BLUEPAX_PREVIEW_SECRET } from '$app/env/private';
import { cms } from '#lib/server/cms.ts';
import {
  cmsFailure,
  directionOf,
  fromCms,
  logUnknownBlocks,
  siteFor,
} from '#lib/server/content.ts';
import type { PageServerLoad } from './$types';

// The preview route of the editors' "预览" button: `/preview?token=…` (chapter 6, checklist step
// 5). hooks.server.ts answers it with `Cache-Control: no-store` and `X-Robots-Tag: noindex`.
export const load: PageServerLoad = async ({ url, fetch, locals }) => {
  const token = url.searchParams.get('token');
  if (!token) error(400, 'Missing preview token', { code: 'preview_missing' });
  // Optional early check with the preview secret; the CMS checks the link again either way.
  if (BLUEPAX_PREVIEW_SECRET) {
    const check = await verifyPreviewToken(BLUEPAX_PREVIEW_SECRET, token);
    if (!check.ok) previewError(check.reason === 'expired' ? 'preview_expired' : 'preview_invalid');
  }
  const client = cms(fetch);
  let preview: Preview;
  try {
    preview = await client.getPreview(token);
  } catch (cause) {
    if (
      isCmsError(cause) &&
      (cause.code === 'preview_expired' || cause.code === 'preview_invalid')
    ) {
      previewError(cause.code);
    }
    cmsFailure(cause, locals);
  }
  const content = preview.type === 'page' ? preview.page : preview.post;
  if (preview.type === 'page') logUnknownBlocks(preview.page);
  const site = await fromCms(siteFor(client, content.locale), locals);
  locals.contentLanguage = { lang: content.locale, dir: directionOf(site, content.locale) };
  return { preview, site, alternates: null };
};

function previewError(code: 'preview_expired' | 'preview_invalid'): never {
  error(403, code === 'preview_expired' ? 'Preview link expired' : 'Invalid preview link', {
    code,
  });
}
