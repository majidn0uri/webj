import type { Queryable } from '@set/db';
import { randomUUID } from 'node:crypto';
import { AppError } from '@set/shared-kernel';

/* ════════════════════════════════════════════════════════════════════════
   CRM — مدیریت ارتباط با مشتری
   ════════════════════════════════════════════════════════════════════════ */

// ── تعاملات ──────────────────────────────────────────────────────────

export type InteractionType =
  | 'call_incoming' | 'call_outgoing' | 'meeting' | 'email'
  | 'whatsapp' | 'sms' | 'note' | 'complaint' | 'feedback' | 'follow_up';

export interface CreateInteractionInput {
  customerId: string;
  type: InteractionType;
  subject: string;
  body?: string | null;
  outcome?: string | null;
  priority?: 'low' | 'normal' | 'high' | 'urgent' | null;
  nextAction?: string | null;
  nextActionAt?: Date;
  orderId?: string | null;
  returnId?: string | null;
  createdBy: string;
}

export async function createInteraction(db: Queryable, input: CreateInteractionInput): Promise<string> {
  const id = randomUUID();
  await db.query(
    `INSERT INTO customer_interactions
       (id, customer_id, type, subject, body, outcome, priority, next_action, next_action_at, order_id, return_id, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
    [id, input.customerId, input.type, input.subject,
     input.body ?? null, input.outcome ?? null, input.priority ?? 'normal',
     input.nextAction ?? null, input.nextActionAt ?? null,
     input.orderId ?? null, input.returnId ?? null, input.createdBy],
  );
  return id;
}

export async function listInteractions(
  db: Queryable,
  opts: { customerId: string; type?: string; limit?: number },
) {
  const conditions = ['ci.customer_id = $1'];
  const params: unknown[] = [opts.customerId];
  if (opts.type) { params.push(opts.type); conditions.push(`ci.type = $${params.length}`); }
  const limit = Math.min(opts.limit ?? 50, 200);

  const { rows } = await db.query(
    `SELECT ci.id, ci.type, ci.subject, ci.body, ci.outcome, ci.priority,
            ci.next_action, ci.next_action_at, ci.order_id, ci.return_id,
            ci.created_at, u.full_name AS created_by_name
     FROM customer_interactions ci
     LEFT JOIN users u ON u.id = ci.created_by
     WHERE ${conditions.join(' AND ')}
     ORDER BY ci.created_at DESC
     LIMIT ${limit}`,
    params,
  );
  return rows;
}

export async function getInteraction(db: Queryable, id: string) {
  const { rows } = await db.query(
    `SELECT ci.*, u.full_name AS created_by_name,
            c.full_name AS customer_name, c.phone AS customer_phone
     FROM customer_interactions ci
     LEFT JOIN users u ON u.id = ci.created_by
     LEFT JOIN customers c ON c.id = ci.customer_id
     WHERE ci.id = $1`,
    [id],
  );
  return rows[0] ?? null;
}

export async function updateInteraction(
  db: Queryable,
  id: string,
  input: { subject?: string; body?: string | null; outcome?: string | null; priority?: string; nextAction?: string | null; nextActionAt?: Date },
) {
  const sets: string[] = ['updated_at = now()'];
  const params: unknown[] = [id];
  if (input.subject !== undefined) { params.push(input.subject); sets.push(`subject = $${params.length}`); }
  if (input.body !== undefined) { params.push(input.body); sets.push(`body = $${params.length}`); }
  if (input.outcome !== undefined) { params.push(input.outcome); sets.push(`outcome = $${params.length}`); }
  if (input.priority !== undefined) { params.push(input.priority); sets.push(`priority = $${params.length}`); }
  if (input.nextAction !== undefined) { params.push(input.nextAction); sets.push(`next_action = $${params.length}`); }
  if (input.nextActionAt !== undefined) { params.push(input.nextActionAt); sets.push(`next_action_at = $${params.length}`); }

  await db.query(`UPDATE customer_interactions SET ${sets.join(', ')} WHERE id = $1`, params);
}

// ── برچسب‌ها ──────────────────────────────────────────────────────────

export async function listTags(db: Queryable) {
  const { rows } = await db.query(
    `SELECT t.id, t.name, t.color, t.description,
            COUNT(ta.customer_id)::int AS customer_count
     FROM customer_tags t
     LEFT JOIN customer_tag_assignments ta ON ta.tag_id = t.id
     GROUP BY t.id ORDER BY t.name`,
  );
  return rows;
}

export async function createTag(db: Queryable, input: { name: string; color?: string | null; description?: string | null }) {
  const { rows } = await db.query(
    `INSERT INTO customer_tags (name, color, description) VALUES ($1,$2,$3) RETURNING id`,
    [input.name, input.color ?? '#6b7280', input.description ?? null],
  );
  return rows[0]!.id;
}

export async function assignTag(db: Queryable, customerId: string, tagId: string, assignedBy: string) {
  await db.query(
    `INSERT INTO customer_tag_assignments (customer_id, tag_id, assigned_by)
     VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`,
    [customerId, tagId, assignedBy],
  );
}

export async function removeTag(db: Queryable, customerId: string, tagId: string) {
  await db.query(
    'DELETE FROM customer_tag_assignments WHERE customer_id = $1 AND tag_id = $2',
    [customerId, tagId],
  );
}

export async function customerTags(db: Queryable, customerId: string) {
  const { rows } = await db.query(
    `SELECT t.id, t.name, t.color
     FROM customer_tags t
     JOIN customer_tag_assignments ta ON ta.tag_id = t.id
     WHERE ta.customer_id = $1 ORDER BY t.name`,
    [customerId],
  );
  return rows;
}

// ── بخش‌بندی ──────────────────────────────────────────────────────────

export async function listSegments(db: Queryable) {
  const { rows } = await db.query(
    `SELECT id, name, description, rules, is_active, created_at FROM customer_segments ORDER BY name`,
  );
  return rows;
}

export async function createSegment(
  db: Queryable,
  input: { name: string; description?: string | null; rules: Record<string, unknown> },
) {
  const { rows } = await db.query(
    `INSERT INTO customer_segments (name, description, rules) VALUES ($1,$2,$3) RETURNING id`,
    [input.name, input.description ?? null, JSON.stringify(input.rules)],
  );
  return rows[0]!.id;
}

export async function evaluateSegment(db: Queryable, segmentId: string): Promise<Array<{ customer_id: string; full_name: string; phone: string }>> {
  const { rows: segRows } = await db.query<{ rules: string | Record<string, unknown> }>(
    'SELECT rules FROM customer_segments WHERE id = $1', [segmentId],
  );
  const seg = segRows[0];
  if (!seg) throw new AppError('NOT_FOUND');

  const rules = typeof seg.rules === 'string' ? JSON.parse(seg.rules) as Record<string, unknown> : seg.rules;
  const conditions = ['c.is_active = true'];
  const params: unknown[] = [];

  if (rules.isPartner === true) conditions.push('c.is_partner = true');
  if (typeof rules.minOrders === 'number') {
    params.push(rules.minOrders);
    conditions.push(`(SELECT COUNT(*) FROM orders o WHERE o.customer_id = c.id) >= $${params.length}`);
  }
  if (typeof rules.minSpentRial === 'string') {
    params.push(rules.minSpentRial);
    conditions.push(`(SELECT COALESCE(SUM(o.total_rial),0) FROM orders o WHERE o.customer_id = c.id) >= $${params.length}`);
  }
  if (typeof rules.hasTag === 'string') {
    params.push(rules.hasTag);
    conditions.push(`EXISTS (SELECT 1 FROM customer_tag_assignments ta JOIN customer_tags t ON t.id = ta.tag_id WHERE ta.customer_id = c.id AND t.name = $${params.length})`);
  }
  if (rules.registeredAfter) {
    params.push(rules.registeredAfter);
    conditions.push(`c.created_at >= $${params.length}`);
  }
  if (rules.noOrderDays) {
    params.push(rules.noOrderDays);
    conditions.push(`NOT EXISTS (SELECT 1 FROM orders o WHERE o.customer_id = c.id AND o.created_at > now() - interval '1 day' * $${params.length})`);
  }

  const { rows } = await db.query<{ customer_id: string; full_name: string; phone: string }>(
    `SELECT c.id AS customer_id, c.full_name, c.phone
     FROM customers c WHERE ${conditions.join(' AND ')}
     ORDER BY c.created_at DESC LIMIT 500`,
    params,
  );
  return rows;
}

// ── یادآوری پیگیری ──────────────────────────────────────────────────

export async function createFollowUp(
  db: Queryable,
  input: { customerId: string; interactionId?: string | null; title: string; description?: string | null; dueAt: Date; assignedTo?: string | null; createdBy: string },
) {
  const { rows } = await db.query(
    `INSERT INTO follow_ups (customer_id, interaction_id, title, description, due_at, assigned_to, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
    [input.customerId, input.interactionId ?? null, input.title, input.description ?? null,
     input.dueAt, input.assignedTo ?? null, input.createdBy],
  );
  return rows[0]!.id;
}

export async function listFollowUps(
  db: Queryable,
  opts: { assignedTo?: string; status?: string; limit?: number },
) {
  const conditions = ['1=1'];
  const params: unknown[] = [];
  if (opts.assignedTo) { params.push(opts.assignedTo); conditions.push(`f.assigned_to = $${params.length}`); }
  if (opts.status) { params.push(opts.status); conditions.push(`f.status = $${params.length}`); }
  else conditions.push(`f.status = 'pending'`);

  const limit = Math.min(opts.limit ?? 50, 200);
  const { rows } = await db.query(
    `SELECT f.id, f.title, f.description, f.due_at, f.status, f.assigned_to,
            c.full_name AS customer_name, c.phone AS customer_phone, c.id AS customer_id,
            u.full_name AS assigned_to_name
     FROM follow_ups f
     JOIN customers c ON c.id = f.customer_id
     LEFT JOIN users u ON u.id = f.assigned_to
     WHERE ${conditions.join(' AND ')}
     ORDER BY f.due_at ASC
     LIMIT ${limit}`,
    params,
  );
  return rows;
}

export async function completeFollowUp(db: Queryable, id: string) {
  await db.query(
    `UPDATE follow_ups SET status = 'done', completed_at = now() WHERE id = $1 AND status = 'pending'`,
    [id],
  );
}

export async function cancelFollowUp(db: Queryable, id: string) {
  await db.query(
    `UPDATE follow_ups SET status = 'cancelled' WHERE id = $1 AND status = 'pending'`,
    [id],
  );
}

// ── لاگ فعالیت ──────────────────────────────────────────────────────

export async function logActivity(
  db: Queryable,
  input: { customerId: string; activityType: string; metadata?: Record<string, unknown> },
) {
  await db.query(
    `INSERT INTO customer_activities (customer_id, activity_type, metadata) VALUES ($1,$2,$3)`,
    [input.customerId, input.activityType, JSON.stringify(input.metadata ?? {})],
  );
}

export async function listActivities(
  db: Queryable,
  opts: { customerId: string; type?: string; limit?: number },
) {
  const conditions = ['ca.customer_id = $1'];
  const params: unknown[] = [opts.customerId];
  if (opts.type) { params.push(opts.type); conditions.push(`ca.activity_type = $${params.length}`); }
  const limit = Math.min(opts.limit ?? 50, 200);

  const { rows } = await db.query(
    `SELECT ca.id, ca.activity_type, ca.metadata, ca.created_at
     FROM customer_activities ca
     WHERE ${conditions.join(' AND ')}
     ORDER BY ca.created_at DESC
     LIMIT ${limit}`,
    params,
  );
  return rows;
}

// ── CRM Dashboard Stats ──────────────────────────────────────────────

export async function crmStats(db: Queryable) {
  const counts =
    await Promise.all([
      db.query<{ total: string }>(`SELECT COUNT(*)::text AS total FROM customers WHERE is_active = true`),
      db.query<{ total: string }>(`SELECT COUNT(*)::text AS total FROM customer_interactions`),
      db.query<{ total: string }>(`SELECT COUNT(*)::text AS total FROM follow_ups WHERE status = 'pending'`),
      db.query<{ total: string }>(`SELECT COUNT(*)::text AS total FROM follow_ups WHERE status = 'pending' AND due_at < now()`),
      db.query<{ total: string }>(`SELECT COUNT(*)::text AS total FROM customers WHERE is_partner = true AND is_active = true`),
      db.query<{ total: string }>(`SELECT COUNT(DISTINCT ta.customer_id)::text AS total FROM customer_tag_assignments ta JOIN customer_tags t ON t.id = ta.tag_id WHERE t.name = 'VIP'`),
      db.query<{ total: string }>(`SELECT COUNT(*)::text AS total FROM customer_interactions WHERE type = 'complaint'`),
    ]);

  const [totalCustomers, totalInteractions, pendingFollowUps, overdueFollowUps, activePartners, vipCount, complaintCount] = counts.map(({ rows }) => Number(rows[0]?.total ?? 0));

  // آخرین تعاملات
  const { rows: recentInteractions } = await db.query(
    `SELECT ci.id, ci.type, ci.subject, ci.priority, ci.created_at,
            c.full_name AS customer_name, c.phone AS customer_phone
     FROM customer_interactions ci
     JOIN customers c ON c.id = ci.customer_id
     ORDER BY ci.created_at DESC LIMIT 10`,
  );

  // یادآوری‌های سررسید‌شده
  const { rows: overdueItems } = await db.query(
    `SELECT f.id, f.title, f.due_at,
            c.full_name AS customer_name, c.phone AS customer_phone, c.id AS customer_id
     FROM follow_ups f
     JOIN customers c ON c.id = f.customer_id
     WHERE f.status = 'pending' AND f.due_at < now()
     ORDER BY f.due_at ASC LIMIT 10`,
  );

  // مشتریان پرتعامل (بیشترین تعامل در ۳۰ روز اخیر)
  const { rows: topCustomers } = await db.query(
    `SELECT c.id, c.full_name, c.phone, COUNT(ci.id)::int AS interaction_count
     FROM customers c
     JOIN customer_interactions ci ON ci.customer_id = c.id
     WHERE ci.created_at > now() - interval '30 days'
     GROUP BY c.id ORDER BY interaction_count DESC LIMIT 10`,
  );

  return {
    totalCustomers: Number(totalCustomers),
    totalInteractions: Number(totalInteractions),
    pendingFollowUps: Number(pendingFollowUps),
    overdueFollowUps: Number(overdueFollowUps),
    activePartners: Number(activePartners),
    vipCount: Number(vipCount),
    complaintCount: Number(complaintCount),
    recentInteractions,
    overdueItems,
    topCustomers,
  };
}

// ── CRM 360° — نمای کامل مشتری ─────────────────────────────────────

export async function customer360(db: Queryable, customerId: string) {
  const { rows: custRows } = await db.query<{
    id: string; full_name: string; phone: string; email: string | null;
    national_id: string | null; kind: string; is_partner: boolean; is_active: boolean;
    note: string | null; credit_rial: string | number | null; check_ceiling_rial: string | number | null;
    registered_at: string;
  }>(
    `SELECT c.*, c.created_at AS registered_at
     FROM customers c WHERE c.id = $1`,
    [customerId],
  );
  const customer = custRows[0];
  if (!customer) throw new AppError('NOT_FOUND');

  const [tags, interactions, activities, followUps, orders, addresses] = await Promise.all([
    customerTags(db, customerId),
    listInteractions(db, { customerId, limit: 20 }),
    listActivities(db, { customerId, limit: 20 }),
    listFollowUps(db, { status: 'pending' }).then((all) => all.filter((f: Record<string, unknown>) => f.customer_id === customerId)),
    db.query(
      `SELECT id, order_no, status, total_rial::text, created_at
       FROM orders WHERE customer_id = $1 ORDER BY created_at DESC LIMIT 10`,
      [customerId],
    ).then((r) => r.rows),
    db.query(
      `SELECT id, receiver_name, phone, city, address, is_default
       FROM customer_addresses WHERE customer_id = $1 ORDER BY is_default DESC`,
      [customerId],
    ).then((r) => r.rows),
  ]);

  // آمار
  const { rows: statsRows } = await db.query<{
    total_orders: number; total_spent: string; delivered: number; cancelled: number;
    first_order: string | null; last_order: string | null;
  }>(
    `SELECT
       COUNT(*)::int AS total_orders,
       COALESCE(SUM(total_rial), 0)::text AS total_spent,
       COUNT(*) FILTER (WHERE status = 'delivered')::int AS delivered,
       COUNT(*) FILTER (WHERE status = 'cancelled')::int AS cancelled,
       MIN(created_at) AS first_order,
       MAX(created_at) AS last_order
     FROM orders WHERE customer_id = $1`,
    [customerId],
  );
  const stats = statsRows[0];

  return {
    customer: {
      id: customer.id, fullName: customer.full_name, phone: customer.phone,
      email: customer.email, nationalId: customer.national_id,
      kind: customer.kind, isPartner: customer.is_partner,
      isActive: customer.is_active, note: customer.note,
      creditToman: customer.credit_rial ? Number(BigInt(customer.credit_rial) / 10n) : 0,
      checkCeilingToman: customer.check_ceiling_rial ? Number(BigInt(customer.check_ceiling_rial) / 10n) : 0,
      registeredAt: customer.registered_at,
    },
    tags,
    stats: {
      totalOrders: stats?.total_orders ?? 0,
      totalSpentToman: stats?.total_spent ? Number(BigInt(stats.total_spent) / 10n) : 0,
      delivered: stats?.delivered ?? 0,
      cancelled: stats?.cancelled ?? 0,
      firstOrder: stats?.first_order,
      lastOrder: stats?.last_order,
    },
    interactions,
    activities,
    followUps,
    orders: orders.map((o: Record<string, unknown>) => ({
      id: o.id, orderNo: o.order_no, status: o.status,
      totalToman: Number(BigInt(o.total_rial as string) / 10n), createdAt: o.created_at,
    })),
    addresses,
  };
}