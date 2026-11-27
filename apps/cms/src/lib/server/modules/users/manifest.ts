import { defineModule } from '@bluepax/core';

// users module (chapter 3): accounts, roles, permission points, two-step verification, audit log.
export const usersModule = defineModule({
  id: 'users',
  version: '1.0.0',
  permissions: [{ name: 'users.manage', kind: 'settings' }],
  menu: [{ label: 'nav_users', href: '/users', permission: 'users.manage' }],
});
