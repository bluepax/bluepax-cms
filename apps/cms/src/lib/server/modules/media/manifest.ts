import { defineModule } from '@bluepax/core';
import { DEFAULT_CACHE_DAYS, DEFAULT_UPLOAD_LIMITS_MB } from '@bluepax/presets';

/** Content actions: upload, folders, alt texts, replace and delete (editors have it). */
export const MEDIA_PERMISSION = 'media.edit';
/** Storage settings (chapter 3: "存储设置仅管理员"). */
export const STORAGE_PERMISSION = 'media.storage';

// media module (chapter 3 and 5): upload, folders, localized alt texts, derived files, usages;
// the storage settings are admin only. Local storage only in M1 (R2 follows in M3).
export const mediaModule = defineModule({
  id: 'media',
  version: '1.0.0',
  migrations: 'media',
  permissions: [
    { name: MEDIA_PERMISSION, kind: 'content' },
    { name: STORAGE_PERMISSION, kind: 'settings' },
  ],
  menu: [{ label: 'nav_media', href: '/media', permission: MEDIA_PERMISSION }],
  // TODO(M2): sent once webhooks exist. `media.replaced` on every replacement (default on);
  // `media.origin_changed` when the distribution origin switches (M3, with R2).
  webhookEvents: ['media.replaced', 'media.origin_changed'],
  // Stored in the `storage` section of the instance configuration (chapter 2).
  settings: {
    'storage.cacheDays': DEFAULT_CACHE_DAYS,
    'storage.uploadLimitsMb': DEFAULT_UPLOAD_LIMITS_MB,
  },
});
