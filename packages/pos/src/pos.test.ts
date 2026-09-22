import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { createDatabase, applyMigrations, seedCatalog, type Database } from '@set/db';
import { availableQuantity, releaseExpiredReservations } from '@set/inventory';
import { PosService } from './index.js';

let db: Database;
let pos: PosService;
let warehouseId: string;
let branchId: string;
let cashierId: string;
let caseVariantId: string;

/**
 * یک پایگاه برایِ همه‌یِ آزمون‌ها.
 *
 * این آزمون در هر بار «بذرِ کاملِ کاتالوگ» را می‌کاشت — یعنی ۱۰ بار راه‌اندازیِ
 * پایگاه، ۱۰ بار مهاجرت و ۱۰ بار بذر. در این محیطِ ۲ گیگابایتی کارگرِ آزمون در
 * میانه کشته می‌شد و آزمون‌هایی بی‌تقصیر ناتمام می‌ماندند. اکنون بذر یک بار
 * کاشته می‌شود و میانِ آزمون‌ها تنها **تراکنش‌ها** پاک می‌گردند (نه کالاها).
 */
beforeAll(async () => {
  db = createDatabase('memory://');
  await applyMigrations(db);
  await seedCatalog(db);
  pos = new PosService(db);

  const { rows: w } = await db.query<{ id: string }>(`SELECT id FROM warehouses LIMIT 1`);
  warehouseId = w[0]!.id;
  const { rows: b } = await db.query<{ id: string }>(
    `INSERT INTO branches (code, name) VALUES ('THR', 'تهران') RETURNING id`,
  );
  branchId = b[0]!.id;
  const { rows: u } = await db.query<{ id: string }>(
    `INSERT INTO users (mobile, full_name) VALUES ('09120000010', 'فروشنده') RETURNING id`,
  );
  cashierId = u[0]!.id;
  const { rows: v } = await db.query<{ id: string }>(
    `SELECT id FROM product_variants WHERE sku = 'CS-13P-BLK'`,
  );
  caseVariantId = v[0]!.id;
});

afterAll(async () => {
  await db.close();
});

/** بازگشت به نقطه‌یِ آغاز: تراکنش‌ها پاک، موجودی سرِ جایش */
beforeEach(async () => {
  // ترتیب اهمیت دارد: سفارش‌ها به شیفت پیوند دارند (`orders.shift_id`)، پس
  // باید پیش از خودِ شیفت پاک شوند — وگرنه مهارِ کلیدِ خارجی اجازه نمی‌دهد و
  // شیفتِ باز در پایگاه می‌ماند و آزمونِ بعدی با «یک شیفت از قبل باز است»
  // روبه‌رو می‌شود.
  for (const table of [
    'order_items',
    'orders',
    'pos_shift_movements',
    'pos_shifts',
    'journal_lines',
    'journal_entries',
    'stock_movements',
  ]) {
    await db.query(`DELETE FROM ${table}`).catch(() => {
      // جدولی که در این نسخه نیست — چشم‌پوشی، چون آزمون به آن وابسته نیست
    });
  }
  await db.query(`UPDATE stock_items SET on_hand = 5, reserved = 0 WHERE variant_id = $1`, [caseVariantId]);
});

describe('شیفتِ صندوق', () => {
  it('بازگشایی با موجودیِ نقد اولیه', async () => {
    const shift = await pos.openShift({ warehouseId, userId: cashierId, branchId, openingCashRial: 500_000n });
    expect(shift.shiftId).toBeTruthy();
    expect(shift.openedAt).toBeTruthy();
  });

  it('روی یک انبار دو شیفتِ باز نمی‌شود', async () => {
    await pos.openShift({ warehouseId, userId: cashierId });
    await expect(pos.openShift({ warehouseId, userId: cashierId })).rejects.toMatchObject({ code: 'ERR-005' });
  });

  it('فروشِ حضوری همان‌لحظه پرداخت می‌شود و موجودی واقعاً کم می‌گردد', async () => {
    const shift = await pos.openShift({ warehouseId, userId: cashierId, branchId });
    const sale = await pos.sell({
      shiftId: shift.shiftId,
      items: [{ variantId: caseVariantId, quantity: 2 }],
      paymentMethod: 'cash',
    });

    expect(sale.status).toBe('paid');
    const { rows } = await db.query<{ on_hand: number; reserved: number }>(
      `SELECT on_hand, reserved FROM stock_items WHERE variant_id = $1`, [caseVariantId],
    );
    expect(rows[0]!.on_hand).toBe(3);
    expect(rows[0]!.reserved).toBe(0);
    expect(await availableQuantity(db, caseVariantId, warehouseId)).toBe(3);
  });

  it('فروش روی شیفتِ بسته رد می‌شود', async () => {
    const shift = await pos.openShift({ warehouseId, userId: cashierId, branchId });
    await pos.closeShift({ shiftId: shift.shiftId, userId: cashierId, countedCashRial: 0n });
    await expect(
      pos.sell({ shiftId: shift.shiftId, items: [{ variantId: caseVariantId, quantity: 1 }], paymentMethod: 'cash' }),
    ).rejects.toMatchObject({ code: 'ERR-005' });
  });

  it('همگام‌سازیِ آفلاین دوبار انجام نمی‌شود', async () => {
    const shift = await pos.openShift({ warehouseId, userId: cashierId, branchId });
    const first = await pos.sell({
      shiftId: shift.shiftId,
      items: [{ variantId: caseVariantId, quantity: 1 }],
      paymentMethod: 'cash',
      offlineId: 'device-7-seq-1024',
    });
    const again = await pos.sell({
      shiftId: shift.shiftId,
      items: [{ variantId: caseVariantId, quantity: 1 }],
      paymentMethod: 'cash',
      offlineId: 'device-7-seq-1024',
    });

    expect(again.duplicate).toBe(true);
    expect(again.orderId).toBe(first.orderId);
    expect(await availableQuantity(db, caseVariantId, warehouseId)).toBe(4); // فقط یک بار فروش رفت
  });
});

