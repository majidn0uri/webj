import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { createDatabase, applyMigrations, seedCatalog, type Database } from '@set/db';
import {
  checkCeiling,
  registerCheck,
  changeCheckStatus,
  listChecks,
  computePrice,
  resolvePrice,
  createShipment,
  setTariff,
  tariffFor,
  requestReturn,
  decideReturn,
  completeReturn,
  withinReturnWindow,
  nextDocumentNumber,
  findOrCreateCustomer,
  setPartnerStatus,
  isValidNationalId,
  getSetting,
  setSetting,
  enqueueSms,
  renderTemplate,
} from './index.js';

/**
 * این آزمون‌ها همان سناریوهایِ عددیِ بخش ۳ سند هستند — با همان ارقام.
 * اگر عددی در خروجی تغییر کند، یعنی پیاده‌سازی از سند منحرف شده است.
 */

let db: Database;
const createdCustomerIds: string[] = [];

const TOMAN = 10n; // هر تومان = ۱۰ ریال
const t = (toman: number) => BigInt(toman) * TOMAN;

beforeAll(async () => {
  db = await createDatabase(
    process.env.DB_URL ?? 'postgres://setshop@/setshop?host=/tmp/setshop-pgrun&port=5433',
  );
  await applyMigrations(db);
  await seedCatalog(db);
}, 120_000);

afterAll(async () => {
  // پاک‌سازیِ داده‌ی آزمونی — آزمون‌ها روی پایگاهِ توسعه اجرا می‌شوند و
  // نباید ردی از خود بگذارند (مگر آنچه خودِ سند می‌خواهد: تنظیمات و قالب‌ها)
  await db.query(`DELETE FROM checks WHERE drawer_id = ANY($1)`, [createdCustomerIds]);
  await db.query(`DELETE FROM customers WHERE id = ANY($1)`, [createdCustomerIds]);

  await db.query(
    `DELETE FROM stock_movements WHERE variant_id IN
       (SELECT id FROM product_variants WHERE product_id IN (SELECT id FROM products WHERE slug LIKE $1))`,
    [`%-${RUN}`],
  );
  await db.query(
    `DELETE FROM stock_items WHERE variant_id IN
       (SELECT id FROM product_variants WHERE product_id IN (SELECT id FROM products WHERE slug LIKE $1))`,
    [`%-${RUN}`],
  );
  await db.query(
    `DELETE FROM return_items WHERE variant_id IN
       (SELECT id FROM product_variants WHERE product_id IN (SELECT id FROM products WHERE slug LIKE $1))`,
    [`%-${RUN}`],
  );
  await db.query(
    `DELETE FROM order_items WHERE variant_id IN
       (SELECT id FROM product_variants WHERE product_id IN (SELECT id FROM products WHERE slug LIKE $1))`,
    [`%-${RUN}`],
  );
  await db.query(`DELETE FROM shipments WHERE shipment_no = $1`, [`MS-TEST-${RUN}`]);
  await db.query(`DELETE FROM orders WHERE order_no LIKE $1`, [`SO-TEST-${RUN}-%`]);
  await db.query(`DELETE FROM returns WHERE reason LIKE '%آزمون%'`);
  await db.query(`DELETE FROM products WHERE slug LIKE $1`, [`%-${RUN}`]);
  await db.close();
});

/** ردپایِ این اجرا — برای یکتا بودنِ نامک/کدها و پاک‌سازیِ پایانِ آزمون */
const RUN = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

/** رقمِ کنترلِ کد ملی: هر ۹ رقم را به یک کدِ معتبر تبدیل می‌کند */
function validNationalId(prefix9: string): string {
  const sum = prefix9.split('').reduce((acc, d, i) => acc + Number(d) * (10 - i), 0);
  const r = sum % 11;
  return prefix9 + (r < 2 ? r : 11 - r);
}

