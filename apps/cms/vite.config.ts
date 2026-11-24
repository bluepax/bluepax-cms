import adapter from '@sveltejs/adapter-node';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';
import { buildInfo } from './build-info.ts';

const info = buildInfo();

export default defineConfig({
  define: {
    __BLUEPAX_BUILD_INFO__: JSON.stringify(info),
  },
  plugins: [
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
    }),
  ],
});
