// Audit log (chapter 9): logins, permissions, settings, publishing, deletions, tokens, storage.
import { schema, type Database, type Executor } from '@bluepax/db';
import { desc, eq, lt } from 'drizzle-orm';

export interface AuditEntry {
  /** `<area>.<event>`, e.g. `auth.login`, `users.create`. */
  action: string;
  actorId?: string | null;
  targetType?: string;
  targetId?: string;
  details?: Record<string, unknown>;
  ip?: string | null;
}

/** Takes a transaction too, so a change and its log entry are written together. */
export async function audit(db: Executor, entry: AuditEntry): Promise<void> {
  await db.insert(schema.auditLog).values({
    action: entry.action,
    actorId: entry.actorId ?? null,
    targetType: entry.targetType ?? null,
    targetId: entry.targetId ?? null,
    details: entry.details ?? {},
    ip: entry.ip ?? null,
  });
}

export async function listAudit(db: Database, options: { limit?: number; beforeId?: number } = {}) {
  const limit = Math.min(options.limit ?? 50, 200);
  return db
    .select({
      id: schema.auditLog.id,
      at: schema.auditLog.at,
      action: schema.auditLog.action,
      targetType: schema.auditLog.targetType,
      targetId: schema.auditLog.targetId,
      details: schema.auditLog.details,
      ip: schema.auditLog.ip,
      actorName: schema.users.displayName,
      actorEmail: schema.users.email,
    })
    .from(schema.auditLog)
    .leftJoin(schema.users, eq(schema.users.id, schema.auditLog.actorId))
    .where(options.beforeId ? lt(schema.auditLog.id, options.beforeId) : undefined)
    .orderBy(desc(schema.auditLog.id))
    .limit(limit);
}
