import { termEditActions, termEditLoad } from '#lib/server/term-routes.ts';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = termEditLoad('category');
export const actions = termEditActions('category') satisfies Actions;
