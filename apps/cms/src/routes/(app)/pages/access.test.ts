// Chapter 3 and 12: page actions need `pages.edit`; publishing, taking offline and choosing the
// home page also `pages.publish`, deleting `pages.delete`. Every page load and form action is
// called as a user who lacks the permission and must answer 403 before it touches the
// database; without a session they redirect to the login page.
import { isHttpError, isRedirect } from '@sveltejs/kit';
import { describe, expect, it } from 'vitest';
import { registry } from '#lib/server/modules.ts';
import type { AuthUser } from '#lib/server/modules/users/auth.ts';

function user(key: string, permissions: string[]): AuthUser {
  return {
    id: '00000000-0000-4000-8000-000000000001',
    email: `${key}@example.com`,
    displayName: key,
    locale: 'en',
    role: { id: '00000000-0000-4000-8000-000000000002', key, name: key },
    permissions: new Set(permissions),
    totpEnabled: false,
  };
}

/** A custom role without any page permission. */
const outsider = user('outsider', ['posts.edit', 'media.edit']);
/** A custom role that writes pages but may neither publish nor delete them. */
const writer = user('writer', ['pages.edit', 'media.edit']);

type Handler = (event: unknown) => unknown;
interface RouteModule {
  load?: Handler;
  actions?: Record<string, Handler>;
  GET?: Handler;
}

const modules = import.meta.glob<RouteModule>(['./**/+page.server.ts', './**/+server.ts'], {
  eager: true,
});

function event(current: AuthUser | null, method = 'GET') {
  const url = new URL('http://cms.test/pages/00000000-0000-4000-8000-000000000004?locale=en');
  const body = new FormData();
  body.set('locale', 'en');
  body.set('title', 'Title');
  body.set('slug', 'title');
  body.set('blocks', '[]');
  return {
    url,
    params: { id: '00000000-0000-4000-8000-000000000004' },
    locals: { user: current, sessionId: null },
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
  ...(mod.load ? [{ file, name: `${file} load`, method: 'GET', run: mod.load }] : []),
  ...(mod.GET ? [{ file, name: `${file} GET`, method: 'GET', run: mod.GET }] : []),
  ...Object.entries(mod.actions ?? {}).map(([action, run]) => ({
    file,
    name: `${file} ?/${action}`,
    method: 'POST',
    run,
  })),
]);
/** Actions beyond writing: publishing, taking offline, the home page, deleting. */
const privileged = handlers.filter((h) =>
  ['publish', 'unpublish', 'home', 'deleteTranslation', 'deletePage'].some((a) =>
    h.name.endsWith(`?/${a}`),
  ),
);

describe('pages access', () => {
  it('covers every page route and action', () => {
    expect(Object.keys(modules).sort()).toEqual([
      './+page.server.ts',
      './[id]/+page.server.ts',
      './new/+page.server.ts',
    ]);
    expect(handlers.filter((h) => h.method === 'POST').map((h) => h.name)).toEqual([
      './[id]/+page.server.ts ?/save',
      './[id]/+page.server.ts ?/submit',
      './[id]/+page.server.ts ?/withdraw',
      './[id]/+page.server.ts ?/publish',
      './[id]/+page.server.ts ?/unpublish',
      './[id]/+page.server.ts ?/home',
      './[id]/+page.server.ts ?/addTranslation',
      './[id]/+page.server.ts ?/deleteTranslation',
      './[id]/+page.server.ts ?/deletePage',
      './new/+page.server.ts ?/create',
    ]);
    expect(privileged).toHaveLength(5);
  });

  it('gives the default editor role every page permission', () => {
    const all = registry.order().map((m) => m.id);
    expect(registry.editorPermissions(all)).toEqual(
      expect.arrayContaining(['pages.edit', 'pages.publish', 'pages.delete']),
    );
  });

  it.each(handlers)('refuses users without a page permission: $name', async ({ run, method }) => {
    const result = await outcome(() => run(event(outsider, method)));
    expect(isHttpError(result, 403)).toBe(true);
  });

  it.each(privileged)('refuses writers to publish or delete: $name', async ({ run, method }) => {
    const result = await outcome(() => run(event(writer, method)));
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
