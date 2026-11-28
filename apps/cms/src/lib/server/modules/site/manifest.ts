import { defineModule } from '@bluepax/core';
import { SITE_DATA_DEFAULTS } from './settings.ts';

// site module (chapter 3): site type, name, languages, publisher, legal entities and locations,
// contact details, instant messaging, social links, navigation, footer, branding, time zone,
// SMTP, the export of the instance configuration, and the database backups ("设置 → 备份",
// docs/adr/0019). Admin only: editors get nothing here.
export const siteModule = defineModule({
  id: 'site',
  version: '1.0.0',
  // Logo, site icon and publisher logo are media items (docs/adr/0008); menu items link to
  // pages (docs/adr/0009), post categories and posts, and the Person publisher is an author
  // (docs/adr/0010).
  dependsOn: ['media', 'pages', 'posts'],
  migrations: 'site',
  permissions: [
    { name: 'site.manage', kind: 'settings' },
    // Downloading a backup hands out the whole database, so it is a permission of its own.
    { name: 'site.backups', kind: 'settings' },
  ],
  jobs: ['backup'],
  menu: [{ label: 'nav_settings', href: '/settings', permission: 'site.manage' }],
  endpoints: [{ method: 'GET', path: '/delivery/v1/site' }],
  // TODO(M2): emitted on settings, navigation and footer changes once webhooks exist.
  webhookEvents: ['site.updated'],
  settings: { ...SITE_DATA_DEFAULTS, 'site.smtp': null },
});
