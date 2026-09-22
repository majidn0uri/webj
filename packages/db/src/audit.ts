import type { Queryable } from './client.js';

/**
 * ثبتِ حسابرسی (بخش T): هیچ عملیاتِ حساسی بدون رد در `audit_logs` انجام نمی‌شود.
 * این جدول برای پاسخ‌گویی («چه کسی، کی، چه تغییری داد») و برای بازسازیِ وضعیت استفاده می‌شود.
 */
export interface AuditEntry {
  actorUserId?: string | null;
  action: string;
  entity: string;
  entityId?: string | null;
  before?: unknown;
  after?: unknown;
  ip?: string | null;
}

export async function recordAudit(
  db: Queryable,
  entry: AuditEntry,
): Promise<void> {
  await db.query(
    `INSERT INTO audit_logs (actor_user_id, action, entity, entity_id, before_data, after_data, ip)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7)`,
    [
      entry.actorUserId ?? null,
      entry.action,
      entry.entity,
      entry.entityId ?? null,
      entry.before === undefined ? null : JSON.stringify(entry.before),
      entry.after === undefined ? null : JSON.stringify(entry.after),
      entry.ip ?? null,
    ],
  );
}

/** خواندنِ تاریخچه‌ی یک موجودیت — برای نمایش در پنل و برای پشتیبانی */
export async function auditTrail(
  db: Queryable,
  entity: string,
  entityId: string,
  limit = 50,
): Promise<
  Array<{ action: string; actorUserId: string | null; before: unknown; after: unknown; createdAt: string }>
> {
  const { rows } = await db.query<{
    action: string;
    actor_user_id: string | null;
    before_data: unknown;
    after_data: unknown;
    created_at: string;
  }>(
    `SELECT action, actor_user_id, before_data, after_data, created_at
       FROM audit_logs
      WHERE entity = $1 AND entity_id = $2
      ORDER BY created_at DESC
      LIMIT $3`,
    [entity, entityId, limit],
  );
  return rows.map((r) => ({
    action: r.action,
    actorUserId: r.actor_user_id,
    before: r.before_data,
    after: r.after_data,
    createdAt: r.created_at,
  }));
}
