// Test fixtures shared by the access tests of the admin routes. Not imported by the app.
import { registry } from './modules.ts';
import type { AuthUser } from './modules/users/auth.ts';

/** A signed-in account with the given role key and permissions. */
export function testUser(key: string, permissions: Iterable<string>): AuthUser {
  return {
    id: '00000000-0000-4000-8000-000000000001',
    email: `${key}@example.com`,
    displayName: key,
    locale: 'en',
    role: { id: '00000000-0000-4000-8000-000000000002', key, name: key },
    permissions: new Set(permissions),
    totpEnabled: false,
  };
}

/**
 * An account with the default editor role as initialisation seeds it (chapter 3, "角色"):
 * every content permission of every registered module, so the access tests check the role
 * that real editors get, including permissions added by later modules.
 */
export function defaultEditor(): AuthUser {
  return testUser('editor', registry.editorPermissions(registry.all().map((m) => m.id)));
}
