import { fileURLToPath } from 'node:url';
import { defineModule, ModuleRegistry } from '@bluepax/core';
import {
  createDatabase,
  createPool,
  migrationSets,
  runMigrations,
  type Database,
} from '@bluepax/db';
import { freshTestDatabase } from '@bluepax/db/testing';
import {
  configFromPreset,
  parseConfigYaml,
  stringifyConfig,
  validateConfig,
} from '@bluepax/presets';
import { afterAll, describe, expect, it } from 'vitest';
import {
  AlreadyInitializedError,
  createInitialAdmin,
  enabledOptionalModules,
  exportInstanceConfig,
  initializeInstance,
  instanceState,
} from './instance.ts';
import { migrationSetNames } from './modules.ts';
import { listRoles } from './modules/users/accounts.ts';

// Integration test: needs a PostgreSQL server (TEST_DATABASE_URL).
const baseUrl = process.env.TEST_DATABASE_URL;
const migrations = fileURLToPath(new URL('../../../../../packages/db/migrations', import.meta.url));

const registry = new ModuleRegistry()
  .register(
    defineModule({
      id: 'pages',
      version: '1.0.0',
      permissions: [{ name: 'pages.edit', kind: 'content' }],
    }),
  )
  .register(
    defineModule({
      id: 'catalog',
      version: '1.0.0',
      permissions: [
        { name: 'catalog.edit', kind: 'content' },
        { name: 'catalog.types', kind: 'settings' },
      ],
    }),
  );

const answers = {
  name: 'Example Site',
  contentLanguages: ['zh-Hans', 'en'],
  primaryLanguage: 'zh-Hans',
  adminLocale: 'zh' as const,
  frontendBaseUrl: 'https://www.example.com',
};
const admin = {
  email: 'owner@example.com',
  displayName: 'Owner',
  password: 'a long enough password',
  locale: 'zh' as const,
};

describe.skipIf(!baseUrl)('instance initialisation', () => {
  const pools: ReturnType<typeof createPool>[] = [];
  async function freshDb(name: string): Promise<Database> {
    const pool = createPool(await freshTestDatabase(baseUrl!, name), 2);
    pools.push(pool);
    // Every core module's tables: initialising seeds the post categories, for example.
    await runMigrations(pool, migrationSets(migrations, migrationSetNames()));
    return createDatabase(pool);
  }

  afterAll(async () => {
    await Promise.all(pools.map((p) => p.end()));
  });

  it('runs the wizard once: configuration, modules, roles and the first admin together', async () => {
    const db = await freshDb('instance_wizard');
    expect(await instanceState(db)).toEqual({ initialized: false, hasAdmin: false });

    const config = configFromPreset({ ...answers, type: 'corporate' });
    await initializeInstance(db, config, { registry, source: 'wizard', admin });

    expect(await instanceState(db)).toEqual({ initialized: true, hasAdmin: true });
    expect(await enabledOptionalModules(db)).toEqual(config.modules.enabled);
    const roles = await listRoles(db);
    expect(roles.map((r) => [r.key, r.users, r.permissions])).toEqual([
      ['admin', 1, []],
      ['editor', 0, ['catalog.edit', 'pages.edit']],
    ]);
    await expect(
      initializeInstance(db, config, { registry, source: 'wizard', admin }),
    ).rejects.toBeInstanceOf(AlreadyInitializedError);
  });

  it('gives a blog only its own optional modules', async () => {
    const db = await freshDb('instance_blog');
    await initializeInstance(db, configFromPreset({ ...answers, type: 'blog' }), {
      registry,
      source: 'wizard',
      admin,
    });
    expect(await enabledOptionalModules(db)).toEqual(['ai', 'insights', 'tracking']);
    const editor = (await listRoles(db)).find((r) => r.key === 'editor')!;
    expect(editor.permissions).toEqual(['pages.edit']);
    // The blog preset's default post category, in the primary language.
    expect((await exportInstanceConfig(db)).posts.categories).toEqual([
      { name: { 'zh-Hans': '综合' }, slug: { 'zh-Hans': 'general' } },
    ]);
  });

  it('exports a configuration that recreates the same instance on an empty database', async () => {
    const source = await freshDb('instance_export_a');
    const preset = configFromPreset({
      ...answers,
      contentLanguages: ['zh-Hans', 'en', 'ar'],
      type: 'corporate',
    });
    const config = validateConfig({
      ...preset,
      // Chapter 12: the same route templates too, not only the defaults.
      frontend: {
        ...preset.frontend,
        routes: { post: '/{locale}/news/{slug}', author: '/{locale}/team/{slug}' },
        reservedSlugs: ['search'],
      },
      posts: {
        categories: [
          { name: { 'zh-Hans': '新闻', en: 'News' }, slug: 'news' },
          { name: { ar: 'أدلة', en: 'Guides' }, slug: { ar: 'adilla', en: 'guides' } },
        ],
      },
    });
    await initializeInstance(source, config, { registry, source: 'wizard', admin });
    const exported = await exportInstanceConfig(source);
    expect(exported).toEqual(config);
    expect(exported.frontend.routes).toMatchObject({
      post: '/{locale}/news/{slug}',
      author: '/{locale}/team/{slug}',
      page: '/{locale}/{slug}',
    });

    const target = await freshDb('instance_export_b');
    await initializeInstance(target, parseConfigYaml(stringifyConfig(exported)), {
      registry,
      source: 'config-file',
    });
    expect(await exportInstanceConfig(target)).toEqual(config);
    expect(await instanceState(target)).toEqual({ initialized: true, hasAdmin: false });
  });

  it('after an unattended start, creates only the first admin, once', async () => {
    const db = await freshDb('instance_file');
    await initializeInstance(db, configFromPreset({ ...answers, type: 'blog' }), {
      registry,
      source: 'config-file',
    });
    await createInitialAdmin(db, admin);
    expect(await instanceState(db)).toEqual({ initialized: true, hasAdmin: true });
    await expect(
      createInitialAdmin(db, { ...admin, email: 'other@example.com' }),
    ).rejects.toBeInstanceOf(AlreadyInitializedError);
  });
});
