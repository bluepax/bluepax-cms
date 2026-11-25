// Chapter 3 and 12: editors use the media library but not the storage settings, in the UI and
// through the API. Every media page load, form action and endpoint is called as a user who
// lacks the permission and must answer 403 before it touches the database; without a session
// they redirect to the login page.
import { isHttpError, isRedirect } from '@sveltejs/kit';
import { describe, expect, it } from 'vitest';
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

/** The default editor role: content actions of the media module, no storage settings. */
const editor = user('editor', ['pages.edit', 'posts.edit', 'media.edit']);
/** A custom role without any permission that edits records with media. */
const writer = user('writer', ['posts.publish']);

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
  const url = new URL('http://cms.test/media');
  const body = new FormData();
  body.set('id', '00000000-0000-4000-8000-000000000003');
  body.set('file', new File([new Uint8Array([1, 2, 3])], 'a.png'));
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
const storage = handlers.filter((h) => h.file.startsWith('./storage/'));

describe('media access', () => {
  it('covers every media page, action and endpoint', () => {
    expect(Object.keys(modules).sort()).toEqual([
      './+page.server.ts',
      './[id]/+page.server.ts',
      './picker/+server.ts',
      './storage/+page.server.ts',
    ]);
    expect(handlers.filter((h) => h.method === 'POST').length).toBe(8);
    expect(storage.map((h) => h.name)).toEqual([
      './storage/+page.server.ts load',
      './storage/+page.server.ts ?/save',
    ]);
  });

  it.each(handlers)('refuses users without a media permission: $name', async ({ run, method }) => {
    const result = await outcome(() => run(event(writer, method)));
    expect(isHttpError(result, 403)).toBe(true);
  });

  it.each(storage)('refuses editors the storage settings: $name', async ({ run, method }) => {
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
