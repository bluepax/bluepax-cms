// Chapter 12: editors cannot reach tokens ("Token" in the list of what editors cannot open), in
// the UI or through the API. The page load and every form action of "接入与 API" are called as
// an editor and must answer 403 before they touch the database; without a session they
// redirect to the login page.
import { isHttpError, isRedirect } from '@sveltejs/kit';
import { describe, expect, it } from 'vitest';
import type { AuthUser } from '#lib/server/modules/users/auth.ts';
import { actions, load } from './+page.server.ts';

const editor: AuthUser = {
  id: '00000000-0000-4000-8000-000000000001',
  email: 'editor@example.com',
  displayName: 'Editor',
  locale: 'en',
  role: { id: '00000000-0000-4000-8000-000000000002', key: 'editor', name: 'Editor' },
  permissions: new Set(['pages.edit', 'posts.edit', 'media.edit']),
  totpEnabled: false,
};

type Handler = (event: never) => unknown;

function event(user: AuthUser | null, method = 'GET') {
  const url = new URL('http://cms.test/integration');
  const body = new FormData();
  body.set('id', '00000000-0000-4000-8000-000000000003');
  return {
    url,
    params: {},
    locals: { user, sessionId: null },
    request: new Request(url, method === 'POST' ? { method, body } : { method }),
    getClientAddress: () => '127.0.0.1',
  } as never;
}

async function outcome(run: () => unknown): Promise<unknown> {
  try {
    await run();
    return 'allowed';
  } catch (error) {
    return error;
  }
}

const handlers = [
  { name: 'load', method: 'GET', run: load as Handler },
  ...Object.entries(actions).map(([name, run]) => ({
    name: `?/${name}`,
    method: 'POST',
    run: run as Handler,
  })),
];

describe('integration page access', () => {
  it('covers the page and its four forms', () => {
    expect(handlers.map((h) => h.name)).toEqual([
      'load',
      '?/frontend',
      '?/issue',
      '?/revoke',
      '?/preview',
    ]);
  });

  it.each(handlers)('refuses editors: $name', async ({ run, method }) => {
    const result = await outcome(() => run(event(editor, method)));
    expect(isHttpError(result, 403)).toBe(true);
  });

  it.each(handlers)(
    'sends anonymous requests to the login page: $name',
    async ({ run, method }) => {
      const result = await outcome(() => run(event(null, method)));
      expect(isRedirect(result) && result.location === '/login').toBe(true);
    },
  );
});
