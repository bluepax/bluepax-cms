import { termEditActions, termEditLoad } from '#lib/server/term-routes.ts';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = termEditLoad('tag');
export const actions = termEditActions('tag') satisfies Actions;
