/**
 * بذرِ فروشِ نمونه — داده‌ای برای این‌که گزارش‌هایِ مدیریتی عدد نشان دهند.
 *
 * چرا این اسکریپت وجود دارد؟ چون سه گزارشِ مدیریتی روی «فروشِ واقعی» حساب
 * می‌شوند و یک فروشگاهِ تازه‌ساخته فروشی ندارد؛ صفحه‌یِ گزارش‌ها درست کار
 * می‌کند اما خالی است، و مدیری که صفحه‌یِ خالی می‌بیند نمی‌فهمد «خالی» یعنی
 * «فروشی نبوده» یا «گزارش خراب است». این اسکریپت همان مسیری را می‌سازد که
 * فروشِ واقعی می‌سازد — از خودِ OrderService — نه با درجِ مستقیم در جدول؛
 * تا رزرو، موجودی، سندِ حسابداری و بهایِ تمام‌شده همگی همان‌طور ثبت شوند که
 * در تولید ثبت می‌شوند.
 *
 * اجرا:
 *   DB_URL="postgres://…" npx tsx scripts/seed-demo-sales.ts
 *   DB_URL="postgres://…" npx tsx scripts/seed-demo-sales.ts --reset   (پاک کردنِ داده‌ی نمونه)
 *
 * نکته: تاریخِ سفارش‌ها به عقب برده می‌شود (تا نمودارِ روزانه معنا بگیرد)؛
 * سندِ حسابداریِ همان سفارش هم به همان اندازه عقب برده می‌شود تا «دفترکل با
 * ردیف‌های فروش هم‌خوان است» همچنان درست بماند.
 */

import { createDatabase, type Database } from '@set/db';
import { OrderService } from '@set/orders';
import { AccountingService } from '@set/accounting';
import { formatJalali } from '@set/shared-kernel';

const DB_URL = process.env.DB_URL ?? 'postgres://setshop@/setshop?host=/tmp/setshop-pgrun&port=5433';
const RESET = process.argv.includes('--reset');

/** مشتریانِ نمونه؛ شماره‌ها ساختگی‌اند (پیش‌شماره‌ی ۰۹۱۲ + ارقامِ تکراری) */
const CUSTOMERS = [
  { phone: '09120000011', name: 'سارا احمدی' },
  { phone: '09120000012', name: 'رضا کریمی' },
  { phone: '09120000013', name: 'مریم حسینی' },
  { phone: '09120000014', name: 'علی محمدی' },
  { phone: '09120000015', name: 'فاطمه رضایی' },
  { phone: '09120000016', name: 'کاوه بهرامی' },
];

/** وزنِ فروش: کابل و قاب پرفروش‌ترند، پاوربانک کمتر (سناریویِ واقعی) */
const WEIGHTS: Record<string, number> = {
  'CB-LT-1M': 5,
  'CS-13P-BLK': 4,
  'GL-13-SFT': 3,
  'CH-20W': 2,
  'PB-20K': 1,
};

interface Variant {
  id: string;
  sku: string;
  price_rial: string;
  available: number;
}

async function pickVariants(db: Database): Promise<Variant[]> {
  const { rows } = await db.query<Variant>(
    `SELECT pv.id, pv.sku, pv.price_rial::text,
            COALESCE(MIN(si.on_hand - si.reserved), 0)::int AS available
       FROM product_variants pv
       JOIN products p ON p.id = pv.product_id
       LEFT JOIN stock_items si ON si.variant_id = pv.id
      WHERE pv.is_active = true AND p.status = 'active'
      GROUP BY pv.id, pv.sku, pv.price_rial
      HAVING COALESCE(MIN(si.on_hand - si.reserved), 0) > 0
      ORDER BY pv.sku`,
  );
  return rows;
}

function weightedPick(pool: Variant[]): Variant {
  const entries = pool.flatMap((v) => Array.from({ length: WEIGHTS[v.sku] ?? 1 }, () => v));
  return entries[Math.floor(Math.random() * entries.length)]!;
}

async function ensureCustomers(db: Database): Promise<Map<string, string>> {
  const ids = new Map<string, string>();
  for (const c of CUSTOMERS) {
    const { rows } = await db.query<{ id: string }>(
      `INSERT INTO customers (phone, full_name, kind)
       VALUES ($1, $2, 'online')
       ON CONFLICT (phone) DO UPDATE SET full_name = EXCLUDED.full_name
       RETURNING id`,
      [c.phone, c.name],
    );
    ids.set(c.phone, rows[0]!.id);
  }
  return ids;
}

