import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createDatabase, type Database } from './client.js';
import { applyMigrations } from './migrate.js';
import { nextNumber, formatNumber } from './numbering.js';

let db: Database;

beforeEach(async () => {
  db = createDatabase('memory://');
  await applyMigrations(db);
});

afterEach(async () => {
  await db.close();
});

describe('شماره‌گذاریِ اسناد (بخش Q-1)', () => {
  it('شماره‌ها پیوسته و بدون تکرار صادر می‌شوند', async () => {
    const a = await nextNumber(db, 'order');
    const b = await nextNumber(db, 'order');
    const c = await nextNumber(db, 'order');
    expect([a.value, b.value, c.value]).toEqual([1n, 2n, 3n]);
  });

  it('زیر بارِ همزمان هیچ شماره‌ای تکرار نمی‌شود (بدون MAX()+1)', async () => {
    const results = await Promise.all(
      Array.from({ length: 50 }, () => nextNumber(db, 'invoice')),
    );
    const values = results.map((r) => Number(r.value)).sort((x, y) => x - y);
    expect(new Set(values).size).toBe(50);
    expect(values[0]).toBe(1);
    expect(values[49]).toBe(50);
  });

  it('کلیدهای مختلف مستقل از هم شماره می‌گیرند', async () => {
    await nextNumber(db, 'order');
    await nextNumber(db, 'order');
    const inv = await nextNumber(db, 'invoice');
    expect(inv.value).toBe(1n);
  });

  it('دامنه (scope) جداگانه برای شعبه‌ها پشتیبانی می‌شود', async () => {
    await nextNumber(db, 'order', { scope: 'branch:tehran' });
    await nextNumber(db, 'order', { scope: 'branch:tehran' });
    const shiraz = await nextNumber(db, 'order', { scope: 'branch:shiraz' });
    expect(shiraz.value).toBe(1n);
  });

  it('قالبِ شماره: ORD-1405-000123', () => {
    expect(formatNumber(123n, { prefix: 'ORD', jalaliYear: 1405, pad: 6 })).toBe('ORD-1405-000123');
    expect(formatNumber(7n, { pad: 4 })).toBe('0007');
  });
});

describe('یکپارچگیِ شِما', () => {
  it('مهاجرت‌ها دوبار اجرا نمی‌شوند (تکرارپذیر)', async () => {
    const { rows } = await db.query<{ version: string }>('SELECT version FROM schema_migrations');
    expect(rows.length).toBeGreaterThan(0);
    const second = await applyMigrations(db);
    expect(second).toEqual([]);
  });

  it('قیدهای موجودی: مقدارِ رزرو نمی‌تواند از موجودی بیشتر شود', async () => {
    const { rows: w } = await db.query<{ id: string }>(
      `INSERT INTO warehouses (name, is_default) VALUES ('انبار مرکزی', true) RETURNING id`,
    );
    const { rows: t } = await db.query<{ id: string }>(
      // مهاجرتِ ۰۲۹ رده‌بندیِ بنیادی را می‌سازد؛ اگر این کلید از پیش هست،
      // همان را به‌کار می‌بریم (مالکیتِ رده‌بندی با مهاجرت است، نه آزمون).
      `INSERT INTO product_types (key, name) VALUES ('case', 'قاب')
         ON CONFLICT (key) DO UPDATE SET name = EXCLUDED.name
         RETURNING id`,
    );
    const { rows: p } = await db.query<{ id: string }>(
      `INSERT INTO products (type_id, title, slug) VALUES ($1, 'قاب سیلیکونی', 'case-silicon')
       RETURNING id`,
      [t[0]!.id],
    );
    const { rows: v } = await db.query<{ id: string }>(
      `INSERT INTO product_variants (product_id, sku, price_rial) VALUES ($1, 'CS-001', 2550000)
       RETURNING id`,
      [p[0]!.id],
    );

    await db.query(
      `INSERT INTO stock_items (variant_id, warehouse_id, on_hand, reserved)
       VALUES ($1, $2, 5, 3)`,
      [v[0]!.id, w[0]!.id],
    );

    await expect(
      db.query(
        `UPDATE stock_items SET reserved = 99 WHERE variant_id = $1 AND warehouse_id = $2`,
        [v[0]!.id, w[0]!.id],
      ),
    ).rejects.toThrow();
  });

  it('مبالغ در ستون‌های BIGINT نگه‌داری می‌شوند (بخش Q-2)', async () => {
    const { rows } = await db.query<{ data_type: string }>(
      `SELECT data_type FROM information_schema.columns
       WHERE table_name = 'order_items' AND column_name = 'unit_price_rial'`,
    );
    expect(rows[0]?.data_type).toBe('bigint');
  });
});
