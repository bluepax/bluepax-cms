// See https://svelte.dev/docs/kit/types#app.d.ts
import type { BuildInfo } from '../build-info.ts';
import type { AuthUser } from '#lib/server/modules/users/auth.ts';

declare global {
  /** Injected by vite.config.ts at build time. */
  const __BLUEPAX_BUILD_INFO__: BuildInfo;

  namespace App {
    // interface Error {}
    interface Locals {
      /** The logged-in admin user, or null. */
      user: AuthUser | null;
      /** Hash id of the current session, or null. */
      sessionId: string | null;
    }
    // interface PageData {}
    // interface PageState {}
    // interface Platform {}
  }
}

export {};
