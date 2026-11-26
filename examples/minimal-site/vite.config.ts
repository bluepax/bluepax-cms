import adapter from '@sveltejs/adapter-node';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [
    sveltekit({
      compilerOptions: {
        // Runes mode for this app's components, not for libraries.
        runes: ({ filename }) =>
          filename.split(/[/\\]/).includes('node_modules') ? undefined : true,
      },
      // A Node.js server; set ORIGIN to the frontend's public URL in production.
      adapter: adapter(),
    }),
  ],
});
