// Every module registers its manifest here; the rest of the app only reads the registry.
import { ModuleRegistry, type ModuleId } from '@bluepax/core';
import { usersModule } from './modules/users/manifest.ts';

export const registry = new ModuleRegistry().register(usersModule);

/** Migration sets in dependency order: `core` first, then the modules that own tables. */
export function migrationSetNames(): string[] {
  return registry.order().flatMap((m) => (m.migrations ? [m.migrations] : []));
}

/** Modules that are switched on. Optional modules come with the setup wizard (instance_modules). */
export function enabledModules(): Set<ModuleId> {
  return registry.resolveEnabled([]);
}
