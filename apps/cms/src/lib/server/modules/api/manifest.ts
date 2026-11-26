import { defineModule } from '@bluepax/core';

/** The "接入与 API" page: frontend base URL, Delivery Tokens, preview secret (admin only). */
export const API_MANAGE = 'api.manage';

// api module (chapter 3): the frontend (its base URL) and its secrets, the OpenAPI document and
// the Delivery API layer (tokens, rate limits, CORS; docs/adr/0012). The content endpoints are
// declared by the modules that own the content. Management Tokens, webhooks and the form key
// follow with the Management API (M2), webhooks (M2) and `inquiries` (M4).
export const apiModule = defineModule({
  id: 'api',
  version: '1.0.0',
  // Delivers the content and settings of these modules.
  dependsOn: ['media', 'pages', 'posts', 'site'],
  migrations: 'api',
  permissions: [{ name: API_MANAGE, kind: 'settings' }],
  menu: [{ label: 'nav_api', href: '/integration', permission: API_MANAGE }],
  endpoints: [
    { method: 'GET', path: '/delivery/v1/routes/resolve' },
    { method: 'GET', path: '/delivery/v1/schema/blocks' },
    { method: 'GET', path: '/delivery/v1/preview/{token}' },
    { method: 'GET', path: '/delivery/v1/openapi.json' },
  ],
});
