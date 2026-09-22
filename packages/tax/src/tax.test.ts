import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createDatabase, applyMigrations, seedCatalog, type Database } from '@set/db';
import {
  buildTaxId,
  dateHex,
  serialHex,
  verhoeffCheckDigit,
  taxIdLength,
  computeTotals,
  validateInvoice,
  buildInvoicePacket,
  BUYER_TYPE,
  SETTLEMENT_METHOD,
  type MoadianInvoiceInput,
} from './moadian.js';
import {
  enqueueOrder,
  claimDueBatch,
  markFailed,
  markSent,
  markAccepted,
  markRejected,
  retryNow,
  listQueue,
  queueStats,
} from './queue.js';
import {
  createInvoiceForOrder,
  sendDueBatch,
  inquirePending,
  retryStuck,
  readTaxSettings,
} from './submission.js';
import { createCreditNoteForReturn, rebuildUnsentCreditNote } from './credit.js';
import { sandboxClient } from './client.js';
import { vatReturn, periodKeyOf, currentJalaliMonth, productsMissingSstid, setProductSstid } from './vat.js';

/**
 * آزمون‌هایِ مالیات و سامانه‌یِ مؤدیان.
 *
 * چرا این آزمون‌ها از بقیه مهم‌ترند؟ چون خطا در اینجا دو هزینه دارد که هیچ‌کدام
 * با «بعداً درستش می‌کنیم» جبران نمی‌شود:
 *   • جریمه‌یِ مالیاتی: صورتحسابی که رد شود، انگار نبوده است.
 *   • عددِ غلط در اظهارنامه: مالیاتی که کمتر یا بیشتر اعلام شود، ممیزی می‌آورد.
 *
 * بنابراین اینجا فقط «کار می‌کند» کافی نیست؛ باید ثابت کند که حساب‌ها درست
 * جمع می‌شوند و صورتحسابِ ناقص هرگز از دروازه رد نمی‌شود.
 */

let db: Database;
let variantId: string;
let productId: string;

/** یک سفارشِ پرداخت‌شده با یک ردیف می‌سازد (مستقیم در پایگاه، چون موضوعِ آزمون مالیات است نه سفارش) */
async function paidOrder(opts: { unitPriceRial: bigint; quantity: number; vatRial: bigint; paidDaysAgo?: number }) {
  const { rows: o } = await db.query<{ id: string; order_no: string }>(
    `INSERT INTO orders (order_no, status, subtotal_rial, discount_rial, tax_rial,
                         shipping_rial, total_rial, created_at, paid_at, channel)
     VALUES ('ORD-TAX-' || floor(random()*1000000)::text, 'paid',
             $1::bigint, 0, $2::bigint, 0, $1::bigint + $2::bigint,
             now() - ($3::text || ' days')::interval, now() - ($3::text || ' days')::interval, 'web')
     RETURNING id, order_no`,
    [
      (opts.unitPriceRial * BigInt(opts.quantity)).toString(),
      opts.vatRial.toString(),
      String(opts.paidDaysAgo ?? 0),
    ],
  );
  const orderId = o[0]!.id;
  await db.query(
    `INSERT INTO order_items (order_id, variant_id, quantity, unit_price_rial,
                              discount_rial, tax_rial, total_rial)
     VALUES ($1, $2, $3::int, $4::bigint, 0, $5::bigint, $4::bigint * $3::int + $5::bigint)`,
    [
      orderId,
      variantId,
      opts.quantity,
      opts.unitPriceRial.toString(),
      opts.vatRial.toString(),
    ],
  );
  return { id: orderId, no: o[0]!.order_no };
}

/** یک شناسه‌یِ معتبر برایِ استفاده در نمونه‌ها */
const TAXID = buildTaxId({ fiscalId: 'AA56CD', issuedAt: new Date('2026-09-17T00:00:00Z'), serial: 1 });

