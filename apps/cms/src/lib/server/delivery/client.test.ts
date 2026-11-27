// The published SDK against the CMS (docs/adr/0013): the client's endpoint table must match the
// operations the CMS serves, and preview tokens the CMS signs must pass the SDK's check.
import { DELIVERY_API_PREFIX, DELIVERY_ENDPOINTS, verifyPreviewToken } from '@bluepax/cms-client';
import { describe, expect, it } from 'vitest';
import { createPreviewToken, PREVIEW_TTL_SECONDS } from '../modules/api/preview.ts';
import { DELIVERY_PREFIX } from './http.ts';
import { OPERATIONS } from './operations.ts';

describe('@bluepax/cms-client', () => {
  it('calls every Delivery operation with its path and query parameters', () => {
    expect(DELIVERY_API_PREFIX).toBe(DELIVERY_PREFIX);
    const served = Object.fromEntries(
      OPERATIONS.map((op) => [
        op.operationId,
        {
          path: op.path,
          query: op.params.filter((p) => p.in === 'query').map((p) => p.name),
        },
      ]),
    );
    const called = Object.fromEntries(
      Object.entries(DELIVERY_ENDPOINTS).map(([id, endpoint]) => [
        id,
        { path: endpoint.path, query: [...endpoint.query] },
      ]),
    );
    expect(called).toEqual(served);
  });

  it('verifies the preview tokens the CMS signs', async () => {
    const secret = 'bpxp_cross-check-secret';
    const now = new Date('2026-11-26T10:00:00Z');
    const target = {
      type: 'page',
      id: '11111111-1111-4111-8111-111111111111',
      locale: 'zh-CN',
    } as const;
    const { token, expiresAt } = createPreviewToken(secret, target, now);
    await expect(verifyPreviewToken(secret, token, now)).resolves.toEqual({
      ok: true,
      target,
      expiresAt,
    });
    await expect(verifyPreviewToken('bpxp_other', token, now)).resolves.toEqual({
      ok: false,
      reason: 'invalid',
    });
    const later = new Date(now.getTime() + PREVIEW_TTL_SECONDS * 1000);
    await expect(verifyPreviewToken(secret, token, later)).resolves.toEqual({
      ok: false,
      reason: 'expired',
    });
  });
});
