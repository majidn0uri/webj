import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createDatabase, type Database } from './client.js';
import { applyMigrations } from './migrate.js';
import { publishEvent, processOutboxBatch, type OutboxEvent } from './outbox.js';
import { recordAudit, auditTrail } from './audit.js';

let db: Database;

beforeEach(async () => {
  db = createDatabase('memory://');
  await applyMigrations(db);
});

afterEach(async () => db.close());

describe('الگوی Outbox (بخش Q-8)', () => {
  it('رخداد در همان تراکنشِ تغییرِ داده ثبت می‌شود', async () => {
    const { rows: t } = await db.query<{ id: string }>(
      // مهاجرتِ ۰۲۹ رده‌بندیِ بنیادی را می‌سازد؛ اگر این کلید از پیش هست،
      // همان را به‌کار می‌بریم (مالکیتِ رده‌بندی با مهاجرت است، نه آزمون).
      `INSERT INTO product_types (key, name) VALUES ('case', 'قاب')
         ON CONFLICT (key) DO UPDATE SET name = EXCLUDED.name
         RETURNING id`,
    );
    await db.transaction(async (tx) => {
      const { rows: p } = await tx.query<{ id: string }>(
        `INSERT INTO products (type_id, title, slug) VALUES ($1, 'قاب', 'case-1') RETURNING id`,
        [t[0]!.id],
      );
      await publishEvent(tx, {
        aggregate: 'product',
        aggregateId: p[0]!.id,
        eventType: 'product.created',
        payload: { title: 'قاب' },
      });
    });

    const { rows } = await db.query<{ event_type: string; payload: Record<string, unknown> }>(
      `SELECT event_type, payload FROM outbox_events`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.event_type).toBe('product.created');
    expect(rows[0]!.payload).toMatchObject({ title: 'قاب' });
  });

  it('ارسالِ موفق، رخداد را ارسال‌شده علامت می‌زند', async () => {
    await publishEvent(db, {
      aggregate: 'order', aggregateId: '11111111-1111-1111-1111-111111111111',
      eventType: 'order.placed', payload: { total: 1 },
    });
    const handled: string[] = [];
    const result = await processOutboxBatch(db, async (e: OutboxEvent) => {
      handled.push(e.event_type);
    });
    expect(result).toEqual({ processed: 1, succeeded: 1, failed: 0 });
    expect(handled).toEqual(['order.placed']);
    const { rows } = await db.query<{ sent: string | null }>(`SELECT sent_at FROM outbox_events`);
    expect(rows[0]!.sent).not.toBeNull();
  });

  it('شکست در ارسال ثبت می‌شود و با فاصله‌ی زمانی دوباره تلاش می‌گردد', async () => {
    await publishEvent(db, {
      aggregate: 'sms', aggregateId: '22222222-2222-2222-2222-222222222222',
      eventType: 'sms.send', payload: { to: '0912' },
    });

    const failing = vi.fn().mockRejectedValue(new Error('سرویس پیامک در دسترس نیست'));
    // فاصله‌ی صفر برای این‌که تلاشِ بعدی بلافاصله در دسترس باشد
    const first = await processOutboxBatch(db, failing, { backoffBaseSeconds: 0 });
    expect(first.failed).toBe(1);

    const { rows } = await db.query<{ attempts: number; payload: Record<string, unknown> }>(
      `SELECT attempts, payload FROM outbox_events`,
    );
    expect(rows[0]!.attempts).toBe(1);
    expect(rows[0]!.payload).toMatchObject({ last_error: 'سرویس پیامک در دسترس نیست' });

    // تلاشِ دوم: این بار موفق
    const second = await processOutboxBatch(db, async () => {});
    expect(second).toEqual({ processed: 1, succeeded: 1, failed: 0 });
  });

  it('فاصله‌ی زمانیِ فزاینده مانع از تلاشِ فوری می‌شود (جلوی حمله به سرویسِ معیوب)', async () => {
    await publishEvent(db, {
      aggregate: 'sms', aggregateId: '55555555-5555-5555-5555-555555555555',
      eventType: 'sms.send', payload: { to: '0913' },
    });
    const failing = vi.fn().mockRejectedValue(new Error('خطا'));
    await processOutboxBatch(db, failing);

    // بلافاصله بعد از شکست، رخداد نباید دوباره برداشته شود
    const immediate = await processOutboxBatch(db, async () => {});
    expect(immediate.processed).toBe(0);

    const { rows } = await db.query<{ available_at: string }>(`SELECT available_at FROM outbox_events`);
    expect(new Date(rows[0]!.available_at).getTime()).toBeGreaterThan(Date.now());
  });

  it('ارسالِ رخداد، تراکنشِ اصلی را خراب نمی‌کند (استقلال)', async () => {
    await expect(
      db.transaction(async (tx) => {
        await publishEvent(tx, {
          aggregate: 'x', aggregateId: '33333333-3333-3333-3333-333333333333',
          eventType: 'x.y', payload: {},
        });
        throw new Error('خطای عمدی در کارِ اصلی');
      }),
    ).rejects.toThrow('خطای عمدی');

    const { rows } = await db.query(`SELECT 1 FROM outbox_events`);
    expect(rows).toHaveLength(0); // رخداد هم با تراکنش برگشت خورده است
  });
});

describe('ثبتِ حسابرسی (بخش T)', () => {
  it('تغییرات با «قبل و بعد» ثبت می‌شوند و تاریخچه قابل خواندن است', async () => {
    const { rows: u } = await db.query<{ id: string }>(
      `INSERT INTO users (mobile, full_name) VALUES ('09120000001', 'علی') RETURNING id`,
    );
    const userId = u[0]!.id;

    await recordAudit(db, {
      actorUserId: userId,
      action: 'product.price.change',
      entity: 'product_variant',
      entityId: '44444444-4444-4444-4444-444444444444',
      before: { price_rial: 100_000 },
      after: { price_rial: 120_000 },
      ip: '10.0.0.1',
    });

    const trail = await auditTrail(db, 'product_variant', '44444444-4444-4444-4444-444444444444');
    expect(trail).toHaveLength(1);
    expect(trail[0]!.action).toBe('product.price.change');
    expect(trail[0]!.before).toEqual({ price_rial: 100_000 });
    expect(trail[0]!.after).toEqual({ price_rial: 120_000 });
    expect(trail[0]!.actorUserId).toBe(userId);
  });
});
