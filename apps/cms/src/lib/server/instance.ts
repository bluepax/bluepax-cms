// Instance initialisation and configuration, see docs/spec/README.md chapter 2.
// An instance is initialised once, either by the setup wizard or unattended from a config
// file; the configuration can be exported back in the same format at any time.
import {
  OPTIONAL_MODULES,
  type ModuleId,
  type ModuleRegistry,
  type OptionalModuleId,
} from '@bluepax/core';
import { schema, type Database, type Executor } from '@bluepax/db';
import {
  CONFIG_VERSION,
  validateConfig,
  type InstanceConfig,
  type SiteType,
} from '@bluepax/presets';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { postCategorySeeds, seedPostCategories } from './modules/posts/seeds.ts';
import { createUser, seedDefaultRoles, type NewUser } from './modules/users/accounts.ts';
import { ADMIN_ROLE } from './modules/users/auth.ts';

/**
 * Settings rows that hold the configuration sections (one row per section). The `posts`
 * section is not a row: it is read from the post categories and seeds them (docs/adr/0010).
 */
const SECTIONS = ['site', 'languages', 'frontend', 'blocks', 'storage', 'backups'] as const;
const INSTANCE_KEY = 'instance';

export interface InstanceRecord {
  version: number;
  initializedAt: string;
  /** The preset the instance started from; the site type itself can change later. */
  preset: SiteType;
  source: 'wizard' | 'config-file';
}

export class AlreadyInitializedError extends Error {
  override name = 'AlreadyInitializedError';
}

export interface InstanceState {
  initialized: boolean;
  hasAdmin: boolean;
}

export async function instanceState(db: Database): Promise<InstanceState> {
  const [record] = await db
    .select({ key: schema.settings.key })
    .from(schema.settings)
    .where(eq(schema.settings.key, INSTANCE_KEY));
  const [admin] = await db
    .select({ id: schema.users.id })
    .from(schema.users)
    .innerJoin(schema.roles, eq(schema.roles.id, schema.users.roleId))
    .where(and(eq(schema.roles.key, ADMIN_ROLE), isNull(schema.users.disabledAt)))
    .limit(1);
  return { initialized: record !== undefined, hasAdmin: admin !== undefined };
}

/** Optional modules switched on in instance_modules. */
export async function enabledOptionalModules(db: Executor): Promise<OptionalModuleId[]> {
  const rows = await db
    .select({ id: schema.instanceModules.moduleId })
    .from(schema.instanceModules)
    .where(eq(schema.instanceModules.enabled, true));
  const known = new Set<string>(OPTIONAL_MODULES);
  return rows
    .map((r) => r.id)
    .filter((id): id is OptionalModuleId => known.has(id))
    .sort();
}

export interface InitializeOptions {
  registry: ModuleRegistry;
  source: InstanceRecord['source'];
  /** First admin, created in the same transaction (setup wizard). */
  admin?: Omit<NewUser, 'roleId'>;
  now?: Date;
}

/**
 * Writes the configuration, the module switches and the preset seeds (default roles),
 * and optionally the first admin, all in one transaction. Fails if already initialised.
 */
export async function initializeInstance(
  db: Database,
  config: InstanceConfig,
  options: InitializeOptions,
): Promise<{ adminId: string | null }> {
  const record: InstanceRecord = {
    version: CONFIG_VERSION,
    initializedAt: (options.now ?? new Date()).toISOString(),
    preset: config.site.type,
    source: options.source,
  };
  return db.transaction(async (tx) => {
    // The instance row is the lock: a second initialisation inserts nothing and stops here.
    const claimed = await tx
      .insert(schema.settings)
      .values({ key: INSTANCE_KEY, value: record })
      .onConflictDoNothing()
      .returning({ key: schema.settings.key });
    if (claimed.length === 0)
      throw new AlreadyInitializedError('the instance is already initialised');

    await tx.insert(schema.settings).values(SECTIONS.map((key) => ({ key, value: config[key] })));
    const enabled = new Set<string>(config.modules.enabled);
    await tx
      .insert(schema.instanceModules)
      .values(OPTIONAL_MODULES.map((moduleId) => ({ moduleId, enabled: enabled.has(moduleId) })));

    const active = options.registry.resolveEnabled(config.modules.enabled);
    await seedDefaultRoles(tx, options.registry.editorPermissions(active));
    // The post categories of the configuration; the blog preset brings a default one.
    await seedPostCategories(tx, config.posts.categories);
    // Further preset seeds (the default inquiry routing rule) are added with the modules that
    // own them.

    return { adminId: options.admin ? await createFirstAdmin(tx, options.admin) : null };
  });
}

