import type { Handle, ServerInit } from '@sveltejs/kit/hooks';
import { hasRole, startup } from '#lib/server/runtime.ts';

export const init: ServerInit = async () => {
  await startup();
};

export const handle: Handle = async ({ event, resolve }) => {
  // A worker-only process still answers the container healthcheck.
  if (!hasRole('web') && event.url.pathname !== '/api/health') {
    return new Response('Not Found', { status: 404 });
  }
  const response = await resolve(event);
  // The whole CMS domain stays out of search engines (chapter 9, gateway requirements).
  response.headers.set('X-Robots-Tag', 'noindex, nofollow');
  return response;
};
