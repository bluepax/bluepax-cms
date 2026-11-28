// Backups hand out the whole database (docs/adr/0019): besides editors (settings/access.test.ts),
// a role that may change the site settings but lacks `site.backups` is refused too, for the
// page, every action and the download, before anything touches the database.
import { isHttpError } from '@sveltejs/kit';
import { describe, expect, it } from 'vitest';
import { testUser } from '#lib/server/testing.ts';
import * as download from './[name]/+server.ts';
import * as page from './+page.server.ts';

const siteManager = testUser('site-manager', ['site.manage']);

function event(method: 'GET' | 'POST') {
  const url = new URL('http://cms.test/settings/backups');
  const body = new FormData();
  body.set('name', 'daily-20261128-030000Z.dump');
  body.set('time', '04:00');
  return {
    url,
    params: { name: 'daily-20261128-030000Z.dump' },
    locals: { user: siteManager, sessionId: null },
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

type Handler = (event: unknown) => unknown;

describe('backups access', () => {
  const handlers: [string, Handler, 'GET' | 'POST'][] = [
    ['load', page.load as Handler, 'GET'],
    ['download', download.GET as Handler, 'GET'],
    ...Object.entries(page.actions).map(
      ([name, run]) => [`?/${name}`, run as Handler, 'POST'] as [string, Handler, 'POST'],
    ),
  ];

  it('covers the page, its three actions and the download', () => {
    expect(handlers.map(([name]) => name)).toEqual([
      'load',
      'download',
      '?/settings',
      '?/run',
      '?/delete',
    ]);
  });

  it.each(handlers)('refuses a role without site.backups: %s', async (_name, run, method) => {
    const result = await outcome(() => run(event(method)));
    expect(isHttpError(result, 403)).toBe(true);
  });
});
