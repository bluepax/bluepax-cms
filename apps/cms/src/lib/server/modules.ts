// Every module registers its manifest here; the rest of the app only reads the registry.
import { ModuleRegistry } from '@bluepax/core';
import { usersModule } from './modules/users/manifest.ts';

export const registry = new ModuleRegistry().register(usersModule);

/** Migration sets in dependency order: `core` first, then the modules that own tables. */
export function migrationSetNames(): string[] {
  return registry.order().flatMap((m) => (m.migrations ? [m.migrations] : []));
}
