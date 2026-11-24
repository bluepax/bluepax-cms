import { describe, expect, it } from 'vitest';
import { defineModule } from './manifest.ts';
import { ModuleRegistry, ModuleRegistryError } from './registry.ts';

const site = defineModule({
  id: 'site',
  version: '1.0.0',
  permissions: [{ name: 'site.manage', kind: 'settings' }],
});
const pages = defineModule({ id: 'pages', version: '1.0.0', dependsOn: ['site'] });
const catalog = defineModule({ id: 'catalog', version: '1.0.0', dependsOn: ['pages'] });
const inquiries = defineModule({ id: 'inquiries', version: '1.0.0', dependsOn: ['catalog'] });

describe('ModuleRegistry.register', () => {
  it('rejects modules that are not in the module table', () => {
    const registry = new ModuleRegistry();
    // @ts-expect-error unknown module id
    expect(() => registry.register({ id: 'shop', version: '1.0.0' })).toThrow(ModuleRegistryError);
  });

  it('rejects a module registered twice', () => {
    const registry = new ModuleRegistry().register(site);
    expect(() => registry.register(site)).toThrow(/registered twice/);
  });

  it('rejects permissions outside the module namespace', () => {
    const registry = new ModuleRegistry();
    const bad = defineModule({
      id: 'pages',
      version: '1.0.0',
      permissions: [{ name: 'posts.edit', kind: 'content' }],
    });
    expect(() => registry.register(bad)).toThrow(/pages\.<action>/);
  });

  it('rejects a permission declared twice', () => {
    const registry = new ModuleRegistry();
    const bad = defineModule({
      id: 'pages',
      version: '1.0.0',
      permissions: [
        { name: 'pages.edit', kind: 'content' },
        { name: 'pages.edit', kind: 'settings' },
      ],
    });
    expect(() => registry.register(bad)).toThrow(/declared twice/);
  });

  it('rejects menu items with undeclared permissions', () => {
    const registry = new ModuleRegistry();
    const bad = defineModule({
      id: 'pages',
      version: '1.0.0',
      permissions: [{ name: 'pages.read', kind: 'content' }],
      menu: [{ label: 'menu.pages', href: '/admin/pages', permission: 'pages.edit' }],
    });
    expect(() => registry.register(bad)).toThrow(/undeclared permission/);
  });

  it('rejects a core module that depends on an optional one', () => {
    const registry = new ModuleRegistry();
    const bad = defineModule({ id: 'pages', version: '1.0.0', dependsOn: ['catalog'] });
    expect(() => registry.register(bad)).toThrow(/optional module "catalog"/);
  });

  it('accepts webhook events named <object>.<event>', () => {
    const registry = new ModuleRegistry();
    const media = defineModule({
      id: 'media',
      version: '1.0.0',
      webhookEvents: ['media.replaced', 'media.origin_changed'],
    });
    expect(() => registry.register(media)).not.toThrow();
  });

  it('rejects webhook events with a module prefix or a single segment', () => {
    const registry = new ModuleRegistry();
    for (const event of ['inquiries.inquiry.created', 'published']) {
      expect(() =>
        registry.register({ id: 'inquiries', version: '1.0.0', webhookEvents: [event] }),
      ).toThrow(/expected "<object>.<event>"/);
    }
  });

  it('rejects invalid versions and webhook event names', () => {
    const registry = new ModuleRegistry();
    expect(() => registry.register({ id: 'site', version: 'v1' })).toThrow(/invalid version/);
    expect(() =>
      registry.register({ id: 'site', version: '1.0.0', webhookEvents: ['Site Updated'] }),
    ).toThrow(/invalid webhook event/);
  });
});

describe('ModuleRegistry.order', () => {
  it('puts dependencies first', () => {
    const registry = new ModuleRegistry()
      .register(inquiries)
      .register(catalog)
      .register(pages)
      .register(site);
    expect(registry.order().map((m) => m.id)).toEqual(['site', 'pages', 'catalog', 'inquiries']);
  });

  it('reports unregistered dependencies', () => {
    const registry = new ModuleRegistry().register(pages);
    expect(() => registry.order()).toThrow(/depends on unregistered "site"/);
  });

  it('reports cycles', () => {
    const registry = new ModuleRegistry()
      .register({ id: 'catalog', version: '1.0.0', dependsOn: ['inquiries'] })
      .register({ id: 'inquiries', version: '1.0.0', dependsOn: ['catalog'] });
    expect(() => registry.order()).toThrow(/dependency cycle/);
  });
});

describe('ModuleRegistry.resolveEnabled', () => {
  const registry = new ModuleRegistry()
    .register(site)
    .register(pages)
    .register(catalog)
    .register(inquiries);

  it('always enables core modules', () => {
    expect([...registry.resolveEnabled([])].sort()).toEqual(['pages', 'site']);
  });

  it('enables optional modules whose dependencies are active', () => {
    expect(registry.resolveEnabled(['catalog', 'inquiries']).has('inquiries')).toBe(true);
  });

  it('keeps an optional module off when a dependency is off', () => {
    expect(registry.resolveEnabled(['inquiries']).has('inquiries')).toBe(false);
  });
});

describe('ModuleRegistry.editorPermissions', () => {
  const registry = new ModuleRegistry()
    .register(site)
    .register({
      id: 'pages',
      version: '1.0.0',
      permissions: [
        { name: 'pages.edit', kind: 'content' },
        { name: 'pages.settings', kind: 'settings' },
      ],
    })
    .register({
      id: 'users',
      version: '1.0.0',
      permissions: [{ name: 'users.manage', kind: 'content' }],
    });

  it('grants only content actions of modules editors may use', () => {
    expect(registry.editorPermissions(['site', 'pages', 'users'])).toEqual(['pages.edit']);
  });
});

describe('ModuleRegistry.permissions', () => {
  it('lists the permission points of the given modules', () => {
    const registry = new ModuleRegistry().register(site).register(pages);
    expect(registry.permissions(['site', 'pages'])).toEqual(['site.manage']);
  });
});
