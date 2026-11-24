// Storage settings ("媒体库 → 存储设置", admin only, chapter 5): the mode (local only in M1),
// the media cache lifetime and the upload limits. They are the `storage` section of the
// instance configuration (chapter 2), so the export writes them back to the config file.
import { schema, type Database, type Executor } from '@bluepax/db';
import { storageConfigSchema, type StorageConfig } from '@bluepax/presets';
import { eq } from 'drizzle-orm';
import { audit } from '../../audit.ts';
import { updateInstanceConfig } from '../../instance.ts';
import { configInputError } from '../site/values.ts';
import type { Actor } from './library.ts';

const DAY = 86_400;

/** Reads the storage section on its own; the file route needs it on every request. */
export async function readStorageConfig(db: Executor): Promise<StorageConfig> {
  const [row] = await db
    .select({ value: schema.settings.value })
    .from(schema.settings)
    .where(eq(schema.settings.key, 'storage'));
  return storageConfigSchema.parse(row?.value ?? { mode: 'local' });
}

/** `Cache-Control` of media responses (chapter 5, "缓存与收录"). */
export function mediaCacheControl(cacheDays: number): string {
  return `public, max-age=${cacheDays * DAY}, immutable`;
}

export interface StorageSettingsInput {
  cacheDays: number;
  uploadLimitsMb: { image: number; document: number; video: number };
}

/** Saves the cache lifetime and upload limits; the local source uses them right away. */
export async function saveStorageSettings(
  db: Database,
  input: StorageSettingsInput,
  actor: Actor,
): Promise<StorageConfig> {
  return db.transaction(async (tx) => {
    let result: Awaited<ReturnType<typeof updateInstanceConfig>>;
    try {
      result = await updateInstanceConfig(tx, (c) => ({
        ...c,
        storage: { ...c.storage, ...input },
      }));
    } catch (error) {
      configInputError(error, 'storage');
    }
    const before = result.before.storage;
    const after = result.after.storage;
    const fields = (['cacheDays', 'uploadLimitsMb'] as const).filter(
      (key) => JSON.stringify(before[key]) !== JSON.stringify(after[key]),
    );
    if (fields.length > 0) {
      await audit(tx, {
        action: 'media.storage_update',
        actorId: actor.id,
        targetType: 'settings',
        targetId: 'storage',
        details: Object.fromEntries(fields.map((f) => [f, { from: before[f], to: after[f] }])),
        ip: actor.ip,
      });
    }
    return after;
  });
}
