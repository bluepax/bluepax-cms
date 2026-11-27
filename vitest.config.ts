import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      'packages/*',
      'apps/*',
      'examples/minimal-site',
      // Repository tooling, e.g. the release scripts.
      { test: { name: 'scripts', include: ['scripts/**/*.test.ts'] } },
    ],
  },
});
