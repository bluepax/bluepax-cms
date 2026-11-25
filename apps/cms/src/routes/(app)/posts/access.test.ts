// Chapter 3 and 12: post actions need `posts.edit`; publishing, taking offline and the
// publication date also `posts.publish`, deleting `posts.delete`; categories and tags need
// `posts.taxonomy`, authors `posts.authors`. Every load, form action and endpoint is called as
// a user who lacks the permission and must answer 403 before it touches the database; without
// a session they redirect to the login page.
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

/** A custom role without any posts permission (and no page editing for the post picker). */
const outsider = user('outsider', ['pages.publish', 'media.edit']);
/** Writes posts but may neither publish nor delete them, nor manage taxonomy or authors. */
const writer = user('writer', ['posts.edit', 'media.edit']);
/** Manages categories and tags only. */
const taxonomist = user('taxonomist', ['posts.taxonomy']);

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
  const url = new URL('http://cms.test/posts/00000000-0000-4000-8000-000000000004?locale=en');
  const body = new FormData();
  body.set('locale', 'en');
  body.set('title', 'Title');
  body.set('name', 'Name');
  body.set('slug', 'title');
  body.set('body', '{"type":"doc"}');
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
const area = (file: string) =>
  file.startsWith('./categories/') || file.startsWith('./tags/')
    ? 'taxonomy'
    : file.startsWith('./authors/')
      ? 'authors'
      : file.startsWith('./picker/')
        ? 'picker'
        : 'posts';
const posts = handlers.filter((h) => area(h.file) === 'posts');
const managed = handlers.filter((h) => ['taxonomy', 'authors'].includes(area(h.file)));
const authors = handlers.filter((h) => area(h.file) === 'authors');
/** Post actions beyond writing: publishing, taking offline, deleting. */
const privileged = posts.filter((h) =>
  ['publish', 'unpublish', 'deleteTranslation', 'deletePost'].some((a) =>
    h.name.endsWith(`?/${a}`),
  ),
);

describe('posts access', () => {
  it('covers every posts route, action and endpoint', () => {
    expect(Object.keys(modules).sort()).toEqual([
      './+page.server.ts',
      './[id]/+page.server.ts',
      './authors/+page.server.ts',
      './authors/[id]/+page.server.ts',
      './authors/new/+page.server.ts',
      './categories/+page.server.ts',
      './categories/[id]/+page.server.ts',
      './new/+page.server.ts',
      './picker/+server.ts',
      './tags/+page.server.ts',
      './tags/[id]/+page.server.ts',
    ]);
    expect(posts.filter((h) => h.method === 'POST').map((h) => h.name)).toEqual([
      './[id]/+page.server.ts ?/save',
      './[id]/+page.server.ts ?/submit',
      './[id]/+page.server.ts ?/withdraw',
      './[id]/+page.server.ts ?/publish',
      './[id]/+page.server.ts ?/unpublish',
      './[id]/+page.server.ts ?/addTranslation',
      './[id]/+page.server.ts ?/deleteTranslation',
      './[id]/+page.server.ts ?/deletePost',
      './new/+page.server.ts ?/create',
    ]);
    expect(privileged).toHaveLength(4);
    expect(managed.filter((h) => h.method === 'POST')).toHaveLength(12);
  });

  it('gives the default editor role every posts permission', () => {
    const all = registry.order().map((m) => m.id);
    expect(registry.editorPermissions(all)).toEqual(
      expect.arrayContaining([
        'posts.edit',
        'posts.publish',
        'posts.delete',
        'posts.taxonomy',
        'posts.authors',
      ]),
    );
  });

  it.each(handlers)('refuses users without a posts permission: $name', async ({ run, method }) => {
    const result = await outcome(() => run(event(outsider, method)));
    expect(isHttpError(result, 403)).toBe(true);
  });

  it.each([...privileged, ...managed])(
    'refuses writers to publish, delete or manage categories, tags and authors: $name',
    async ({ run, method }) => {
      const result = await outcome(() => run(event(writer, method)));
      expect(isHttpError(result, 403)).toBe(true);
    },
  );

  it.each([...posts, ...authors])(
    'refuses category managers posts and authors: $name',
    async ({ run, method }) => {
      const result = await outcome(() => run(event(taxonomist, method)));
      expect(isHttpError(result, 403)).toBe(true);
    },
  );

  it.each(handlers)(
    'sends anonymous requests to the login page: $name',
    async ({ run, method }) => {
      const result = await outcome(() => run(event(null, method)));
      expect(isRedirect(result) && result.location === '/login').toBe(true);
    },
  );
});
