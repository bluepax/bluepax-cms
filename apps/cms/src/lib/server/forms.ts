import { fail } from '@sveltejs/kit';
import { AccountError } from './modules/users/accounts.ts';

/** Turns an AccountError into a 400 with its code; anything else is a real error. */
export function accountFailure<T extends Record<string, unknown> = Record<never, never>>(
  error: unknown,
  extra?: T,
) {
  if (error instanceof AccountError) return fail(400, { ...(extra as T), error: error.code });
  throw error;
}

export function parseLocale(value: string): 'en' | 'zh' {
  return value === 'zh' ? 'zh' : 'en';
}
