import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { applyMigrations, createDatabase, type Database } from '@set/db';
import { createInteraction, createSegment, createTag, createFollowUp, crmStats, customer360, evaluateSegment } from './index.js';

let db: Database;
let customerId: string;
let userId: string;
beforeAll(async () => {
  db = createDatabase('memory://');
  await applyMigrations(db);
  const customer = await db.query<{ id: string }>(`INSERT INTO customers (full_name, phone, is_partner)
    VALUES ('مشتری آزمون CRM', '09120000444', true) RETURNING id`);
  customerId = customer.rows[0]!.id;
  const user = await db.query<{ id: string }>(`INSERT INTO users (mobile, full_name, password_hash)
    VALUES ('09120000555', 'همکار آزمون', 'not-a-password-hash') RETURNING id`);
  userId = user.rows[0]!.id;
});
afterAll(async () => { await db?.close(); });

describe('مسیرهای داده CRM روی پایگاه واقعی درون‌حافظه', () => {
  it('تعامل با UUID معتبر و فیلدهای nullable ذخیره می‌شود', async () => {
    const id = await createInteraction(db, { customerId, type: 'note', subject: 'پیگیری آزمون',
      createdBy: userId, body: null, outcome: null, priority: null, orderId: null, returnId: null });
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    const row = await db.query<{ priority: string; body: string | null }>('SELECT priority, body FROM customer_interactions WHERE id = $1', [id]);
    expect(row.rows[0]).toEqual({ priority: 'normal', body: null });
  });
  it('قواعد jsonb بدون JSON.parse دوباره ارزیابی می‌شوند', async () => {
    const segmentId = await createSegment(db, { name: 'همکاران', description: null, rules: { isPartner: true } });
    expect((await evaluateSegment(db, String(segmentId))).map((row) => row.customer_id)).toContain(customerId);
  });
  it('برچسب و پیگیری با فیلدهای خالی قرارداد API را می‌پذیرند', async () => {
    expect(await createTag(db, { name: 'آزمون', color: null, description: null })).toBeTruthy();
    expect(await createFollowUp(db, { customerId, interactionId: null, title: 'تماس مجدد', description: null,
      assignedTo: null, dueAt: new Date(), createdBy: userId })).toBeTruthy();
  });
  it('آمار پیشخوان عدد است و تعامل ذخیره‌شده را می‌شمارد', async () => {
    const stats = await crmStats(db);
    expect(stats.totalCustomers).toBe(1);
    expect(stats.totalInteractions).toBe(1);
    expect(stats.pendingFollowUps).toBe(1);
  });
  it('پرونده ۳۶۰ مشتری بدون سفارش قابل مشاهده است', async () => {
    const result = await customer360(db, customerId);
    expect(result.customer.id).toBe(customerId);
    expect(result.stats.totalSpentToman).toBe(0);
  });
});