/** ساختِ کالا + تنوع + موجودی برای سناریوها */
async function makeProduct(opts: {
  title: string;
  slug: string;
  saleToman: number;
  partnerToman?: number;
  discountPercent?: number;
  maxDiscountPercent?: number;
  qty?: number;
}) {
  const { rows: type } = await db.query<{ id: string }>(
    `SELECT id FROM product_types LIMIT 1`,
  );
  const slug = `${opts.slug}-${RUN}`;
  const { rows: product } = await db.query<{ id: string }>(
    `INSERT INTO products (title, slug, type_id, status, reorder_point,
                           discount_percent, discount_starts_at, discount_ends_at, max_discount_percent)
     VALUES ($1,$2,$3,'active', 10, $4, now() - interval '1 day', now() + interval '10 day', $5)
     RETURNING id`,
    [opts.title, slug, type[0]!.id, opts.discountPercent ?? null, opts.maxDiscountPercent ?? 0],
  );
  const productId = product[0]!.id;

  const { rows: variant } = await db.query<{ id: string }>(
    `INSERT INTO product_variants (product_id, sku, price_rial, partner_price_rial, attributes, is_active)
     VALUES ($1,$2,$3,$4,$5::jsonb,true) RETURNING id`,
    [
      productId,
      `${slug}-BLK`,
      t(opts.saleToman).toString(),
      opts.partnerToman != null ? t(opts.partnerToman).toString() : null,
      JSON.stringify({ color: 'مشکی' }),
    ],
  );
  const variantId = variant[0]!.id;

  const { rows: wh } = await db.query<{ id: string }>(`SELECT id FROM warehouses LIMIT 1`);
  await db.query(
    `INSERT INTO stock_items (variant_id, warehouse_id, on_hand, reserved)
     VALUES ($1,$2,$3,0)
     ON CONFLICT (variant_id, warehouse_id)
     DO UPDATE SET on_hand = EXCLUDED.on_hand`,
    [variantId, wh[0]!.id, opts.qty ?? 100],
  );
  return { productId, variantId, warehouseId: wh[0]!.id };
}

let seq = 0;
async function makePartner(name: string, phone: string, ceilingToman = 0) {
  const nationalId = validNationalId(String(100000000 + (++seq)).slice(0, 9));
  const { customer } = await findOrCreateCustomer(db, {
    nationalId,
    phone: `${phone.slice(0, 10)}${(seq % 10)}`,
    fullName: name,
    kind: 'in_person',
  });
  const partner = await setPartnerStatus(db, {
    customerId: customer.id,
    isPartner: true,
    actorId: null,
    reason: 'تأییدِ مدیر برای آزمون',
    checkCeilingRial: t(ceilingToman),
  });
  createdCustomerIds.push(partner.id);
  return partner;
}

describe('شماره‌گذاری اسناد', () => {
  it('پیشوند + سالِ شمسی + شماره‌ی پیوسته می‌سازد و تکرار نمی‌شود', async () => {
    const a = await nextDocumentNumber(db, 'MR');
    const b = await nextDocumentNumber(db, 'MR');
    expect(a.prefix).toBe('MR');
    expect(a.code).toMatch(/^MR-\d{4}-\d{4}$/);
    expect(a.year).toBeGreaterThan(1400);
    expect(Number(b.code.split('-')[2])).toBe(a.number + 1);
  });
});

describe('مشتریان (BR-20 , BR-21 , BR-22)', () => {
  it('کد ملیِ نامعتبر را رد می‌کند (الگوریتمِ واقعی، نه فقط ۱۰ رقم)', () => {
    expect(isValidNationalId('0012345678')).toBe(false); // ۹ رقم
    expect(isValidNationalId('1111111111')).toBe(false); // تکراری
    expect(isValidNationalId(validNationalId('001234567'))).toBe(true); // الگوریتمِ واقعی
  });

  it('با کد ملیِ تکراری اکانتِ دوم نمی‌سازد (BR-20)', async () => {
    const nationalId = validNationalId(String(700000000 + Math.floor(Math.random() * 9999)));
    const first = await findOrCreateCustomer(db, {
      nationalId,
      phone: `0912000${String(Date.now()).slice(-4)}`,
      fullName: 'خانم احمدی',
      kind: 'in_person',
    });
    const second = await findOrCreateCustomer(db, {
      nationalId,
      phone: `0912777${String(Date.now()).slice(-4)}`,
      fullName: 'احمدی — ثبتِ اشتباهی',
      kind: 'online',
    });
    createdCustomerIds.push(first.customer.id);
    expect(second.created).toBe(false);
    expect(second.customer.id).toBe(first.customer.id);
    expect(second.nameMismatch).toBe(true); // باید به مدیر هشدار داده شود
  });
});

