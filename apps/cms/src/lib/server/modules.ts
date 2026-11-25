// Every module registers its manifest here; the rest of the app only reads the registry.
import { ModuleRegistry } from '@bluepax/core';
import { mediaModule } from './modules/media/manifest.ts';
import { pagesModule } from './modules/pages/manifest.ts';
import { postsModule } from './modules/posts/manifest.ts';
import { siteModule } from './modules/site/manifest.ts';
import { usersModule } from './modules/users/manifest.ts';

export const registry = new ModuleRegistry()
  .register(mediaModule)
  .register(pagesModule)
  .register(postsModule)
  .register(siteModule)
  .register(usersModule);

/** Migration sets in dependency order: `core` first, then the modules that own tables. */
export function migrationSetNames(): string[] {
  return registry.order().flatMap((m) => (m.migrations ? [m.migrations] : []));
}
