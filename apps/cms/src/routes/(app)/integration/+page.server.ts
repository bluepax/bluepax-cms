import { DELIVERY_SCOPES } from '@bluepax/db';
import { error, fail, type RequestEvent } from '@sveltejs/kit';
import { m } from '#lib/paraglide/messages.js';
import { OPERATIONS } from '#lib/server/delivery/operations.ts';
import { field, requirePermission } from '#lib/server/guard.ts';
import { clientIp } from '#lib/server/http.ts';
import {
  frontendState,
  rotatePreviewSecret,
  saveFrontendBaseUrl,
} from '#lib/server/modules/api/frontend.ts';
import { API_MANAGE } from '#lib/server/modules/api/manifest.ts';
import {
  issueDeliveryToken,
  listDeliveryTokens,
  revokeDeliveryToken,
  TOKEN_EXPIRY_DAYS,
  type Actor,
} from '#lib/server/modules/api/tokens.ts';
import { InvalidInputError } from '#lib/server/modules/site/values.ts';
import { encryptionKey, getDatabase } from '#lib/server/runtime.ts';
import type { Actions, PageServerLoad } from './$types';

// "接入与 API" (chapter 6, docs/adr/0012): the frontend base URL, Delivery Tokens, the preview
// secret and the API documentation with a console. Admin only (`api.manage`): editors get 403.
export const load: PageServerLoad = async ({ locals }) => {
  requirePermission(locals, API_MANAGE);
  const db = getDatabase();
  return {
    frontend: await frontendState(db),
    tokens: await listDeliveryTokens(db),
    scopes: [...DELIVERY_SCOPES],
    expiryDays: [...TOKEN_EXPIRY_DAYS],
    operations: OPERATIONS.map((op) => ({
      operationId: op.operationId,
      path: op.path,
      summary: op.summary,
      params: op.params.map((p) => ({ name: p.name, in: p.in, required: p.required })),
    })),
  };
};

/** Runs one form of the page; invalid input comes back as 400 with the form's name and fields. */
async function apiAction<T>(
  event: RequestEvent,
  name: string,
  run: (form: FormData, actor: Actor) => Promise<T>,
) {
  const user = requirePermission(event.locals, API_MANAGE);
  const form = await event.request.formData();
  try {
    return { saved: name, result: await run(form, { id: user.id, ip: clientIp(event) }) };
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
}

export const actions: Actions = {
  frontend: (event) =>
    apiAction(event, 'frontend', async (form, actor) => {
      await saveFrontendBaseUrl(getDatabase(), field(form, 'baseUrl'), actor);
      return null;
    }),
  issue: (event) =>
    apiAction(event, 'issue', async (form, actor) => {
      const days = Number(field(form, 'expiresInDays'));
      const { token } = await issueDeliveryToken(
        getDatabase(),
        {
          name: field(form, 'name'),
          scopes: form
            .getAll('scopes')
            .filter((v): v is (typeof DELIVERY_SCOPES)[number] =>
              (DELIVERY_SCOPES as readonly unknown[]).includes(v),
            ),
          expiresInDays: (TOKEN_EXPIRY_DAYS as readonly number[]).includes(days)
            ? (days as (typeof TOKEN_EXPIRY_DAYS)[number])
            : null,
        },
        actor,
      );
      // Shown once, in this response only.
      return { token };
    }),
  revoke: (event) =>
    apiAction(event, 'revoke', async (form, actor) => {
      await revokeDeliveryToken(getDatabase(), field(form, 'id'), actor);
      return null;
    }),
  preview: (event) =>
    apiAction(event, 'preview', async (_form, actor) => ({
      secret: await rotatePreviewSecret(getDatabase(), encryptionKey(), actor),
    })),
};