beforeAll(async () => {
  db = createDatabase('memory://');
  await applyMigrations(db);
  await seedCatalog(db, { openingInventory: false });

  const { rows: v } = await db.query<{ id: string; product_id: string }>(
    `SELECT id, product_id FROM product_variants WHERE sku = 'CS-13P-BLK'`,
  );
  variantId = v[0]!.id;
  productId = v[0]!.product_id;

  // تنظیماتِ فروشنده: بدونِ آن‌ها هیچ صورتحسابی از اعتبارسنجی رد نمی‌شود
  await db.query(
    `INSERT INTO store_settings (key, value) VALUES
       ('moadian_enabled','true'),
       ('moadian_mode','sandbox'),
       ('moadian_fiscal_id','AA56CD'),
       ('store_national_id','1234567890'),
       ('store_postal_code','1435678912')
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
  );
  await db.query(`UPDATE products SET tax_sstid = '2720000114542', tax_unit = 'عدد' WHERE id = $1`, [
    productId,
  ]);
}, 180_000);

afterAll(async () => {
  await db.close();
});

// ─────────────────────────────────────────────────────────────────────────────

describe('شناسه و ساختارِ صورتحساب', () => {
  it('شناسه‌یِ منحصربه‌فردِ مالیاتی با فرمولِ سازمان ساخته می‌شود', () => {
    const fiscal = 'AA56CD'; // شناسه‌یِ حافظه‌یِ ۶ کاراکتری (رایج) → شناسه‌ی ۲۲ کاراکتری
    const at = new Date('2026-09-17T00:00:00Z');
    const a = buildTaxId({ fiscalId: fiscal, issuedAt: at, serial: 1 });
    const b = buildTaxId({ fiscalId: fiscal, issuedAt: at, serial: 2 });

    expect(a).toHaveLength(taxIdLength(fiscal));
    expect(taxIdLength(fiscal)).toBe(22);
    expect(a.startsWith(fiscal)).toBe(true);
    expect(a).not.toBe(b);
    // ساختار: شناسه (۶) + تاریخ (۵) + سریال (۱۰) + رقمِ کنترلی (۱)
    expect(a.slice(6, 11)).toBe(dateHex(at));
    expect(a.slice(11, 21)).toBe(serialHex(1));
  });

  it('هگزِ تاریخ و سریال همان قالبِ مستندات را دارد', () => {
    const at = new Date('2026-01-01T00:00:00Z');
    expect(dateHex(at)).toHaveLength(5);
    expect(dateHex(at).startsWith('0')).toBe(true);
    expect(dateHex(at)).not.toBe(dateHex(new Date('2026-01-02T00:00:00Z')));

    expect(serialHex(1)).toBe('0000000001');
    expect(serialHex(0x2f2b4e7)).toBe('0002F2B4E7');
    expect(serialHex(12345)).toHaveLength(10);
  });

  it('رقمِ کنترلیِ وِرهوف جابه‌جاییِ ارقام را می‌گیرد', () => {
    expect(verhoeffCheckDigit('12345')).toHaveLength(1);
    // ویژگیِ اصلیِ وِرهوف: جابه‌جاییِ دو رقم، رقمِ کنترلی را عوض می‌کند
    expect(verhoeffCheckDigit('12345')).not.toBe(verhoeffCheckDigit('12354'));
  });

  it('جمع‌هایِ سرآمد با فرمولِ سامانه هم‌خوان است (cap و tbill)', () => {
    const input: MoadianInvoiceInput = {
      taxid: TAXID,
      issuedAtMs: Date.now(),
      serial: '1',
      seller: { nationalId: '1234567890', fiscalId: 'AA56CD', postalCode: '1435678912' },
      buyer: { type: BUYER_TYPE.person, nationalId: null },
      lines: [
        {
          sstid: '2720000114542',
          title: 'قابِ آیفون',
          unit: 'عدد',
          quantity: 2,
          unitPriceRial: 1_000_000n,
          preDiscountRial: 2_000_000n,
          discountRial: 0n,
          afterDiscountRial: 2_000_000n,
          vatRate: 0.09,
          vatRial: 180_000n,
          totalRial: 2_180_000n,
        },
      ],
      payments: [{ referenceNo: 'X' }],
      settlement: SETTLEMENT_METHOD.cash,
    };
    const t = computeTotals(input);
    expect(t.tprdis).toBe(2_000_000n);
    expect(t.tvam).toBe(180_000n);
    expect(t.tbill).toBe(2_180_000n);
    // مانده‌یِ نقدی: کل منهایِ مالیات
    expect(t.cap).toBe(2_000_000n);
  });

  it('صورتحسابی که کالایش شناسه‌یِ کالا/خدمت ندارد، پیش از ارسال رد می‌شود', () => {
    const base = {
      taxid: TAXID,
      issuedAtMs: Date.now(),
      serial: '1',
      seller: { nationalId: '1234567890', fiscalId: 'AA56CD', postalCode: '1435678912' },
      buyer: { type: BUYER_TYPE.person as const, nationalId: null },
      payments: [{ referenceNo: 'X' }],
      settlement: SETTLEMENT_METHOD.cash as const,
    };
    const errors = validateInvoice({
      ...base,
      lines: [
        {
          sstid: '',
          title: 'کابلِ شارژ',
          unit: 'عدد',
          quantity: 1,
          unitPriceRial: 100_000n,
          preDiscountRial: 100_000n,
          discountRial: 0n,
          afterDiscountRial: 100_000n,
          vatRate: 0.09,
          vatRial: 9_000n,
          totalRial: 109_000n,
        },
      ],
    });
    expect(errors.some((e) => e.includes('شناسه‌یِ کالا'))).toBe(true);
  });

  it('خریدارِ حقوقیِ بی‌شناسه رد می‌شود اما خریدارِ حقیقی پذیرفته است', () => {
    const line = {
      sstid: '2720000114542',
      title: 'قاب',
      unit: 'عدد',
      quantity: 1,
      unitPriceRial: 100_000n,
      preDiscountRial: 100_000n,
      discountRial: 0n,
      afterDiscountRial: 100_000n,
      vatRate: 0.09,
      vatRial: 9_000n,
      totalRial: 109_000n,
    };
    const base = {
      taxid: TAXID,
      issuedAtMs: Date.now(),
      serial: '1',
      seller: { nationalId: '1234567890', fiscalId: 'AA56CD', postalCode: '1435678912' },
      payments: [] as Array<{ referenceNo?: string | null }>,
      settlement: SETTLEMENT_METHOD.cash as const,
      lines: [line],
    };
    expect(
      validateInvoice({ ...base, buyer: { type: BUYER_TYPE.company, nationalId: null } }),
    ).toContain('خریدار حقوقی است اما شناسه‌یِ ملی ندارد.');
    expect(validateInvoice({ ...base, buyer: { type: BUYER_TYPE.person, nationalId: null } })).toEqual(
      [],
    );
  });

  it('بسته‌یِ نهایی فیلدهایِ الزامی را دارد و هزینه‌یِ ارسال را به ردیف تبدیل می‌کند', () => {
    const packet = buildInvoicePacket({
      taxid: TAXID,
      issuedAtMs: 1_700_000_000_000,
      serial: '7',
      seller: { nationalId: '1234567890', fiscalId: 'AA56CD', postalCode: '1435678912' },
      buyer: { type: BUYER_TYPE.person, nationalId: '0012345678' },
      lines: [
        {
          sstid: '2720000114542',
          title: 'قاب',
          unit: 'عدد',
          quantity: 1,
          unitPriceRial: 100_000n,
          preDiscountRial: 100_000n,
          discountRial: 0n,
          afterDiscountRial: 100_000n,
          vatRate: 0.09,
          vatRial: 9_000n,
          totalRial: 109_000n,
        },
      ],
      payments: [{ referenceNo: 'ORD-1' }],
      settlement: SETTLEMENT_METHOD.cash,
      shippingRial: 50_000n,
    });
    expect(packet.header.taxid).toBe(TAXID);
    expect(packet.header.tins).toBe('1234567890');
    expect(packet.header.setm).toBe(SETTLEMENT_METHOD.cash);
    // هزینه‌یِ ارسال یک ردیفِ جدا شد
    expect(packet.body).toHaveLength(2);
    expect(packet.body[1]!.sstt).toBe('هزینه‌یِ ارسال');
    expect(packet.header.tbill).toBe(159_000); // ۱۰۹٬۰۰۰ + ۵۰٬۰۰۰
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('صفِ ارسال', () => {
  it('دوبار در صف گذاشتنِ یک سفارش، دو ردیف نمی‌سازد', async () => {
    const order = await paidOrder({ unitPriceRial: 300_000n, quantity: 1, vatRial: 27_000n });
    const a = await enqueueOrder(db, {
      orderId: order.id,
      orderNo: order.no,
      periodKey: '1405-06',
      taxid: 'X'.padEnd(22, '0'),
      payload: { header: {} },
    });
    const b = await enqueueOrder(db, {
      orderId: order.id,
      orderNo: order.no,
      periodKey: '1405-06',
      taxid: 'X'.padEnd(22, '0'),
      payload: { header: {} },
    });
    expect(a.alreadyQueued).toBe(false);
    expect(b.alreadyQueued).toBe(true);
    expect(b.id).toBe(a.id);
  });

  it('دسته‌یِ برداشته‌شده دوباره به کارگرِ دیگر داده نمی‌شود', async () => {
    const order = await paidOrder({ unitPriceRial: 400_000n, quantity: 1, vatRial: 36_000n });
    await enqueueOrder(db, {
      orderId: order.id,
      orderNo: order.no,
      periodKey: '1405-06',
      taxid: 'Y'.padEnd(22, '0'),
      payload: { header: {} },
    });
    const first = await claimDueBatch(db, 10);
    const ids = first.map((r) => r.id);
    const second = await claimDueBatch(db, 10);
    const secondIds = second.map((r) => r.id);
    expect(ids.some((id) => secondIds.includes(id))).toBe(false);
    expect(first.every((r) => r.status === 'sending')).toBe(true);
  });

  it('شکست، تلاشِ دوباره را به زمانِ آینده می‌سپارد تا سرور خفه نشود', async () => {
    const order = await paidOrder({ unitPriceRial: 500_000n, quantity: 1, vatRial: 45_000n });
    const { id } = await enqueueOrder(db, {
      orderId: order.id,
      orderNo: order.no,
      periodKey: '1405-06',
      taxid: 'Z'.padEnd(22, '0'),
      payload: { header: {} },
    });
    await markFailed(db, { id, errorCode: 'NETWORK', errorDetail: 'قطعی' });
    const { rows } = await db.query<{ status: string; next_attempt_at: string | null }>(
      `SELECT status, next_attempt_at::text FROM tax_invoices WHERE id = $1`,
      [id],
    );
    expect(rows[0]!.status).toBe('failed');
    expect(rows[0]!.next_attempt_at).toBeTruthy();
    // در فاصله‌یِ انتظار، نباید دوباره برداشته شود
    const claimed = await claimDueBatch(db, 50);
    expect(claimed.map((r) => r.id)).not.toContain(id);

    // اما تلاشِ دستی بی‌درنگ به صف برش می‌گرداند
    await retryNow(db, id);
    const after = await db.query<{ status: string }>(
      `SELECT status FROM tax_invoices WHERE id = $1`,
      [id],
    );
    expect(after.rows[0]!.status).toBe('queued');
  });

  it('ردشده با تلاشِ دستی به صف برمی‌گردد تا پس از اصلاح فرستاده شود', async () => {
    const order = await paidOrder({ unitPriceRial: 600_000n, quantity: 1, vatRial: 54_000n });
    const { id } = await enqueueOrder(db, {
      orderId: order.id,
      orderNo: order.no,
      periodKey: '1405-06',
      taxid: 'W'.padEnd(22, '0'),
      payload: { header: {} },
    });
    await markRejected(db, { id, errorCode: 'E01', errorDetail: 'نرخِ مالیات اشتباه است' });
    await expect(retryNow(db, id)).resolves.toBeUndefined(); // ردشده هم قابلِ بازگشت است
    const { rows } = await db.query<{ status: string }>(
      `SELECT status FROM tax_invoices WHERE id = $1`,
      [id],
    );
    expect(rows[0]!.status).toBe('queued');
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('گردشِ کامل تا تأیید', () => {
  it('سفارشِ پرداخت‌شده صورتحساب می‌سازد، فرستاده می‌شود و تأیید می‌گردد', async () => {
    const order = await paidOrder({ unitPriceRial: 2_000_000n, quantity: 1, vatRial: 180_000n });

    const created = await createInvoiceForOrder(db, order.id);
    expect(created.validationErrors).toEqual([]);
    expect(created.taxid).toHaveLength(22);
    expect(created.status).toBe('queued');

    // ساختِ دوباره همان صورتحساب است، نه یکی تازه
    const again = await createInvoiceForOrder(db, order.id);
    expect(again.id).toBe(created.id);

    const client = sandboxClient();
    const batch = await sendDueBatch(db, client, 10);
    expect(batch.sent).toBeGreaterThan(0);

    const inquiry = await inquirePending(db, client, 10);
    expect(inquiry.accepted).toBeGreaterThan(0);

    const { rows } = await db.query<{ status: string; uid: string | null }>(
      `SELECT status, uid FROM tax_invoices WHERE order_id = $1`,
      [order.id],
    );
    expect(rows[0]!.status).toBe('accepted');
    expect(rows[0]!.uid).toContain('sandbox-');
  });

  it('کالایِ بی‌شناسه، صورتحسابِ ردشده می‌سازد و هرگز ارسال نمی‌شود', async () => {
    // یک محصولِ تازه بدونِ شناسه‌یِ کالا
    const { rows: t } = await db.query<{ id: string }>(
      `SELECT id FROM product_types LIMIT 1`,
    );
    const { rows: p } = await db.query<{ id: string }>(
      `INSERT INTO products (type_id, title, slug, status)
       VALUES ($1, 'کالایِ بی‌شناسه', 'tax-no-sstid', 'active') RETURNING id`,
      [t[0]!.id],
    );
    const { rows: v } = await db.query<{ id: string }>(
      `INSERT INTO product_variants (product_id, sku, price_rial) VALUES ($1,'TAX-NO-SSTID',1000000) RETURNING id`,
      [p[0]!.id],
    );
    const { rows: o } = await db.query<{ id: string; order_no: string }>(
      `INSERT INTO orders (order_no, status, subtotal_rial, discount_rial, tax_rial,
                           shipping_rial, total_rial, created_at, paid_at, channel)
       VALUES ('ORD-NO-SSTID', 'paid', 1000000, 0, 90000, 0, 1090000, now(), now(), 'web')
       RETURNING id, order_no`,
    );
    await db.query(
      `INSERT INTO order_items (order_id, variant_id, quantity, unit_price_rial, discount_rial, tax_rial, total_rial)
       VALUES ($1, $2, 1, 1000000, 0, 90000, 1090000)`,
      [o[0]!.id, v[0]!.id],
    );

    const created = await createInvoiceForOrder(db, o[0]!.id);
    expect(created.validationErrors.length).toBeGreaterThan(0);
    expect(created.status).toBe('rejected');

    // در صف نمی‌ماند که مبادا ارسال شود
    const before = await queueStats(db);
    await sendDueBatch(db, sandboxClient(), 20);
    const after = await queueStats(db);
    expect(after.byStatus.sent).toBe(before.byStatus.sent);

    const listed = await listQueue(db, { status: 'rejected', limit: 5 });
    expect(listed.some((r) => r.orderId === o[0]!.id)).toBe(true);
  });

  it('ردیفِ گیرکرده در «در حالِ ارسال» خودبه‌خود به صف برمی‌گردد', async () => {
    const order = await paidOrder({ unitPriceRial: 500_000n, quantity: 1, vatRial: 45_000n });
    const created = await createInvoiceForOrder(db, order.id);
    await db.query(
      `UPDATE tax_invoices SET status = 'sending', sent_at = now() - interval '45 minutes' WHERE id = $1`,
      [created.id],
    );
    const freed = await retryStuck(db, 15);
    expect(freed).toBeGreaterThan(0);
    const { rows } = await db.query<{ status: string }>(
      `SELECT status FROM tax_invoices WHERE id = $1`,
      [created.id],
    );
    expect(rows[0]!.status).toBe('queued');
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('اظهارنامه‌یِ ارزش‌افزوده', () => {
  it('مرزهایِ ماهِ شمسی درست است (۱۴۰۵/۰۱/۰۱ برابر با ۲۱ مارس ۲۰۲۶)', () => {
    // نوروزِ ۱۴۰۵: ۲۱ مارس ۲۰۲۶ (یک روز جابه‌جایی پذیرفته است، چون لحظه‌یِ
    // تحویل بسته به سال متفاوت است)
    const period = currentJalaliMonth(new Date('2026-04-01T00:00:00Z'));
    expect(period.key).toBe('1405-01');
    const from = new Date(period.fromIso);
    expect(from.getUTCMonth()).toBe(2); // مارس
    expect([20, 21]).toContain(from.getUTCDate());
  });

  it('کلیدِ دوره از تاریخِ میلادی درست بیرون می‌آید', () => {
    expect(periodKeyOf(new Date('2026-09-17T00:00:00Z'))).toBe('1405-06');
  });

  it('مالیاتِ برون‌داد منهایِ درون‌داد، بدهیِ دوره است', async () => {
    // داده‌یِ این آزمون: دو فروشِ پرداخت‌شده و یک فاکتورِ خرید در ۳۰ روزِ اخیر
    const from = new Date(Date.now() - 30 * 86_400_000);
    const to = new Date(Date.now() + 86_400_000);
    const period = { fromIso: from.toISOString(), toIso: to.toISOString(), key: 'دوره' };

    const report = await vatReturn(db, period);
    expect(BigInt(report.output.vatRial)).toBeGreaterThan(0n);
    expect(report.output.orderCount).toBeGreaterThan(0);
    expect(report.input.invoiceCount).toBe(0); // در این پایگاه فاکتورِ خریدِ ثبت‌شده نداریم
    // بدهی = برون‌داد − درون‌داد
    expect(BigInt(report.netPayableRial)).toBe(
      BigInt(report.output.vatRial) - BigInt(report.input.vatRial),
    );
    // جمعِ گروه‌بندی‌شده برابر با کل است
    const sumByRate = report.output.byRate.reduce((a, r) => a + BigInt(r.vatRial), 0n);
    expect(sumByRate).toBe(BigInt(report.output.vatRial));
  });

  it('کالاهایِ بی‌شناسه فهرست می‌شوند و با ثبتِ شناسه از فهرست می‌روند', async () => {
    const before = await productsMissingSstid(db, 50);
    expect(before.some((p) => p.title === 'کالایِ بی‌شناسه')).toBe(true);

    const target = before.find((p) => p.title === 'کالایِ بی‌شناسه')!;
    await setProductSstid(db, { productId: target.productId, sstid: '2720000999999', unit: 'عدد' });

    const after = await productsMissingSstid(db, 50);
    expect(after.some((p) => p.productId === target.productId)).toBe(false);
  });

  it('تنظیماتِ مالیاتی از پایگاه خوانده می‌شود', async () => {
    const s = await readTaxSettings(db);
    expect(s.fiscalId).toBe('AA56CD');
    expect(s.mode).toBe('sandbox');
    expect(s.nationalId).toBe('1234567890');
  });
});

describe('بازسازیِ صورتحسابِ اصلاحیِ فرستاده‌نشده', () => {
  /**
   * یک « فروش + مرجوعیِ بازپرداخت‌شده » می‌سازد.
   *
   * چرا مستقیم در پایگاه و نه با بسته‌یِ مرجوعی؟ چون موضوعِ این آزمون مالیات
   * است، نه گردشِ کارِ مرجوعی (که خودش ۲۶ آزمون دارد). وابستگیِ تازه‌ای میانِ
   * بسته‌ها ساختن — آن هم فقط برایِ داده‌سازی — بهایش بیشتر از سودش است.
   */
  async function saleWithRefund(opts: { withSstid: boolean }) {
    if (opts.withSstid) {
      await db.query(`UPDATE products SET tax_sstid = '2720000114542', tax_unit = 'عدد' WHERE id = $1`, [productId]);
    } else {
      await db.query(`UPDATE products SET tax_sstid = NULL WHERE id = $1`, [productId]);
    }

    const order = await paidOrder({ unitPriceRial: 1_000_000n, quantity: 1, vatRial: 90_000n });
    const sale = await createInvoiceForOrder(db, order.id);
    expect(sale.taxid).toBeTruthy();

    const { rows: r } = await db.query<{ id: string }>(
      `INSERT INTO customer_returns (return_no, order_id, kind, status, reason, requested_at, refunded_at)
       VALUES ('MR-TAX-' || floor(random()*1000000)::text, $1, 'defective', 'refunded', 'معیوب', now(), now())
       RETURNING id`,
      [order.id],
    );
    const returnId = r[0]!.id;
    const { rows: oi } = await db.query<{ id: string }>(
      `SELECT id FROM order_items WHERE order_id = $1 LIMIT 1`,
      [order.id],
    );
    await db.query(
      `INSERT INTO customer_return_items (return_id, order_item_id, variant_id, quantity, condition,
                                          restock, refund_rial, refund_tax_rial)
       VALUES ($1, $2, $3, 1, 'defective', false, 1090000, 90000)`,
      [returnId, oi[0]!.id, variantId],
    );
    return { orderId: order.id, returnId, saleId: sale.id };
  }

  it('اصلاحیِ ردشده را پس از رفعِ علت، از نو و درست می‌سازد', async () => {
    const { orderId, returnId } = await saleWithRefund({ withSstid: false });

    // بارِ نخست: کالا شناسه ندارد → رد می‌شود
    const first = await createCreditNoteForReturn(db, { returnId, orderId });
    expect(first).not.toBeNull();
    expect(first!.validationErrors.length).toBeGreaterThan(0);

    const invoice = await db.query<{ id: string; uid: string | null; status: string }>(
      `SELECT id, uid, status FROM tax_invoices WHERE customer_return_id = $1`,
      [returnId],
    );
    const bad = invoice.rows[0]!;
    expect(bad.status).toBe('rejected');
    expect(bad.uid).toBeNull();

    // مدیر شناسه‌یِ کالا را ثبت می‌کند و «تلاشِ دوباره» می‌زند
    await db.query(`UPDATE products SET tax_sstid = '2720000114542', tax_unit = 'عدد' WHERE id = $1`, [productId]);
    const result = await rebuildUnsentCreditNote(db, bad.id);
    expect(result.rebuilt).toBe(true);
    if (!result.rebuilt) return;
    expect(result.validationErrors).toEqual([]);

    // ردیفِ کهنه حذف و ردیفِ تازه در صف است — و به صورتحسابِ اصلی ارجاع می‌دهد
    const after = await db.query<{ id: string; status: string; reference: string | null }>(
      `SELECT id, status, payload->'header'->>'irtaxid' AS reference
         FROM tax_invoices WHERE customer_return_id = $1`,
      [returnId],
    );
    expect(after.rows).toHaveLength(1);
    expect(after.rows[0]!.status).toBe('queued');
    expect(after.rows[0]!.reference).toBeTruthy();
  });

  it('صورتحسابی که به سامانه رسیده را هرگز از نو نمی‌سازد', async () => {
    const { orderId, returnId } = await saleWithRefund({ withSstid: true });
    const created = await createCreditNoteForReturn(db, { returnId, orderId });
    const id = created!.id;

    // وانمود می‌کنیم فرستاده شده است
    await db.query(`UPDATE tax_invoices SET status = 'sent', uid = 'UID-TEST-1' WHERE id = $1`, [id]);
    const result = await rebuildUnsentCreditNote(db, id);
    expect(result.rebuilt).toBe(false);

    const kept = await db.query<{ uid: string }>(`SELECT uid FROM tax_invoices WHERE id = $1`, [id]);
    expect(kept.rows[0]?.uid).toBe('UID-TEST-1');
  });

  it('صورتحسابِ فروش را بازسازی نمی‌کند (فقط اصلاحی)', async () => {
    const { saleId } = await saleWithRefund({ withSstid: true });
    const result = await rebuildUnsentCreditNote(db, saleId);
    expect(result.rebuilt).toBe(false);
  });
});
