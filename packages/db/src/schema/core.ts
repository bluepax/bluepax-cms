// Core tables shared by all modules, see docs/spec/README.md chapter 4.
// Times are always stored as timestamptz (UTC).
import { boolean, jsonb, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

const timestamps = {
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
};

/** Instance settings, one row per key. */
export const settings = pgTable('settings', {
  key: text('key').primaryKey(),
  value: jsonb('value').notNull(),
  ...timestamps,
});

/** Switch state of the optional modules. Core modules are always on and have no row. */
export const instanceModules = pgTable('instance_modules', {
  moduleId: text('module_id').primaryKey(),
  enabled: boolean('enabled').notNull(),
  ...timestamps,
});
