// End-to-end tests of the M2 items (chapter 12, docs/adr/0018 and 0019), against the same
// instance as m1.spec.ts. Playwright runs the files in name order in one worker, so the admin
// and editor accounts from m1.spec.ts exist here.
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { E2E } from './config.ts';

test.describe.configure({ mode: 'serial' });

/** A backup file placed in the instance's backups folder (taking a real one needs pg_dump). */
const BACKUP = 'manual-20261128-120000Z.dump';

async function logIn(page: Page, account: { email: string; password: string }): Promise<void> {
  await page.goto('/login');
  await page.locator('input[name=email]').fill(account.email);
  await page.locator('input[name=password]').fill(account.password);
  await page.getByRole('button', { name: 'Log in' }).click();
  await expect(page).toHaveURL(`${E2E.cms}/`);
}

test.beforeAll(async () => {
  await writeFile(join(E2E.backupsDir, BACKUP), 'PGDMP fake backup for the e2e tests');
});

test('the editor cannot see, start, download or delete backups, in the UI or the API', async ({
  page,
}) => {
  await logIn(page, E2E.editor);
  expect((await page.goto('/settings/backups'))?.status()).toBe(403);
  expect((await page.request.get(`/settings/backups/${BACKUP}`)).status()).toBe(403);
  for (const action of ['?/run', '?/settings', '?/delete']) {
    const response = await page.request.post(`/settings/backups${action}`, {
      headers: { origin: E2E.cms, 'x-sveltekit-action': 'true' },
      form: { name: BACKUP, time: '04:00', keepDaily: '7', keepWeekly: '4' },
    });
    expect(response.status(), action).toBe(403);
  }
  // Nothing was removed.
  expect(await readFile(join(E2E.backupsDir, BACKUP), 'utf8')).toContain('PGDMP');
});

test('the admin changes the schedule, downloads and deletes a backup', async ({ page }) => {
  await logIn(page, E2E.admin);
  await page.goto('/settings');
  await page.getByRole('link', { name: 'Backups', exact: true }).click();
  await expect(page).toHaveURL(`${E2E.cms}/settings/backups`);
  await expect(page.getByText('Every day at 03:00 (UTC)')).toBeVisible();

  await page.locator('input[name=time]').fill('04:30');
  await page.locator('input[name=keepDaily]').fill('10');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Saved; the backup schedule is updated.')).toBeVisible();
  await expect(page.getByText('Every day at 04:30 (UTC)')).toBeVisible();
  await expect(page.getByText('The latest 10 daily backups are kept')).toBeVisible();
  // The settings are part of the exported instance configuration.
  const config = await (await page.request.get('/settings/config/download')).text();
  expect(config).toContain('backups:\n  time: 04:30\n  keepDaily: 10\n  keepWeekly: 4\n');

  const row = page.getByRole('row').filter({ hasText: BACKUP });
  await expect(row).toBeVisible();
  const download = page.waitForEvent('download');
  await row.getByRole('link', { name: 'Download' }).click();
  const file = await download;
  expect(file.suggestedFilename()).toBe(BACKUP);
  expect(await readFile(await file.path(), 'utf8')).toBe('PGDMP fake backup for the e2e tests');

  page.once('dialog', (dialog) => void dialog.accept());
  await row.getByRole('button', { name: 'Delete' }).click();
  await expect(page.getByText('Backup deleted.')).toBeVisible();
  await expect(page.getByRole('row').filter({ hasText: BACKUP })).toHaveCount(0);
  expect((await page.request.get(`/settings/backups/${BACKUP}`)).status()).toBe(404);
});
