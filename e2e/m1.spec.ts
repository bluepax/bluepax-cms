// End-to-end tests of the M1 flows (chapter 12, docs/adr/0016), against the built CMS on an
// empty database (e2e/serve.ts) and the built example frontend. The tests build on each other
// (setup → accounts → content → token → frontend) and run in order.
import { spawn } from 'node:child_process';
import { expect, test, type Page } from '@playwright/test';
import { E2E } from './config.ts';

test.describe.configure({ mode: 'serial' });

/** The Delivery Token issued in the admin, used by the API checks and the example frontend. */
let token = '';

async function logIn(page: Page, account: { email: string; password: string }): Promise<void> {
  await page.goto('/login');
  await page.locator('input[name=email]').fill(account.email);
  await page.locator('input[name=password]').fill(account.password);
  await page.getByRole('button', { name: 'Log in' }).click();
  await expect(page).toHaveURL(`${E2E.cms}/`);
}

test('an empty instance sends every request to the setup wizard', async ({ page, request }) => {
  await page.goto('/pages');
  await expect(page).toHaveURL(`${E2E.cms}/setup`);
  expect((await request.get('/api/delivery/v1/site')).status()).toBe(503);
  const health = await request.get('/api/health');
  expect(health.status()).toBe(200);
  expect(await health.json()).toMatchObject({ status: 'ok', build: expect.any(Number) });
});

test('the setup wizard applies the blog preset and creates the first admin', async ({ page }) => {
  await page.goto('/setup');
  await page.locator('input[name=token]').fill(E2E.installToken);
  await page.locator('input[name=type][value=blog]').check();
  await page.locator('input[name=name]').fill('E2E Blog');
  await page.locator('input[name=frontendBaseUrl]').fill(E2E.site);
  await page.locator('input[name=contentLanguages]').fill('en, zh-CN');
  await page.locator('select[name=primaryLanguage]').selectOption('en');
  await page.locator('select[name=adminLocale]').selectOption('en');
  await page.locator('input[name=adminEmail]').fill(E2E.admin.email);
  await page.locator('input[name=adminName]').fill(E2E.admin.name);
  await page.locator('input[name=adminPassword]').fill(E2E.admin.password);
  await page.getByRole('button', { name: 'Finish setup' }).click();
  await expect(page.getByText(`Welcome, ${E2E.admin.name}.`)).toBeVisible();

  // Chapter 2: the blog's optional modules, blocks 1–6, 9 and 11–13, one default category.
  const config = await (await page.request.get('/settings/config/download')).text();
  expect(config).toContain('  type: blog\n');
  expect(config).toContain('modules:\n  enabled:\n    - ai\n    - insights\n    - tracking\n');
  expect(config).toContain(
    [
      'blocks:',
      '  available:',
      ...[
        'hero',
        'text-media',
        'cards',
        'steps',
        'stats',
        'logos',
        'featured-posts',
        'latest-posts',
        'contact-cta',
        'rich-text',
      ].map((key) => `    - ${key}`),
    ].join('\n'),
  );
  expect(config).toContain('en: general');

  // The wizard is closed for good.
  await page.goto('/setup');
  await expect(page).toHaveURL(`${E2E.cms}/`);
});

test('the admin creates an editor account', async ({ page }) => {
  await logIn(page, E2E.admin);
  await page.goto('/users/new');
  await page.locator('input[name=email]').fill(E2E.editor.email);
  await page.locator('input[name=displayName]').fill(E2E.editor.name);
  await page.locator('input[name=password]').fill(E2E.editor.password);
  await page.locator('select[name=roleId]').selectOption({ label: 'Editor' });
  await page.getByRole('button', { name: 'Create' }).click();
  await expect(page.getByText('User created.')).toBeVisible();
});

test('the editor cannot reach settings, tokens, storage or users, in the UI or the API', async ({
  page,
}) => {
  await logIn(page, E2E.editor);
  await expect(page.getByRole('link', { name: 'Pages', exact: true }).first()).toBeVisible();
  for (const name of ['Settings', 'Integration & API', 'Users']) {
    await expect(page.getByRole('link', { name, exact: true }), name).toHaveCount(0);
  }
  for (const path of [
    '/settings',
    '/settings/config',
    '/settings/frontend',
    '/integration',
    '/media/storage',
    '/users',
    '/users/new',
    '/users/roles',
    '/users/audit',
  ]) {
    expect((await page.goto(path))?.status(), path).toBe(403);
  }
  expect((await page.request.get('/settings/config/download')).status()).toBe(403);
  // Form actions as the browser sends them: same origin, so only the permission check refuses.
  for (const action of [
    '/settings?/general',
    '/settings/frontend?/routes',
    '/integration?/issue',
    '/media/storage?/save',
    '/users/new',
    '/users/roles?/create',
  ]) {
    const response = await page.request.post(action, {
      headers: { origin: E2E.cms, 'x-sveltekit-action': 'true' },
      form: { name: 'x' },
    });
    expect(response.status(), action).toBe(403);
    expect(await response.json(), action).toMatchObject({ type: 'error', error: {} });
  }
});