describe('قیمت‌گذاری (BR-01 .. BR-05)', () => {
  it('سناریوی ۲: مشتری عادی با تخفیفِ فعال — ۲×۱۴۹٬۰۰۰ + ۸۰٬۰۰۰ = ۳۷۸٬۰۰۰ تومان', async () => {
    const a = await makeProduct({
      title: 'قاب Arc (تست)',
      slug: 'test-case-arc',
      saleToman: 198_000,
      discountPercent: 25, // ۱۹۸٬۰۰۰ → ۱۴۸٬۵۰۰ ≈ ۱۴۹٬۰۰۰ در سند
      maxDiscountPercent: 5,
    });
    const b = await makeProduct({
      title: 'گلس نانو (تست)',
      slug: 'test-glass-nano',
      saleToman: 80_000,
      maxDiscountPercent: 5,
    });

    const pa = await resolvePrice(db, a.variantId, {});
    const pb = await resolvePrice(db, b.variantId, {});

    // هر واحدِ قاب پس از ۲۵٪ تخفیف
    expect(pa.unitRial).toBe((t(198_000) * 75n) / 100n);
    expect(pb.unitRial).toBe(t(80_000));

    const total = pa.unitRial * 2n + pb.unitRial;
    // سند می‌گوید ۳۷۸٬۰۰۰ تومان؛ با ۱۹۸٬۰۰۰ و ۲۵٪ دقیق، ۳۷۷٬۰۰۰ تومان است
    // (سند ۱۴۹٬۰۰۰ را گرد کرده). انحرافِ مجاز: کمتر از ۰٫۵٪
    const drift = Number((total - t(378_000)) * 10000n / t(378_000)) / 100;
    expect(Math.abs(drift)).toBeLessThan(0.5);
  });

  it('سناریوی ۳: همکار قیمت همکاری می‌بیند و تخفیف روی آن اعمال نمی‌شود (BR-01 , BR-04)', async () => {
    const p = await makeProduct({
      title: 'قاب Arc همکاری (تست)',
      slug: 'test-case-arc-partner',
      saleToman: 149_000,
      partnerToman: 125_000,
      discountPercent: 25,
      maxDiscountPercent: 5,
    });

    const normal = await resolvePrice(db, p.variantId, {});
    const partner = await resolvePrice(db, p.variantId, {
      customer: { id: 'x', isPartner: true },
    });

    expect(normal.partnerPriceUsed).toBe(false);
    expect(partner.partnerPriceUsed).toBe(true);
    expect(partner.baseRial).toBe(t(125_000));
    // BR-04: تخفیفِ خرده‌فروشی روی قیمت همکاری اعمال نشد
    expect(partner.discountRial).toBe(0n);
    expect(partner.unitRial).toBe(t(125_000));
    expect(normal.unitRial).toBeLessThan(normal.baseRial); // عادی تخفیف گرفت
  });

  it('BR-02: کالای بدون قیمت همکاری → همکار قیمت فروش را می‌بیند', async () => {
    const p = await makeProduct({
      title: 'کابل (تست)',
      slug: 'test-cable-nopartner',
      saleToman: 120_000,
    });
    const partner = await resolvePrice(db, p.variantId, {
      customer: { id: 'x', isPartner: true },
    });
    expect(partner.partnerPriceUsed).toBe(false);
    expect(partner.unitRial).toBe(t(120_000));
  });

  it('BR-05: تخفیفِ دستیِ بیش از سقف بدون تأیید مدیر رد می‌شود', async () => {
    const p = await makeProduct({
      title: 'قاب سقف‌دار (تست)',
      slug: 'test-case-cap',
      saleToman: 100_000,
      maxDiscountPercent: 5,
    });
    await expect(
      resolvePrice(db, p.variantId, { manualDiscountPercent: 10 }),
    ).rejects.toMatchObject({ key: 'FORBIDDEN' });

    const approved = await resolvePrice(db, p.variantId, {
      manualDiscountPercent: 10,
      managerApproved: true,
    });
    expect(approved.manualRial).toBe(t(10_000));
    expect(approved.unitRial).toBe(t(90_000));
  });
});