async function createFirstAdmin(db: Executor, admin: Omit<NewUser, 'roleId'>): Promise<string> {
  const [role] = await db
    .select({ id: schema.roles.id })
    .from(schema.roles)
    .where(eq(schema.roles.key, ADMIN_ROLE));
  if (!role) throw new Error('the admin role is missing');
  return createUser(db, { ...admin, roleId: role.id });
}

/** For an instance initialised from a config file: the wizard only creates the first admin. */
export async function createInitialAdmin(
  db: Database,
  admin: Omit<NewUser, 'roleId'>,
): Promise<string> {
  return db.transaction(async (tx) => {
    // Serialise concurrent wizard submissions; only the first may create the admin.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('bluepax:first-admin'))`);
    const existing = await tx
      .select({ id: schema.users.id })
      .from(schema.users)
      .innerJoin(schema.roles, eq(schema.roles.id, schema.users.roleId))
      .where(eq(schema.roles.key, ADMIN_ROLE))
      .limit(1);
    if (existing.length > 0) throw new AlreadyInitializedError('an administrator already exists');
    return createFirstAdmin(tx, admin);
  });
}

/** The current configuration in the config-file format (no secrets). */
export async function exportInstanceConfig(db: Executor): Promise<InstanceConfig> {
  const rows = await db
    .select()
    .from(schema.settings)
    .where(inArray(schema.settings.key, [...SECTIONS]));
  const sections = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  const config = validateConfig({
    version: CONFIG_VERSION,
    ...sections,
    modules: { enabled: await enabledOptionalModules(db) },
  });
  // Built from the categories of the current content languages, so it is always valid.
  const codes = config.languages.content.map((l) => l.code);
  return { ...config, posts: { categories: await postCategorySeeds(db, codes) } };
}

export type ConfigSection = (typeof SECTIONS)[number];

/**
 * Changes configuration sections from the admin (chapter 2: the config file and the settings
 * are the same data). The whole configuration is validated again, so a change can never
 * produce a configuration that a config file could not express. Returns the configuration
 * before and after; only the sections that changed are written. The `posts` section is
 * edited on the post categories pages, not here; a change that drops content languages must
 * drop their category names too, so the configuration stays valid.
 */
export async function updateInstanceConfig(
  db: Executor,
  change: (current: InstanceConfig) => unknown,
): Promise<{ before: InstanceConfig; after: InstanceConfig; changed: ConfigSection[] }> {
  // Serialise concurrent changes so one never validates against a stale configuration.
  await db.execute(sql`select pg_advisory_xact_lock(hashtext('bluepax:instance-config'))`);
  const before = await exportInstanceConfig(db);
  const after = validateConfig(change(structuredClone(before)));
  if (after.modules.enabled.join() !== before.modules.enabled.join()) {
    throw new Error('module switches are not changed through updateInstanceConfig');
  }
  const changed = SECTIONS.filter(
    (key) => JSON.stringify(after[key]) !== JSON.stringify(before[key]),
  );
  for (const key of changed) {
    await db
      .insert(schema.settings)
      .values({ key, value: after[key] })
      .onConflictDoUpdate({
        target: schema.settings.key,
        set: { value: after[key], updatedAt: sql`now()` },
      });
  }
  return { before, after, changed };
}

/** Admin UI language that new accounts start with. */
export async function defaultAdminLocale(db: Database): Promise<'zh' | 'en'> {
  const [row] = await db
    .select({ value: schema.settings.value })
    .from(schema.settings)
    .where(eq(schema.settings.key, 'languages'));
  return (row?.value as { admin?: string } | undefined)?.admin === 'en' ? 'en' : 'zh';
}

/** Modules that are active: core modules plus enabled optional modules with active dependencies. */
export async function activeModules(
  db: Database,
  registry: ModuleRegistry,
): Promise<Set<ModuleId>> {
  return registry.resolveEnabled(await enabledOptionalModules(db));
}
