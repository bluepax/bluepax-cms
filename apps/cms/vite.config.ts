import { paraglideVitePlugin } from '@inlang/paraglide-js';
import adapter from '@sveltejs/adapter-node';
import { sveltekit } from '@sveltejs/kit/vite';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';
import { buildInfo } from './build-info.ts';

const info = buildInfo();

export default defineConfig({
  define: {
    __BLUEPAX_BUILD_INFO__: JSON.stringify(info),
  },
  plugins: [
    tailwindcss(),
    sveltekit({
      compilerOptions: {
        // Force runes mode for the project, except for libraries. Can be removed in svelte 6.
        runes: ({ filename }) =>
          filename.split(/[/\\]/).includes('node_modules') ? undefined : true,
      },
      adapter: adapter(),
      // One .env at the repository root (see .env.example).
      env: { dir: '../..' },
      version: { name: `${info.version}.${info.build}` },
      // Security headers (chapter 9): CSP with nonces/hashes for SvelteKit's own scripts.
      csp: {
        mode: 'auto',
        directives: {
          'default-src': ['self'],
          'script-src': ['self'],
          'style-src': ['self', 'unsafe-inline'],
          'img-src': ['self', 'data:', 'blob:'],
          'font-src': ['self'],
          'connect-src': ['self'],
          'form-action': ['self'],
          'frame-ancestors': ['none'],
          'base-uri': ['self'],
          'object-src': ['none'],
        },
      },
    }),
    // Admin UI messages (zh / en). Plugins load from node_modules, never from a CDN.
    paraglideVitePlugin({
      project: './project.inlang',
      outdir: './src/lib/paraglide',
      emitTsDeclarations: true,
      // The admin UI language follows the user's account (cookie), not the URL.
      strategy: ['cookie', 'preferredLanguage', 'baseLocale'],
      cookieName: 'bluepax_locale',
    }),
  ],
});
