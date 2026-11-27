// End-to-end tests (chapter 9, 10 and 12, docs/adr/0016): Playwright drives the built CMS and the
// built example frontend. Run `pnpm build` first, then
//   TEST_DATABASE_URL=postgres://bluepax:bluepax@127.0.0.1:5432/bluepax_test pnpm e2e
// The tests share one instance and build on each other, so they run in order in one worker.
import { defineConfig, devices } from '@playwright/test';
import { E2E } from './e2e/config.ts';

export default defineConfig({
  testDir: 'e2e',
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: process.env.CI ? [['list'], ['github']] : 'list',
  timeout: 60_000,
  use: {
    baseURL: E2E.cms,
    locale: 'en-US',
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'node e2e/serve.ts',
    url: `${E2E.cms}/api/health`,
    reuseExistingServer: false,
    timeout: 60_000,
    stdout: 'pipe',
    stderr: 'pipe',
  },
});
