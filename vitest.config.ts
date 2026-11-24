import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      'packages/*',
      'apps/*',
      // Repository tooling, e.g. the release scripts.
      { test: { name: 'scripts', include: ['scripts/**/*.test.ts'] } },
    ],
  },
});