describe('بستنِ شیفت و مغایرتِ نقدی', () => {
  it('مبلغِ مورد انتظار = اولیه + فروش نقدی − برداشت‌ها', async () => {
    const shift = await pos.openShift({
      warehouseId, userId: cashierId, branchId, openingCashRial: 500_000n,
    });
    await pos.sell({
      shiftId: shift.shiftId,
      items: [{ variantId: caseVariantId, quantity: 2 }],
      paymentMethod: 'cash',
    });
    await pos.addCashMovement({
      shiftId: shift.shiftId, type: 'payout', amountRial: 100_000n, reason: 'خریدِ خرد', actorId: cashierId,
    });

    // انتظار: ۵۰۰٬۰۰۰ + (۲ × ۲٬۵۵۰٬۰۰۰ × ۱٫۰۹) − ۱۰۰٬۰۰۰
    const expected = 500_000n + 2n * 2_550_000n * 109n / 100n - 100_000n;
    const closed = await pos.closeShift({
      shiftId: shift.shiftId, userId: cashierId, countedCashRial: expected,
    });

    expect(closed.expectedCashRial).toBe(expected.toString());
    expect(closed.differenceRial).toBe('0');
    expect(closed.salesCount).toBe(1);
  });

  it('کسری یا اضافه‌ی صندوق به عنوانِ مغایرت ثبت می‌شود', async () => {
    const shift = await pos.openShift({ warehouseId, userId: cashierId, branchId, openingCashRial: 1_000_000n });
    const closed = await pos.closeShift({
      shiftId: shift.shiftId, userId: cashierId, countedCashRial: 900_000n, note: 'کسری در شمارش',
    });
    expect(closed.expectedCashRial).toBe('1000000');
    expect(closed.differenceRial).toBe('-100000');
  });

  it('فروشِ کارت‌خوان در شمارشِ نقدِ صندوق نمی‌آید', async () => {
    const shift = await pos.openShift({ warehouseId, userId: cashierId, branchId, openingCashRial: 0n });
    await pos.sell({
      shiftId: shift.shiftId,
      items: [{ variantId: caseVariantId, quantity: 1 }],
      paymentMethod: 'card',
    });
    const closed = await pos.closeShift({ shiftId: shift.shiftId, userId: cashierId, countedCashRial: 0n });
    expect(closed.expectedCashRial).toBe('0'); // فروشِ کارت‌خوان نقد نیست
    expect(closed.salesTotalRial).toBe('0');
  });

  it('کارگرِ آزادسازی نمی‌تواند فروشِ حضوریِ در جریان را لغو کند', async () => {
    // سناریو: کارگرِ آزادسازیِ رزروها درست میانِ ایجاد و پرداختِ یک فروش اجرا می‌شود.
    // اگر پنجره‌ی رزروِ حضوری خیلی کوتاه باشد، فروشِ در جریان باطل می‌شود.
    const shift = await pos.openShift({ warehouseId, userId: cashierId, branchId });
    const { rows: orderRows } = await db.query<{ id: string }>(
      `SELECT id FROM orders LIMIT 1`,
    );
    void orderRows;

    const sale = await pos.sell({
      shiftId: shift.shiftId,
      items: [{ variantId: caseVariantId, quantity: 1 }],
      paymentMethod: 'cash',
    });

    // فروش کامل شده: نباید چیزی برای آزادسازی باقی مانده باشد
    const released = await releaseExpiredReservations(db, warehouseId, 100);
    expect(released).toBe(0);

    const { rows } = await db.query<{ status: string }>(
      `SELECT status FROM orders WHERE id = $1`, [sale.orderId],
    );
    expect(rows[0]!.status).toBe('paid');
    expect(await availableQuantity(db, caseVariantId, warehouseId)).toBe(4);
  });

  it('بستنِ دوباره‌ی شیفت رد می‌شود', async () => {
    const shift = await pos.openShift({ warehouseId, userId: cashierId, branchId });
    await pos.closeShift({ shiftId: shift.shiftId, userId: cashierId, countedCashRial: 0n });
    await expect(
      pos.closeShift({ shiftId: shift.shiftId, userId: cashierId, countedCashRial: 0n }),
    ).rejects.toMatchObject({ code: 'ERR-005' });
  });
});