test('the editor publishes a home page and a post', async ({ page }) => {
  page.on('dialog', (dialog) => dialog.accept());
  await logIn(page, E2E.editor);

  await page.goto('/pages/new');
  await page.locator('input[name=title]').fill('Welcome');
  await page.locator('input[name=slug]').fill('home');
  await page.getByRole('button', { name: 'Create' }).click();
  await expect(page).toHaveURL(/\/pages\/[0-9a-f-]{36}/);
  await page.getByLabel('Block type').selectOption('hero');
  await page.getByRole('button', { name: 'Add block' }).click();
  await page
    .getByRole('region', { name: 'Blocks' })
    .getByLabel('Title', { exact: true })
    .fill('Notes from an end-to-end test');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText('Saved.', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Make home page' }).click();
  await expect(page.getByText('This is now the home page.')).toBeVisible();
  await page.getByRole('button', { name: 'Publish', exact: true }).click();
  await expect(page.getByText('Saved and published.')).toBeVisible();

  await page.goto('/posts/new');
  await page.locator('input[name=title]').fill('Hello world');
  await page.locator('input[name=slug]').fill('hello-world');
  await page.getByRole('button', { name: 'Create' }).click();
  await expect(page).toHaveURL(/\/posts\/[0-9a-f-]{36}/);
  await page.locator('.ProseMirror').first().click();
  await page.keyboard.type('Written by the end-to-end test.');
  await page.getByRole('button', { name: 'Publish', exact: true }).click();
  await expect(page.getByText('Saved and published.')).toBeVisible();
});

test('the admin issues a Delivery Token and the API serves what was published', async ({
  page,
  request,
}) => {
  await logIn(page, E2E.admin);
  await page.goto('/integration');
  const issue = page.locator('form[action="?/issue"]');
  await issue.locator('input[name=name]').fill('e2e frontend');
  await issue.getByRole('button', { name: 'Issue token' }).click();
  token = ((await page.getByTestId('issued-token').textContent()) ?? '').trim();
  expect(token).toMatch(/^bpxd_/);

  const api = (path: string, auth = true) =>
    request.get(`/api/delivery/v1${path}`, {
      headers: auth ? { authorization: `Bearer ${token}` } : {},
    });
  expect((await api('/site', false)).status()).toBe(401);
  expect(await (await api('/site')).json()).toMatchObject({
    type: 'blog',
    name: 'E2E Blog',
    frontend: { baseUrl: E2E.site },
  });
  const resolve = async (path: string) =>
    (await api(`/routes/resolve?path=${encodeURIComponent(path)}`)).json();
  expect(await resolve('/')).toMatchObject({ status: 301, location: '/en' });
  expect(await resolve('/en')).toMatchObject({ status: 200, type: 'page' });
  expect(await resolve('/en/blog/hello-world')).toMatchObject({ status: 200, type: 'post' });
  // Chapter 6: an unpublished language is a 404, never another language.
  expect(await resolve('/zh-cn/blog/hello-world')).toMatchObject({ status: 404 });
  const post = await (await api('/posts/hello-world?locale=en')).json();
  expect(post.seo.hreflang.map((h: { hreflang: string }) => h.hreflang)).toEqual([
    'en',
    'x-default',
  ]);
  expect((await api('/posts/hello-world?locale=zh-CN')).status()).toBe(404);
});

test('the example frontend renders the home page, a post and a 404 with the SDK only', async ({
  page,
}) => {
  expect(token, 'the previous test issues the token').not.toBe('');
  const site = spawn(process.execPath, ['examples/minimal-site/build/index.js'], {
    env: {
      ...process.env,
      HOST: '127.0.0.1',
      PORT: String(E2E.sitePort),
      ORIGIN: E2E.site,
      BLUEPAX_CMS_URL: E2E.cms,
      BLUEPAX_DELIVERY_TOKEN: token,
    },
    stdio: ['ignore', 'inherit', 'inherit'],
  });
  try {
    await expect
      .poll(
        () =>
          fetch(`${E2E.site}/`, { redirect: 'manual' }).then(
            (r) => r.status,
            () => 0,
          ),
        { timeout: 20_000 },
      )
      .toBe(301);

    await page.goto(`${E2E.site}/`);
    await expect(page).toHaveURL(`${E2E.site}/en`);
    await expect(
      page.getByRole('heading', { name: 'Notes from an end-to-end test' }),
    ).toBeVisible();

    const post = await page.goto(`${E2E.site}/en/blog/hello-world`);
    expect(post?.status()).toBe(200);
    await expect(page.getByRole('heading', { name: 'Hello world' })).toBeVisible();
    await expect(page.getByText('Written by the end-to-end test.')).toBeVisible();
    await expect(page.locator('link[rel=canonical]')).toHaveAttribute(
      'href',
      `${E2E.site}/en/blog/hello-world`,
    );

    expect((await page.goto(`${E2E.site}/en/nothing-here`))?.status()).toBe(404);
    expect((await page.goto(`${E2E.site}/zh-cn/blog/hello-world`))?.status()).toBe(404);
  } finally {
    site.kill();
  }
});