describe('چک (BR-33 , BR-35 , BR-36 , BR-37)', () => {
  it('سناریوی ۳: ثبتِ چک ۳٬۰۰۰٬۰۰۰ با سقفِ ۵٬۰۰۰٬۰۰۰ مجاز است', async () => {
    const partner = await makePartner('آرین موبایل', '0912333000', 5_000_000);
    const before = await checkCeiling(db, partner.id);
    expect(before.ceilingRial).toBe(t(5_000_000));
    expect(before.openRial).toBe(0n);

    const check = await registerCheck(db, {
      checkNo: `1234${RUN.slice(-2)}`,
      sayadNo: `789${RUN.slice(-3)}`,
      bank: 'ملت',
      amountRial: t(3_000_000),
      dueDate: new Date('2026-10-23'),
      drawerId: partner.id,
      documentType: 'FS',
    });
    expect(check.status).toBe('in_circulation');

    const after = await checkCeiling(db, partner.id);
    expect(after.openRial).toBe(t(3_000_000));
    expect(after.remainingRial).toBe(t(2_000_000));
  });

  it('سناریوی ۵: عبور از سقف متوقف می‌شود (BR-36)', async () => {
    const partner = await makePartner('همکارِ سقف‌پر', '0912333010', 5_000_000);

    // گامِ نخست: چکِ ۳ میلیون در سقفِ ۵ میلیون مجاز است
    await registerCheck(db, {
      checkNo: `2000${RUN.slice(-2)}`,
      sayadNo: `700${RUN.slice(-3)}`,
      bank: 'ملت',
      amountRial: t(3_000_000),
      dueDate: new Date('2026-11-01'),
      drawerId: partner.id,
      documentType: 'FS',
    });

    // گامِ دوم: ۲٫۵ میلیونِ دیگر از ۲ میلیونِ باقی‌مانده بیشتر است → توقف
    const ceiling = await checkCeiling(db, partner.id, t(2_500_000));
    expect(ceiling.openRial).toBe(t(3_000_000));
    expect(ceiling.remainingRial).toBe(t(2_000_000));
    expect(ceiling.allowed).toBe(false);
    expect(ceiling.reason).toContain('بیشتر است');

    await expect(
      registerCheck(db, {
        checkNo: `2001${RUN.slice(-2)}`,
        sayadNo: `701${RUN.slice(-3)}`,
        bank: 'ملت',
        amountRial: t(2_500_000),
        dueDate: new Date('2026-11-02'),
        drawerId: partner.id,
      }),
    ).rejects.toMatchObject({ key: 'CONFLICT' });

    // مبلغی که در سقف می‌گنجد، هنوز مجاز است
    const ok = await checkCeiling(db, partner.id, t(1_500_000));
    expect(ok.allowed).toBe(true);
  });

  it('چکِ بزرگ‌تر از کلِ سقف همان ابتدا رد می‌شود', async () => {
    const partner = await makePartner('همکارِ بزرگ‌چک', '0912333050', 5_000_000);
    // سندِ سناریوی ۵: تقاضایِ چکِ ۸٬۰۰۰٬۰۰۰ با سقفِ ۵٬۰۰۰٬۰۰۰ → توقفِ همان‌لحظه
    const ceiling = await checkCeiling(db, partner.id, t(8_000_000));
    expect(ceiling.allowed).toBe(false);
    await expect(
      registerCheck(db, {
        checkNo: `2002${RUN.slice(-2)}`,
        sayadNo: `702${RUN.slice(-3)}`,
        bank: 'ملت',
        amountRial: t(8_000_000),
        dueDate: new Date('2026-11-03'),
        drawerId: partner.id,
      }),
    ).rejects.toMatchObject({ key: 'CONFLICT' });
  });

  it('سناریوی ۷: با برگشتِ چک، سقفِ همکار صفر می‌شود (BR-37)', async () => {
    const partner = await makePartner('همکارِ برگشتی', '0912333020', 5_000_000);
    const check = await registerCheck(db, {
      checkNo: `3000${RUN.slice(-2)}`,
      sayadNo: `800${RUN.slice(-3)}`,
      bank: 'صادرات',
      amountRial: t(1_000_000),
      dueDate: new Date('2026-10-01'),
      drawerId: partner.id,
    });
    await changeCheckStatus(db, { checkId: check.id, toStatus: 'bounced', reason: 'کسری موجودی' });

    const ceiling = await checkCeiling(db, partner.id, t(100_000));
    expect(ceiling.allowed).toBe(false);
    expect(ceiling.reason).toContain('برگشتی');
  });

  it('BR-33: مشتری عادی اصلاً نمی‌تواند چک بدهد', async () => {
    const { customer } = await findOrCreateCustomer(db, {
      nationalId: validNationalId('550000000'),
      phone: `0912555${String(Date.now()).slice(-4)}`,
      fullName: 'مشتری عادی',
    });
    createdCustomerIds.push(customer.id);
    const ceiling = await checkCeiling(db, customer.id, t(100_000));
    expect(ceiling.allowed).toBe(false);
    expect(ceiling.reason).toContain('همکار');
  });

  it('چکِ خرج‌شده (تهاتر) به وضعیت transferred می‌رود و وضعیت‌هایِ نامعتبر رد می‌شوند', async () => {
    const partner = await makePartner('همکارِ تهاتر', '0912333040', 9_000_000);
    const check = await registerCheck(db, {
      checkNo: `4000${RUN.slice(-2)}`,
      sayadNo: `900${RUN.slice(-3)}`,
      bank: 'ملت',
      amountRial: t(2_000_000),
      dueDate: new Date('2026-12-01'),
      drawerId: partner.id,
    });
    await changeCheckStatus(db, { checkId: check.id, toStatus: 'transferred', reason: 'واگذاری به فروشنده' });
    const list = await listChecks(db, { drawerId: partner.id });
    expect(list.find((c) => c.id === check.id)?.status).toBe('transferred');

    // وصول‌شده دیگر قابل تغییر نیست
    await changeCheckStatus(db, { checkId: check.id, toStatus: 'settled', reason: 'وصول' });
    await expect(
      changeCheckStatus(db, { checkId: check.id, toStatus: 'bounced' }),
    ).rejects.toMatchObject({ key: 'CONFLICT' });
  });
});

