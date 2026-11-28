import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import {
  createDatabase,
  createPool,
  migrationSets,
  runMigrations,
  schema,
  type Database,
} from '@bluepax/db';
import { freshTestDatabase } from '@bluepax/db/testing';
import { configFromPreset, parseConfigYaml, stringifyConfig } from '@bluepax/presets';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { listAudit } from '../../audit.ts';
import { exportInstanceConfig, initializeInstance } from '../../instance.ts';
import { migrationSetNames, registry } from '../../modules.ts';
import { can } from '../users/auth.ts';
import {
  createEntity,
  createLocation,
  deleteEntity,
  getEntity,
  listEntities,
  updateEntity,
  updateLocation,
  type EntityInput,
} from './entities.ts';
import { languagesInput, smtpInput, socialInput } from './forms.ts';
import {
  checkPlacement,
  createNavItem,
  deleteNavItem,
  isNavUrl,
  listNav,
  navTree,
  updateNavItem,
  type NavItem,
} from './navigation.ts';
import {
  clearSmtp,
  readSiteData,
  readSmtp,
  saveContact,
  saveFooter,
  saveGeneral,
  saveInstantMessaging,
  saveLanguages,
  saveSmtp,
  saveSocial,
  smtpCredentials,
  type GeneralInput,
} from './settings.ts';
import { InvalidInputError, mergeLocalized } from './values.ts';

/** The fields an InvalidInputError points at. */
async function invalidFields(run: Promise<unknown>): Promise<string[]> {
  try {
    await run;
  } catch (error) {
    if (error instanceof InvalidInputError) return error.fields;
    throw error;
  }
  throw new Error('expected the input to be rejected');
}

describe('site module (unit)', () => {
  it('gives the site permission to admins only', () => {
    const all = registry.order().map((m) => m.id);
    expect(registry.permissions(all)).toContain('site.manage');
    expect(registry.editorPermissions(all)).not.toContain('site.manage');
    const role = { id: 'r', key: 'editor', name: 'Editor' };
    expect(
      can({ role, permissions: new Set(registry.editorPermissions(all)) }, 'site.manage'),
    ).toBe(false);
    expect(can({ role: { ...role, key: 'admin' }, permissions: new Set() }, 'site.manage')).toBe(
      true,
    );
    expect(migrationSetNames()).toContain('site');
  });

  it('keeps texts of removed languages when merging', () => {
    expect(mergeLocalized({ en: 'Old', ar: 'قديم' }, { en: 'New' }, ['en', 'zh-CN'])).toEqual({
      ar: 'قديم',
      en: 'New',
    });
  });

  it('accepts paths, URLs, mailto and tel as menu links', () => {
    for (const url of [
      '',
      '/en/about',
      '/en/about?x=1#team',
      'https://example.com',
      'mailto:a@example.com',
      'tel:+15550100',
    ]) {
      expect(isNavUrl(url), url).toBe(true);
    }
    for (const url of [
      '//evil.example',
      'javascript:alert(1)',
      'about',
      '/a b',
      'ftp://example.com',
    ]) {
      expect(isNavUrl(url), url).toBe(false);
    }
  });

  it('orders menus depth first and limits nesting to three levels', () => {
    const item = (id: string, parentId: string | null, sortOrder = 0): NavItem => ({
      id,
      menu: 'header',
      parentId,
      sortOrder,
      label: { en: id },
      url: '',
      pageId: null,
      postCategoryId: null,
      postId: null,
      newTab: false,
    });
    const tree = navTree([
      item('b', null, 2),
      item('a', null, 1),
      item('a1', 'a'),
      item('a1x', 'a1'),
    ]);
    expect(tree.map((n) => [n.id, n.depth])).toEqual([
      ['b', 1],
      ['a', 1],
      ['a1', 2],
      ['a1x', 3],
    ]);
    expect(tree.find((n) => n.id === 'a')!.subtree).toEqual(['a', 'a1', 'a1x']);
    const node = (id: string) => tree.find((n) => n.id === id);
    expect(() => checkPlacement(tree, 'a1x')).toThrow(InvalidInputError); // level 4
    expect(() => checkPlacement(tree, 'a1', node('a'))).toThrow(InvalidInputError); // cycle
    expect(() => checkPlacement(tree, 'b', node('a'))).toThrow(InvalidInputError); // 1 + 3 levels
    expect(() => checkPlacement(tree, 'b', node('a1'))).not.toThrow(); // 1 + 2 levels
  });

  it('reads repeated and optional form fields', () => {
    const form = new FormData();
    for (const [code, dir] of [
      ['zh-CN', ''],
      ['ar', 'rtl'],
      ['', 'ltr'],
    ]) {
      form.append('code', code!);
      form.append('dir', dir!);
    }
    form.set('primary', 'zh-CN');
    form.set('admin', 'zh');
    expect(languagesInput(form)).toEqual({
      content: [{ code: 'zh-CN' }, { code: 'ar', dir: 'rtl' }],
      primary: 'zh-CN',
      admin: 'zh',
    });

    const social = new FormData();
    social.append('network', 'x');
    social.append('url', 'https://social.example.com/x');
    social.append('network', '');
    social.append('url', '');
    expect(socialInput(social).links).toEqual([
      { network: 'x', url: 'https://social.example.com/x' },
    ]);

    const smtp = new FormData();
    smtp.set('host', ' smtp.example.com ');
    smtp.set('port', '587');
    smtp.set('password', ' secret with spaces ');
    expect(smtpInput(smtp).password).toEqual({ set: ' secret with spaces ', clear: false });
    smtp.set('password', '');
    expect(smtpInput(smtp).password.set).toBeUndefined();
  });
});

