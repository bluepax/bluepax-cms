import { termListActions, termListLoad } from '#lib/server/term-routes.ts';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = termListLoad('category');
export const actions = termListActions('category') satisfies Actions;