describe('ارسال (BR-42 , BR-43)', () => {
  it('تعرفه بر اساسِ شهر × روش است (BR-43)', async () => {
    await setTariff(db, {
      methodKey: 'post',
      methodLabel: 'پست پیشتاز',
      city: 'تهران',
      costRial: t(45_000),
      etaDays: 3,
    });
    const tehran = await tariffFor(db, 'post', 'تهران');
    const shiraz = await tariffFor(db, 'post', 'شیراز');
    expect(tehran?.costRial).toBe(t(45_000));
    expect(shiraz).toBeNull();
  });

  it('ارسال پیش از ثبتِ بسته‌بندی پذیرفته نمی‌شود', async () => {
    const { rows: order } = await db.query<{ id: string }>(
      `INSERT INTO orders (order_no, channel, status, subtotal_rial, total_rial)
       VALUES ($2,'web','confirmed', $1, $1) RETURNING id`,
      [t(100_000).toString(), `SO-TEST-${RUN}-PACK`],
    );
    await expect(
      createShipment(db, { orderId: order[0]!.id, carrier: 'پست', trackingCode: '2456897531' }),
    ).rejects.toMatchObject({ key: 'CONFLICT' });

    // پس از ثبتِ بسته‌بندی، همان ارسال پذیرفته می‌شود
    await db.query(`UPDATE orders SET status = 'packing' WHERE id = $1`, [order[0]!.id]);
    await expect(
      createShipment(db, { orderId: order[0]!.id, carrier: 'پست', trackingCode: '2456897531' }),
    ).resolves.toBeTruthy();
  });

  it('BR-42: ارسال بدون کد رهگیری ثبت نمی‌شود', async () => {
    const p = await makeProduct({ title: 'کالای ارسالی', slug: 'test-ship-item', saleToman: 100_000 });
    const { rows: order } = await db.query<{ id: string }>(
      `INSERT INTO orders (order_no, channel, status, subtotal_rial, total_rial)
       VALUES ($2,'web','packing', $1, $1) RETURNING id`,
      [t(100_000).toString(), `SO-TEST-${RUN}-1`],
    );
    await db.query(
      `INSERT INTO order_items (order_id, variant_id, quantity, unit_price_rial, total_rial)
       VALUES ($1,$2,1,$3,$3)`,
      [order[0]!.id, p.variantId, t(100_000).toString()],
    );

    await expect(
      createShipment(db, { orderId: order[0]!.id, carrier: 'پست', trackingCode: '  ' }),
    ).rejects.toMatchObject({ key: 'VALIDATION' });

    const shipment = await createShipment(db, {
      orderId: order[0]!.id,
      carrier: 'پست',
      trackingCode: '2456897531',
      costRial: t(45_000),
    });
    expect(shipment.tracking_code).toBe('2456897531');
    expect(shipment.shipment_no).toMatch(/^MS-\d{4}-\d{4}$/);

    const { rows } = await db.query<{ status: string }>(
      `SELECT status FROM orders WHERE id = $1`,
      [order[0]!.id],
    );
    expect(rows[0]?.status).toBe('shipped');
  });
});

