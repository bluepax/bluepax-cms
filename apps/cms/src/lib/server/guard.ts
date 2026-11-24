// Permission checks for admin routes. UI and API refuse alike (chapter 12).
import { error, redirect } from '@sveltejs/kit';
import { m } from '#lib/paraglide/messages.js';
import { can, type AuthUser } from './modules/users/auth.ts';

export function requireUser(locals: App.Locals): AuthUser {
  if (!locals.user) redirect(303, '/login');
  return locals.user;
}

export function requirePermission(locals: App.Locals, permission: string): AuthUser {
  const user = requireUser(locals);
  if (!can(user, permission)) error(403, m.forbidden());
  return user;
}

/** Only same-site relative paths, so `next` cannot redirect elsewhere. */
export function safeNext(value: string | null): string {
  if (!value || !value.startsWith('/') || value.startsWith('//') || value.startsWith('/\\')) {
    return '/';
  }
  return value;
}

/** Form fields as trimmed strings. */
export function field(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === 'string' ? value.trim() : '';
}

/** Password fields are not trimmed. */
export function secretField(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === 'string' ? value : '';
}
