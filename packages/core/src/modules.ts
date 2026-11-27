// Module table, see docs/spec/README.md chapter 3.
// A new module is added to this table before it is implemented.

export const CORE_MODULES = [
  'dashboard',
  'site',
  'pages',
  'posts',
  'media',
  'seo',
  'api',
  'users',
] as const;

export const OPTIONAL_MODULES = [
  'catalog',
  'inquiries',
  'regions',
  'tracking',
  'insights',
  'ai',
] as const;

export type CoreModuleId = (typeof CORE_MODULES)[number];
export type OptionalModuleId = (typeof OPTIONAL_MODULES)[number];
export type ModuleId = CoreModuleId | OptionalModuleId;

export interface ModuleInfo {
  type: 'core' | 'optional';
  /** Whether the default editor role gets the content actions of this module. */
  editor: boolean;
}

export const MODULE_TABLE: Readonly<Record<ModuleId, ModuleInfo>> = {
  dashboard: { type: 'core', editor: true },
  site: { type: 'core', editor: false },
  pages: { type: 'core', editor: true },
  posts: { type: 'core', editor: true },
  media: { type: 'core', editor: true },
  seo: { type: 'core', editor: true },
  api: { type: 'core', editor: false },
  users: { type: 'core', editor: false },
  catalog: { type: 'optional', editor: true },
  inquiries: { type: 'optional', editor: true },
  regions: { type: 'optional', editor: false },
  tracking: { type: 'optional', editor: false },
  insights: { type: 'optional', editor: true },
  ai: { type: 'optional', editor: true },
};

export function isModuleId(value: string): value is ModuleId {
  return Object.hasOwn(MODULE_TABLE, value);
}

export function isCoreModule(id: ModuleId): id is CoreModuleId {
  return MODULE_TABLE[id].type === 'core';
}
