// GET /api/health, no authentication, see docs/spec/README.md chapters 6 and 11.
import { ping } from '@bluepax/db';
import { json } from '@sveltejs/kit';
import { getPool } from '#lib/server/runtime.ts';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async () => {
  const database = await ping(getPool());
  const { version, build, builtAt, commit } = __BLUEPAX_BUILD_INFO__;
  return json(
    { status: database ? 'ok' : 'fail', version, build, builtAt, commit },
    { status: database ? 200 : 503, headers: { 'Cache-Control': 'no-store' } },
  );
};