async function reset(db: Database): Promise<void> {
  // داده‌ی نمونه با یک نشان می‌خورند: کلیدِ توان‌دهی seed-demo
  await db.query(`DELETE FROM order_payment_lines WHERE order_id IN (
    SELECT id FROM orders WHERE idempotency_key LIKE 'seed-demo-%')`);
  await db.query(`DELETE FROM checks WHERE sayad_no LIKE '9000%'`);
  await db.query(`DELETE FROM journal_lines WHERE entry_id IN (
    SELECT id FROM journal_entries WHERE reference_id::text IN (
      SELECT id::text FROM orders WHERE idempotency_key LIKE 'seed-demo-%'))`);
  await db.query(`DELETE FROM journal_entries WHERE reference_id::text IN (
    SELECT id::text FROM orders WHERE idempotency_key LIKE 'seed-demo-%')`);
  await db.query(`DELETE FROM order_items WHERE order_id IN (
    SELECT id FROM orders WHERE idempotency_key LIKE 'seed-demo-%')`);
  await db.query(`DELETE FROM payments WHERE order_id IN (
    SELECT id FROM orders WHERE idempotency_key LIKE 'seed-demo-%')`);
  await db.query(`DELETE FROM stock_movements WHERE reference_type = 'order' AND reference_id::text IN (
    SELECT id::text FROM orders WHERE idempotency_key LIKE 'seed-demo-%')`);
  await db.query(`DELETE FROM orders WHERE idempotency_key LIKE 'seed-demo-%'`);
  await db.query(`DELETE FROM report_cache`);
  console.log('داده‌یِ فروشِ نمونه پاک شد (سفارش‌ها، اسناد، چک‌ها، میانگیر).');
}

