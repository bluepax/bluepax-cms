// Delivery API v1 (docs/spec/README.md chapter 6, docs/adr/0012): every request goes through
// handleDeliveryRequest, which authenticates, limits and routes it.
import { handleDeliveryRequest } from '#lib/server/delivery/http.ts';
import { clientIp } from '#lib/server/http.ts';
import { previewSecret } from '#lib/server/modules/api/frontend.ts';
import { registry } from '#lib/server/modules.ts';
import { encryptionKey, getDatabase, getStorage } from '#lib/server/runtime.ts';
import type { RequestHandler } from './$types';

const handle: RequestHandler = (event) =>
  handleDeliveryRequest(event.request, {
    db: getDatabase(),
    storage: getStorage(),
    registry,
    // adapter-node takes it from ORIGIN, which production sets to the CMS's public URL.
    origin: event.url.origin,
    clientIp: clientIp(event),
    previewSecret: () => previewSecret(getDatabase(), encryptionKey()),
  });

export const GET = handle;
export const OPTIONS = handle;
export const fallback = handle;
