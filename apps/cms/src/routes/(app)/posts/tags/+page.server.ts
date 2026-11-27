import { termListActions, termListLoad } from '#lib/server/term-routes.ts';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = termListLoad('tag');
export const actions = termListActions('tag') satisfies Actions;
