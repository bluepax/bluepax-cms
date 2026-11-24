// See https://svelte.dev/docs/kit/types#app.d.ts
import type { BuildInfo } from '../build-info.ts';

declare global {
  /** Injected by vite.config.ts at build time. */
  const __BLUEPAX_BUILD_INFO__: BuildInfo;

  namespace App {
    // interface Error {}
    // interface Locals {}
    // interface PageData {}
    // interface PageState {}
    // interface Platform {}
  }
}

export {};
