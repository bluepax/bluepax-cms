// See https://svelte.dev/docs/kit/types#app.d.ts
import type { Site } from '@bluepax/cms-client';

interface DocumentLanguage {
  lang: string;
  dir: 'ltr' | 'rtl';
}

declare global {
  namespace App {
    interface Error {
      message: string;
      /** e.g. `preview_expired`, so the error page can explain it in the visitor's language. */
      code?: string;
    }
    interface Locals {
      /**
       * Language and direction written into app.html by hooks.server.ts: the content's (set by
       * a page load, e.g. a preview) wins over the layout's guess from the first path segment.
       * Layout and page loads run in parallel, so they write separate fields.
       */
      layoutLanguage?: DocumentLanguage;
      contentLanguage?: DocumentLanguage;
      /** Seconds for `Retry-After` when the CMS is unavailable (503). */
      retryAfter?: number;
      /** Origin the media URLs start with, for the Content-Security-Policy. */
      mediaOrigin?: string;
    }
    interface PageData {
      site?: Site;
      /** Address per published language of the content shown; null when there is none. */
      alternates?: Record<string, string> | null;
    }
    // interface PageState {}
    // interface Platform {}
  }
}

export {};