describe('مرجوعی (BR-44 , BR-45 , BR-46 , BR-47)', () => {
  it('سناریوی ۶: مرجوعیِ یک قلم — موجودی برمی‌گردد و سند صادر می‌شود', async () => {
    const p = await makeProduct({
      title: 'قاب مرجوعی',
      slug: 'test-return-case',
      saleToman: 149_000,
      qty: 13,
    });
    const { rows: order } = await db.query<{ id: string }>(
      `INSERT INTO orders (order_no, channel, status, subtotal_rial, total_rial)
       VALUES ($2,'web','delivered', $1, $1) RETURNING id`,
      [t(149_000).toString(), `SO-TEST-${RUN}-2`],
    );
    const orderId = order[0]!.id;
    await db.query(
      `INSERT INTO order_items (order_id, variant_id, quantity, unit_price_rial, total_rial)
       VALUES ($1,$2,1,$3,$3)`,
      [orderId, p.variantId, t(149_000).toString()],
    );
    await db.query(
      `INSERT INTO shipments (shipment_no, order_id, carrier, tracking_code, status, delivered_at)
       VALUES ($2,$1,'پست','111222333','delivered', now())`,
      [orderId, `MS-TEST-${RUN}`],
    );

    const before = await db.query<{ on_hand: string }>(
      `SELECT on_hand::text FROM stock_items WHERE variant_id = $1`,
      [p.variantId],
    );

    const window = await withinReturnWindow(db, 'SO', orderId);
    expect(window.ok).toBe(true);
    expect(window.days).toBe(7);

    const record = await requestReturn(db, {
      sourceType: 'SO',
      sourceId: orderId,
      items: [{ variantId: p.variantId, quantity: 1, unitPriceRial: t(149_000) }],
      reason: 'رنگ مناسب نبود (آزمون)',
    });
    expect(record.status).toBe('requested');
    expect(BigInt(record.total_rial)).toBe(t(149_000));

    await decideReturn(db, {
      returnId: record.id,
      approve: true,
      decisionNote: 'کالا بازنشده و سالم است',
      decidedBy: (await db.query<{ id: string }>(`SELECT id FROM users LIMIT 1`)).rows[0]?.id ?? null,
      fates: [{ variantId: p.variantId, fate: 'to_stock', condition: 'ok' }],
    });

    const result = await completeReturn(db, {
      returnId: record.id,
      refundMethod: 'credit',
      actorId: (await db.query<{ id: string }>(`SELECT id FROM users LIMIT 1`)).rows[0]?.id ?? null,
      warehouseId: p.warehouseId,
    });

    const after = await db.query<{ on_hand: string }>(
      `SELECT on_hand::text FROM stock_items WHERE variant_id = $1`,
      [p.variantId],
    );
    expect(Number(after.rows[0]!.on_hand)).toBe(Number(before.rows[0]!.on_hand) + 1);
    expect(result.returnedRial).toBe(t(149_000));
  });
});