async function main(): Promise<void> {
  const db = createDatabase(DB_URL);
  const orders = new OrderService(db);
  const accounting = new AccountingService(db);

  if (RESET) {
    await reset(db);
    await db.close();
    return;
  }

  const variants = await pickVariants(db);
  if (variants.length === 0) {
    console.log('هیچ تنوعِ موجودی برای فروش نیست؛ نخست کاتالوگ را بسازید.');
    await db.close();
    return;
  }

  await ensureCustomers(db);

  // یک خریدِ تازه تا بهایِ میانگینِ موزون در دوره کمی تغییر کند (واقع‌گرایی)
  const top = variants[0]!;
  await accounting.postPurchaseInvoice({
    supplierName: 'تأمین‌کننده‌ی نمونه',
    warehouseId: (
      await db.query<{ id: string }>(`SELECT id FROM warehouses ORDER BY id LIMIT 1`)
    ).rows[0]!.id,
    items: [{ variantId: top.id, quantity: 20, unitCostRial: 500_000n }],
  });

  let created = 0;
  let revenue = 0n;
  const orderIds: Array<{ id: string; daysAgo: number; total: bigint; mobile: string }> = [];

  // ۲۴ سفارش در ۷۵ روزِ گذشته: هر سه روز یک فروش
  for (let i = 0; i < 24; i += 1) {
    const daysAgo = 75 - i * 3;
    if (daysAgo < 0) continue;
    const variant = weightedPick(variants);
    const quantity = Math.random() < 0.25 ? 2 : 1;
    const customer = CUSTOMERS[Math.floor(Math.random() * CUSTOMERS.length)]!;

    try {
      const order = await orders.createOrder({
        channel: Math.random() < 0.3 ? 'pos' : 'web',
        items: [{ variantId: variant.id, quantity }],
        customerName: customer.name,
        customerMobile: customer.phone,
        shippingAddress: { city: 'تهران', address: 'خیابانِ آزادی، پلاک ۱۲۳' },
        idempotencyKey: `seed-demo-${i}`,
      });
      await orders.confirmPayment(order.orderId, { amountRial: BigInt(order.totals.totalRial) });

      // عقب بردنِ تاریخِ سفارش و سندش (با هم، تا تراز به هم نخورد)
      await db.query(
        `UPDATE orders
            SET created_at = now() - ($2 || ' days')::interval,
                paid_at   = now() - ($2 || ' days')::interval
          WHERE id = $1`,
        [order.orderId, String(daysAgo)],
      );
      await db.query(
        `UPDATE journal_entries
            SET posted_at = now() - ($2 || ' days')::interval
          WHERE reference_type = 'order' AND reference_id = $1`,
        [order.orderId, String(daysAgo)],
      );

      created += 1;
      revenue += BigInt(order.totals.totalRial);
      orderIds.push({
        id: order.orderId,
        daysAgo,
        total: BigInt(order.totals.totalRial),
        mobile: customer.phone,
      });
    } catch (err) {
      // کمبودِ موجودی در میانه‌یِ راه طبیعی است؛ رد می‌شویم و ادامه می‌دهیم
      if (err instanceof Error && /OUT_OF_STOCK|INVARIANT/.test(err.message)) continue;
      console.error(`خطا در سفارشِ ${i}:`, err instanceof Error ? err.message : err);
    }
  }

  // --- طلب‌ها: سه چک و دو نسیه، رویِ آخرین سفارش‌هایِ مشتریان
  const { rows: custRows } = await db.query<{ id: string; phone: string }>(
    `SELECT id, phone FROM customers WHERE phone = ANY($1::text[])`,
    [CUSTOMERS.map((c) => c.phone)],
  );
  const custByPhone = new Map(custRows.map((c) => [c.phone, c.id]));

  const debtPlan: Array<{ daysAgo: number; status: string; phone: string; kind: 'check' | 'credit' }> = [
    { daysAgo: 12, status: 'in_circulation', phone: '09120000011', kind: 'check' }, // ۱–۳۰ روز
    { daysAgo: 45, status: 'in_circulation', phone: '09120000012', kind: 'check' }, // ۳۱–۶۰ روز
    { daysAgo: 105, status: 'bounced', phone: '09120000013', kind: 'check' }, // بالای ۹۰ + برگشتی
    { daysAgo: 40, status: 'credit', phone: '09120000014', kind: 'credit' },
    { daysAgo: 70, status: 'credit', phone: '09120000015', kind: 'credit' },
  ];

  let debts = 0;
  for (const [index, plan] of debtPlan.entries()) {
    const order = orderIds.find((o) => o.mobile === plan.phone) ?? orderIds[index];
    if (!order) continue;
    const amount = order.total;

    if (plan.kind === 'check') {
      const { rows: chk } = await db.query<{ id: string }>(
        `INSERT INTO checks (check_no, sayad_no, bank, amount_rial, due_date, drawer_id, status, document_type, document_id)
         VALUES ($1, $2, 'ملی', $3, (now() - ($4 || ' days')::interval)::date, $5, $6, 'FS', $7)
         RETURNING id`,
        [
          `۹۰۰۰${index + 1}`,
          `900000000000000${index + 1}`,
          amount.toString(),
          String(plan.daysAgo),
          custByPhone.get(plan.phone) ?? null,
          plan.status,
          order.id,
        ],
      );
      await db.query(
        `INSERT INTO order_payment_lines (order_id, method, amount_rial, check_id)
         VALUES ($1, 'check', $2, $3)`,
        [order.id, amount.toString(), chk[0]!.id],
      );
    } else {
      await db.query(
        `INSERT INTO order_payment_lines (order_id, method, amount_rial)
         VALUES ($1, 'credit', $2)`,
        [order.id, amount.toString()],
      );
    }
    debts += 1;
  }

  // میانگیرِ گزارش‌ها را خالی می‌کنیم تا عددِ تازه دیده شود
  await db.query(`DELETE FROM report_cache`);

  console.log('—————————————————————————');
  console.log(`سفارشِ نمونه:        ${created}`);
  console.log(`جمعِ فروش:           ${(revenue / 10n).toLocaleString('fa-IR')} تومان`);
  console.log(`چک و نسیه:           ${debts}`);
  console.log(`بازه‌یِ زمانی:        ${75} روز پیش تا امروز (${formatJalali(new Date())})`);
  console.log('—————————————————————————');
  console.log('اکنون «گزارش‌ها» را در پنل ببینید: /admin/reports');

  await db.close();
}

main().catch((err) => {
  console.error('اجرا نشد:', err instanceof Error ? err.message : err);
  process.exit(1);
});
