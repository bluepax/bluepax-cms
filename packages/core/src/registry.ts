import type { ModuleManifest } from './manifest.ts';
import { isCoreModule, isModuleId, type ModuleId } from './modules.ts';

const NAME = '[a-z][a-z0-9_]*';
const SEMVER = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/;
const WEBHOOK_EVENT = new RegExp(`^${NAME}(\\.${NAME})+$`);

export class ModuleRegistryError extends Error {
  override name = 'ModuleRegistryError';
}

export class ModuleRegistry {
  readonly #modules = new Map<ModuleId, ModuleManifest>();

  register(manifest: ModuleManifest): this {
    if (!isModuleId(manifest.id)) {
      throw new ModuleRegistryError(`module "${manifest.id}" is not in the module table`);
    }
    if (this.#modules.has(manifest.id)) {
      throw new ModuleRegistryError(`module "${manifest.id}" is registered twice`);
    }
    validateManifest(manifest);
    this.#modules.set(manifest.id, manifest);
    return this;
  }

  get(id: ModuleId): ModuleManifest | undefined {
    return this.#modules.get(id);
  }

  all(): ModuleManifest[] {
    return [...this.#modules.values()];
  }

  /**
   * Checks the registry as a whole and returns the modules in dependency order
   * (every module comes after the modules it depends on).
   */
  order(): ModuleManifest[] {
    const result: ModuleManifest[] = [];
    const state = new Map<ModuleId, 'visiting' | 'done'>();

    const visit = (id: ModuleId, path: ModuleId[]): void => {
      const current = state.get(id);
      if (current === 'done') return;
      if (current === 'visiting') {
        throw new ModuleRegistryError(`dependency cycle: ${[...path, id].join(' -> ')}`);
      }
      const manifest = this.#modules.get(id);
      if (!manifest) {
        throw new ModuleRegistryError(`module "${path.at(-1)}" depends on unregistered "${id}"`);
      }
      state.set(id, 'visiting');
      for (const dep of manifest.dependsOn ?? []) visit(dep, [...path, id]);
      state.set(id, 'done');
      result.push(manifest);
    };

    for (const id of [...this.#modules.keys()].sort()) visit(id, []);
    return result;
  }

  /**
   * Resolves which modules are active. Core modules are always active; an optional
   * module is active when it is switched on and all of its dependencies are active.
   */
  resolveEnabled(switchedOn: Iterable<ModuleId>): Set<ModuleId> {
    const on = new Set(switchedOn);
    const enabled = new Set<ModuleId>();
    for (const manifest of this.order()) {
      const wanted = isCoreModule(manifest.id) || on.has(manifest.id);
      const depsActive = (manifest.dependsOn ?? []).every((dep) => enabled.has(dep));
      if (wanted && depsActive) enabled.add(manifest.id);
    }
    return enabled;
  }

  /** All permission points of the given modules. */
  permissions(ids: Iterable<ModuleId>): string[] {
    const result: string[] = [];
    for (const id of ids) result.push(...(this.#modules.get(id)?.permissions ?? []));
    return result.sort();
  }
}

function validateManifest(m: ModuleManifest): void {
  const fail = (message: string): never => {
    throw new ModuleRegistryError(`module "${m.id}": ${message}`);
  };

  if (!SEMVER.test(m.version)) fail(`invalid version "${m.version}"`);

  for (const dep of m.dependsOn ?? []) {
    if (!isModuleId(dep)) fail(`unknown dependency "${dep}"`);
    if (dep === m.id) fail('depends on itself');
    if (isCoreModule(m.id) && !isCoreModule(dep)) {
      fail(`a core module cannot depend on optional module "${dep}"`);
    }
  }

  const permission = new RegExp(`^${m.id}\\.${NAME}$`);
  for (const p of m.permissions ?? []) {
    if (!permission.test(p)) fail(`permission "${p}" must look like "${m.id}.<action>"`);
  }
  const own = new Set(m.permissions ?? []);
  for (const item of m.menu ?? []) {
    if (!own.has(item.permission)) fail(`menu item "${item.label}" uses undeclared permission`);
  }

  for (const e of m.webhookEvents ?? []) {
    if (!WEBHOOK_EVENT.test(e)) fail(`invalid webhook event "${e}"`);
  }

  for (const e of m.endpoints ?? []) {
    if (!e.path.startsWith('/')) fail(`endpoint path "${e.path}" must start with "/"`);
  }
}
