// Chapter 12: editors cannot open user management (accounts, roles, the audit log), in the UI or
// through the API. Every users page load and form action is called with the default editor role
// and must answer 403 before it touches the database; without a session they redirect to the
// login page.
import { isHttpError, isRedirect } from '@sveltejs/kit';
import { describe, expect, it } from 'vitest';
import { defaultEditor } from '#lib/server/testing.ts';
import type { AuthUser } from '#lib/server/modules/users/auth.ts';

const editor = defaultEditor();

type Handler = (event: unknown) => unknown;
interface RouteModule {
  load?: Handler;
  actions?: Record<string, Handler>;
  GET?: Handler;
}

const modules = import.meta.glob<RouteModule>(
  ['./**/+page.server.ts', './**/+layout.server.ts', './**/+server.ts'],
  { eager: true },
);

function event(user: AuthUser | null, method = 'GET') {
  const url = new URL('http://cms.test/users');
  const body = new FormData();
  body.set('id', '00000000-0000-4000-8000-000000000003');
  body.set('session', '00000000-0000-4000-8000-000000000005');
  return {
    url,
    params: { id: '00000000-0000-4000-8000-000000000004' },
    locals: { user, sessionId: null },
    request: new Request(url, method === 'POST' ? { method, body } : { method }),
    getClientAddress: () => '127.0.0.1',
  };
}

async function outcome(run: () => unknown): Promise<unknown> {
  try {
    await run();
    return 'allowed';
  } catch (error) {
    return error;
  }
}

const handlers = Object.entries(modules).flatMap(([file, mod]) => [
  ...(mod.load ? [{ name: `${file} load`, method: 'GET', run: mod.load }] : []),
  ...(mod.GET ? [{ name: `${file} GET`, method: 'GET', run: mod.GET }] : []),
  ...Object.entries(mod.actions ?? {}).map(([action, run]) => ({
    name: `${file} ?/${action}`,
    method: 'POST',
    run,
  })),
]);

describe('users access', () => {
  it('covers every users page and action', () => {
    expect(Object.keys(modules).sort()).toEqual([
      './+page.server.ts',
      './[id]/+page.server.ts',
      './audit/+page.server.ts',
      './new/+page.server.ts',
      './roles/+page.server.ts',
    ]);
    expect(handlers.filter((h) => h.method === 'POST').length).toBe(11);
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