// Integration tests: need a PostgreSQL server (TEST_DATABASE_URL).
const baseUrl = process.env.TEST_DATABASE_URL;
const migrations = fileURLToPath(
  new URL('../../../../../../../packages/db/migrations', import.meta.url),
);

const answers = {
  name: 'Example Site',
  contentLanguages: ['zh-Hans', 'en', 'ar'],
  primaryLanguage: 'zh-Hans',
  adminLocale: 'zh' as const,
  frontendBaseUrl: 'https://www.example.com',
};

describe.skipIf(!baseUrl)('site module', { timeout: 30_000 }, () => {
  const pools: ReturnType<typeof createPool>[] = [];
  let db: Database;
  let actor: { id: string; ip: string };
  const key = randomBytes(32);

  async function freshDb(name: string): Promise<Database> {
    const pool = createPool(await freshTestDatabase(baseUrl!, name), 4);
    pools.push(pool);
    await runMigrations(pool, migrationSets(migrations, migrationSetNames()));
    return createDatabase(pool);
  }

  async function lastAudit() {
    const [entry] = await listAudit(db, { limit: 1 });
    return entry!;
  }

  beforeAll(async () => {
    db = await freshDb('site');
    const { adminId } = await initializeInstance(
      db,
      configFromPreset({ ...answers, type: 'corporate' }),
      {
        registry,
        source: 'wizard',
        admin: {
          email: 'owner@example.com',
          displayName: 'Owner',
          password: 'a long enough password',
          locale: 'zh',
        },
      },
    );
    actor = { id: adminId!, ip: '203.0.113.7' };
  });

  afterAll(async () => {
    await Promise.all(pools.map((p) => p.end()));
  });

  const general: GeneralInput = {
    type: 'blog',
    name: 'Example Notes',
    timezone: 'Asia/Shanghai',
    publisher: {
      type: 'organization',
      name: 'Example Ltd',
      sameAs: ['https://social.example.com/example'],
    },
    brandTerms: ['Example', 'Example Notes'],
  };

  it('saves the general settings into the config section and logs the changed fields', async () => {
    await saveGeneral(db, general, actor);
    const { site } = await exportInstanceConfig(db);
    expect(site).toMatchObject({ ...general, im: null });
    // Changing the type switches no module (chapter 2).
    expect((await exportInstanceConfig(db)).modules.enabled).toContain('catalog');

    const entry = await lastAudit();
    expect(entry).toMatchObject({
      action: 'site.update',
      targetType: 'settings',
      targetId: 'site',
      ip: '203.0.113.7',
    });
    expect(entry.details).toEqual({
      site: ['brandTerms', 'name', 'publisher', 'timezone', 'type'],
    });
  });

  it('writes nothing and logs nothing when nothing changed', async () => {
    const before = await lastAudit();
    await saveGeneral(db, general, actor);
    expect((await lastAudit()).id).toBe(before.id);
  });

  it('rejects invalid settings with the fields to fix', async () => {
    expect(
      await invalidFields(saveGeneral(db, { ...general, timezone: 'Mars/Base', name: ' ' }, actor)),
    ).toEqual(expect.arrayContaining(['timezone', 'name']));
    expect(
      await invalidFields(
        saveGeneral(
          db,
          { ...general, publisher: { ...general.publisher, sameAs: ['notaurl'] } },
          actor,
        ),
      ),
    ).toEqual(['publisher.sameAs.0']);
    expect((await exportInstanceConfig(db)).site.timezone).toBe('Asia/Shanghai');
  });

  it('drops instant messaging texts together with their language', async () => {
    await saveInstantMessaging(
      db,
      {
        channel: 'whatsapp',
        number: '+15550100',
        text: { 'zh-Hans': '你好', en: '', ar: 'مرحبا' },
      },
      actor,
    );
    expect((await exportInstanceConfig(db)).site.im?.text).toEqual({
      'zh-Hans': '你好',
      ar: 'مرحبا',
    });

    expect(
      await invalidFields(
        saveLanguages(db, { content: [{ code: 'en' }], primary: 'zh-Hans', admin: 'zh' }, actor),
      ),
    ).toEqual(['primary']);

    await saveLanguages(
      db,
      {
        content: [{ code: 'zh-hans' }, { code: 'en', dir: 'ltr' }],
        primary: 'zh-Hans',
        admin: 'en',
      },
      actor,
    );
    const config = await exportInstanceConfig(db);
    expect(config.languages).toEqual({
      content: [
        { code: 'zh-Hans', dir: 'ltr' },
        { code: 'en', dir: 'ltr' },
      ],
      primary: 'zh-Hans',
      admin: 'en',
    });
    expect(config.site.im?.text).toEqual({ 'zh-Hans': '你好' });
    expect((await lastAudit()).details).toEqual({ site: ['im'], languages: ['admin', 'content'] });

    await saveInstantMessaging(db, null, actor);
    expect((await exportInstanceConfig(db)).site.im).toBeNull();
  });

  it('exports a configuration that recreates the same settings on an empty database', async () => {
    await saveInstantMessaging(
      db,
      { channel: 'telegram', number: 'example_notes', text: { en: 'Hi' } },
      actor,
    );
    const exported = await exportInstanceConfig(db);
    const yaml = stringifyConfig(exported);
    expect(yaml).toContain('telegram');

    const target = await freshDb('site_roundtrip');
    await initializeInstance(target, parseConfigYaml(yaml), { registry, source: 'config-file' });
    expect(await exportInstanceConfig(target)).toEqual(exported);
  });

  it('keeps site data out of the config file and the footer texts of removed languages', async () => {
    expect(await invalidFields(saveContact(db, { email: 'not-mail', phone: '' }, actor))).toEqual([
      'email',
    ]);
    await saveContact(db, { email: 'hello@example.com', phone: '+1 555 0100' }, actor);
    await saveSocial(
      db,
      { links: [{ network: 'linkedin', url: 'https://social.example.com/in' }] },
      actor,
    );
    expect(
      await invalidFields(saveSocial(db, { links: [{ network: 'Linked In', url: 'x' }] }, actor)),
    ).toEqual(['links.0.network', 'links.0.url']);

    // `ar` was a content language earlier and is not one now: its text must survive a save.
    await db
      .insert(schema.settings)
      .values({ key: 'site.footer', value: { text: { ar: 'حقوق' } } });
    await saveFooter(db, { text: { 'zh-Hans': '© 示例', en: '' } }, actor);
    expect(await readSiteData(db, 'site.footer')).toEqual({
      text: { ar: 'حقوق', 'zh-Hans': '© 示例' },
    });

    expect(await readSiteData(db, 'site.contact')).toEqual({
      email: 'hello@example.com',
      phone: '+1 555 0100',
    });
    const yaml = stringifyConfig(await exportInstanceConfig(db));
    for (const value of ['hello@example.com', 'social.example.com/in', '示例']) {
      expect(yaml).not.toContain(value);
    }
    expect((await lastAudit()).details).toEqual({ 'site.footer': ['text'] });
  });

  it('stores the SMTP password encrypted and never shows or logs it', async () => {
    const settings = {
      host: 'smtp.example.com',
      port: 587,
      security: 'starttls',
      username: 'mailer',
      fromAddress: 'noreply@example.com',
    };
    const password = 'smtp password 123';
    const view = await saveSmtp(db, settings, { set: password }, key, actor);
    expect(view).toEqual({ ...settings, hasPassword: true });

    const [row] = await db
      .select()
      .from(schema.settings)
      .where(eq(schema.settings.key, 'site.smtp'));
    expect(JSON.stringify(row!.value)).not.toContain(password);
    expect(await smtpCredentials(db, key)).toEqual({ ...settings, password });
    expect(await smtpCredentials(db, randomBytes(32)).catch(() => 'wrong key')).toBe('wrong key');

    // An empty password field keeps the stored one.
    await saveSmtp(db, { ...settings, port: 465, security: 'tls' }, {}, key, actor);
    expect((await smtpCredentials(db, key))?.password).toBe(password);
    const entry = await lastAudit();
    expect(entry.details).toEqual({ 'site.smtp': ['port', 'security'], password: 'kept' });
    expect(JSON.stringify(await listAudit(db))).not.toContain(password);

    await saveSmtp(db, settings, { clear: true }, key, actor);
    expect(await readSmtp(db)).toEqual({ ...settings, hasPassword: false });
    expect(
      await invalidFields(saveSmtp(db, { ...settings, port: 0, fromAddress: 'x' }, {}, key, actor)),
    ).toEqual(['port', 'fromAddress']);

    await clearSmtp(db, actor);
    expect(await readSmtp(db)).toBeNull();
    expect((await lastAudit()).action).toBe('site.smtp_clear');
    expect(stringifyConfig(await exportInstanceConfig(db))).not.toContain('smtp');
  });

  it('manages legal entities and their locations', async () => {
    const entity: EntityInput = {
      legalName: { 'zh-Hans': '示例有限公司', en: 'Example Ltd' },
      role: { en: 'Headquarters' },
      registrationNumber: 'REG-1',
      registrationNumberPublic: true,
      taxId: 'TAX-1',
      taxIdPublic: false,
      email: '',
      phone: '',
      sortOrder: 0,
    };
    // The legal name is required in the primary language.
    expect(
      await invalidFields(
        createEntity(db, { ...entity, legalName: { en: 'Only English' } }, actor),
      ),
    ).toEqual(['legalName.zh-Hans']);
    const id = await createEntity(db, entity, actor);
    expect((await lastAudit()).action).toBe('site.entity_create');

    const location = {
      name: { en: 'Head office' },
      address: { en: { street: '1 Example Road', locality: 'Example City', region: '' } },
      postalCode: '100000',
      country: 'cn',
      phone: '',
      email: 'office@example.com',
      latitude: 31.23,
      longitude: 121.47,
      openingHours: 'Mo-Fr 09:00-18:00',
      sortOrder: 0,
    };
    expect(
      await invalidFields(createLocation(db, id, { ...location, longitude: null }, actor)),
    ).toEqual(['latitude']);
    const locationId = await createLocation(db, id, location, actor);
    await updateLocation(
      db,
      id,
      locationId,
      { ...location, latitude: null, longitude: null },
      actor,
    );

    await updateEntity(db, id, { ...entity, legalName: { 'zh-Hans': '示例股份有限公司' } }, actor);
    const stored = await getEntity(db, id);
    // English is still a content language and was emptied, so it is gone.
    expect(stored?.legalName).toEqual({ 'zh-Hans': '示例股份有限公司' });
    expect(stored?.locations).toMatchObject([
      {
        id: locationId,
        country: 'CN',
        latitude: null,
        address: { en: { street: '1 Example Road', locality: 'Example City' } },
      },
    ]);
    expect((await listEntities(db))[0]).toMatchObject({ id, locations: 1 });

    expect(await invalidFields(updateEntity(db, 'not-a-uuid', entity, actor))).toEqual([
      'not_found',
    ]);
    await deleteEntity(db, id, actor);
    expect(await getEntity(db, id)).toBeNull();
    expect(await db.select().from(schema.entityLocations)).toEqual([]);
    expect((await lastAudit()).action).toBe('site.entity_delete');
  });

  it('nests navigation items up to three levels and deletes them with their children', async () => {
    const item = (label: string, parentId: string | null = null, sortOrder = 0) => ({
      parentId,
      label: { 'zh-Hans': label },
      url: `/zh-hans/${label}`,
      newTab: false,
      sortOrder,
    });
    const products = await createNavItem(db, 'header', item('products', null, 1), actor);
    const about = await createNavItem(db, 'header', item('about', null, 0), actor);
    const range = await createNavItem(db, 'header', item('range', products), actor);
    const detail = await createNavItem(db, 'header', item('detail', range), actor);
    expect(
      await invalidFields(createNavItem(db, 'header', item('too-deep', detail), actor)),
    ).toEqual(['parentId']);
    expect(
      await invalidFields(updateNavItem(db, products, item('products', range), actor)),
    ).toEqual(['parentId']);
    expect(
      await invalidFields(createNavItem(db, 'header', { ...item('x'), label: { en: 'x' } }, actor)),
    ).toEqual(['label.zh-Hans']);
    expect(
      await invalidFields(
        createNavItem(db, 'header', { ...item('x'), url: 'javascript:alert(1)' }, actor),
      ),
    ).toEqual(['url']);
    // A parent from the other menu is refused.
    expect(await invalidFields(createNavItem(db, 'footer', item('x', about), actor))).toEqual([
      'parentId',
    ]);

    expect((await listNav(db, 'header')).map((n) => [n.label['zh-Hans'], n.depth])).toEqual([
      ['about', 1],
      ['products', 1],
      ['range', 2],
      ['detail', 3],
    ]);

    await deleteNavItem(db, products, actor);
    expect((await listNav(db, 'header')).map((n) => n.id)).toEqual([about]);
    expect((await lastAudit()).action).toBe('site.nav_delete');
  });
});