describe('تنظیمات و پیامک (بخش‌های ۶ و ۱۱)', () => {
  it('پیش‌فرض‌های بخش ۱۱ نشانده شده‌اند و تغییر در لاگ می‌ماند', async () => {
    expect(await getSetting(db, 'return_window_days')).toBe('7');
    expect(await getSetting(db, 'reserve_minutes')).toBe('15');
    expect(await getSetting(db, 'payment_expiry_hours')).toBe('24');
    expect(await getSetting(db, 'default_check_ceiling')).toBe('0');
    expect(await getSetting(db, 'sell_without_account')).toBe('false');

    await setSetting(db, 'return_window_days', '14', null);
    expect(await getSetting(db, 'return_window_days')).toBe('14');
    // بازگشت به پیش‌فرض — آزمون باید وضعیتِ پایگاه را تغییرِ ماندگار ندهد
    await setSetting(db, 'return_window_days', '7', null);
    expect(await getSetting(db, 'return_window_days')).toBe('7');

    const { rows } = await db.query<{ action: string }>(
      `SELECT action FROM audit_logs WHERE entity = 'store_settings' LIMIT 1`,
    );
    expect(rows[0]?.action).toBe('setting.changed');
  });

  it('متنِ پیامک‌ها با متغیرها پر می‌شود و مبلغ به تومان است', async () => {
    const body = await renderTemplate(db, 'order_paid', {
      order: 'SO-1405-0231',
      amount: '۴۱۸٬۰۰۰',
    });
    expect(body).toContain('SO-1405-0231');
    expect(body).toContain('۴۱۸٬۰۰۰');
    expect(body).toContain('تومان');

    const queued = await enqueueSms(db, {
      phone: '09120000000',
      templateKey: 'order_confirmed',
      vars: { order: 'SO-1405-0231' },
    });
    expect(queued.body).toContain('تأیید شد');
  });
});

describe('محاسبه‌ی خالصِ قیمت (بدون پایگاه)', () => {
  const row = {
    id: 'v1',
    price_rial: '1490000',
    partner_price_rial: '1250000',
    discount_percent: '25',
    discount_amount_rial: null,
    discount_starts_at: null,
    discount_ends_at: null,
    discount_on_partner: false,
    max_discount_percent: 5,
    partner_price_percent: null,
  };

  it('مهمان و عادی قیمت فروش، همکار قیمت همکاری', () => {
    const guest = computePrice(row, {}, new Date(), false);
    const partner = computePrice(
      row,
      { customer: { id: 'c', isPartner: true } },
      new Date(),
      false,
    );
    expect(guest.unitRial).toBe(1_117_500n); // ۱٬۴۹۰٬۰۰۰ با ۲۵٪ تخفیف
    expect(partner.unitRial).toBe(1_250_000n); // بدون تخفیف (BR-04)
  });

  it('BR-03: پس از پایانِ بازه، تخفیف اعمال نمی‌شود', () => {
    const expired = {
      ...row,
      discount_starts_at: new Date('2020-01-01'),
      discount_ends_at: new Date('2020-02-01'),
    };
    const p = computePrice(expired, {}, new Date(), false);
    expect(p.discountWindowActive).toBe(false);
    expect(p.unitRial).toBe(1_490_000n);
  });
});
