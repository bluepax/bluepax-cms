import type { ModuleId } from './modules.ts';

// Module manifest, see docs/spec/README.md chapter 3 ("模块规范").
// The core only depends on manifests; it never imports a module's internals.

export interface MenuItem {
  /** Message key of the label in the admin UI. */
  label: string;
  /** Admin route, for example `/admin/pages`. */
  href: string;
  /** Permission required to see the item. */
  permission: string;
}

export interface EndpointDeclaration {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  /** Path under `/api`, for example `/delivery/v1/pages/{slug}`. */
  path: string;
}

export interface ModuleManifest {
  id: ModuleId;
  /** Version of the module's own schema and behaviour (SemVer). */
  version: string;
  /** Modules that must be enabled for this one to work. */
  dependsOn?: readonly ModuleId[];
  /** Name of the module's migrations folder in `@bluepax/db`, if it owns tables. */
  migrations?: string;
  /** Permission points, `<moduleId>.<action>`. */
  permissions?: readonly string[];
  menu?: readonly MenuItem[];
  endpoints?: readonly EndpointDeclaration[];
  /** Block types the module provides. */
  blocks?: readonly string[];
  /** Background job names the module registers. */
  jobs?: readonly string[];
  /** Webhook events the module emits, `<object>.<event>` as listed in chapter 6 (e.g. `content.published`). */
  webhookEvents?: readonly string[];
  /** Settings and their default values. */
  settings?: Readonly<Record<string, unknown>>;
}

/** Identity helper that keeps the manifest literal typed. */
export function defineModule<const T extends ModuleManifest>(manifest: T): T {
  return manifest;
}
