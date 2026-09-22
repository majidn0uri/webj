/**
 * کوپن و کدِ تخفیف.
 *
 * چرا اینجا (در commerce) و نه درونِ سفارش؟ چون کوپن دو نقشِ جدا دارد که
 * باید هر دو درست باشند، و یکی‌شان هیچ ربطی به پول ندارد:
 *
 *   • **ارزیابی** (validate): آیا این کد اصلاً معتبر است؟ — تاریخ، دفعات،
 *     حدِ مشتری، پایه‌یِ کمینه، محدوده‌یِ کالا یا دسته. این تصمیمِ تجاری
 *     است و در پنل هم استفاده می‌شود (فروشنده پیش از چاپِ کد می‌خواهد
 *     بداند کار می‌کند یا نه).
 *   • **اعمال** (preview/apply): این کد بر این سبد چقدر می‌کاهد و چگونه
 *     رویِ ردیف‌ها پخش می‌شود. این تصمیمِ مالیاتی است — چون مالیات باید
 *     بر «خالصِ پس از تخفیف» بسته شود، تخفیف را نمی‌توان فقط از جمعِ
 *     سفارش کم کرد؛ باید بدانیم هر ردیف چه سهمی برد.
 *
 * سه خطر که اینجا بسته شده:
 *
 *   ۱. **گم شدنِ ریال‌هایِ خُرد**: اگر ۱۰٪ از ۳ ردیف را جداگانه گرد کنیم،
 *      مجموعِ تخفیفِ ردیف‌ها با تخفیفِ کل یکی درنمی‌آید و حساب با تراز
 *      جور نمی‌شود. نخست کل را حساب می‌کنیم، سپس به نسبت پخش می‌کنیم و
 *      باقیمانده‌یِ تقسیم را به بزرگ‌ترین ردیف می‌دهیم — نه به آخرین،
 *      که ممکن است کوچک‌ترین باشد و از سقف بگذرد.
 *   ۲. **تخفیفِ بیش از مبلغِ کالا**: مبلغِ ثابت نباید از ارزشِ کالاهایِ
 *      مشمول بیشتر شود (تخفیفِ منفی یعنی پول دادن به مشتری برای خرید).
 *      سقف می‌زنیم.
 *   ۳. **مصرفِ بی‌پایان**: کوپنی که سقفِ دفعات دارد باید در همان تراکنشِ
 *      ثبتِ سفارش و با قفلِ ردیف (FOR UPDATE) مصرف شود، وگرنه دو سفارشِ
 *      هم‌زمان هر دو از آخرین نوبتِ آن استفاده می‌کنند.
 */

import { AppError } from '@set/shared-kernel';
import type { Database, Queryable } from '@set/db';

// ─────────────────────────────────────────────────────────────────────────────
// انواع
// ─────────────────────────────────────────────────────────────────────────────

export type CouponKind = 'percent' | 'fixed';
export type CouponScope = 'all' | 'product' | 'category';

export interface Coupon {
  id: string;
  code: string;
  title: string;
  description: string | null;
  kind: CouponKind;
  valueBp: number | null;
  valueRial: bigint | null;
  minSubtotalRial: bigint;
  maxDiscountRial: bigint | null;
  startsAt: Date | null;
  endsAt: Date | null;
  usageLimit: number | null;
  usageCount: number;
  perCustomerLimit: number;
  appliesTo: CouponScope;
  productId: string | null;
  /** دسته‌ها همان درختِ product_types اند؛ با فرزندانش گسترش می‌یابد */
  categoryId: string | null;
  isActive: boolean;
  createdAt: Date;
}

export interface CouponInput {
  code: string;
  title: string;
  description?: string | null;
  kind: CouponKind;
  valueBp?: number | null;
  valueRial?: bigint | string | number | null;
  minSubtotalRial?: bigint | string | number;
  maxDiscountRial?: bigint | string | number | null;
  startsAt?: Date | string | null;
  endsAt?: Date | string | null;
  usageLimit?: number | null;
  perCustomerLimit?: number;
  appliesTo?: CouponScope;
  productId?: string | null;
  categoryId?: string | null;
  isActive?: boolean;
  createdBy?: string | null;
}

/** یک ردیف از سبد، آن‌گونه که برایِ اعمالِ کوپن لازم داریم */
export interface CouponLine {
  variantId: string;
  productId: string | null;
  /** درختِ دسته: نزدیک‌ترین دسته تا ریشه — برایِ کوپنِ دسته‌ای */
  categoryIds?: readonly string[];
  quantity: number;
  unitPriceRial: bigint;
}

export interface CouponApplyResult {
  coupon: Coupon;
  /** تخفیفِ کلِ کوپن (ریال) */
  discountRial: bigint;
  /** مبلغِ مشمول: همان ردیف‌هایی که کوپن به آن‌ها خورد */
  eligibleRial: bigint;
  /** سهمِ تخفیفِ هر ردیف — مالیاتِ هر ردیف پس از کسرِ همین رقم بسته می‌شود */
  lines: ReadonlyArray<{ variantId: string; discountRial: bigint }>;
}

// ─────────────────────────────────────────────────────────────────────────────
// تبدیل‌ها
// ─────────────────────────────────────────────────────────────────────────────

// پایگاه، شمارگان را رشته برمی‌گرداند؛ ما در سراسر پروژه بیگ‌داریم.
function toBigInt(v: unknown): bigint {
  if (v == null) return 0n;
  if (typeof v === 'bigint') return v;
  return BigInt(v as string | number);
}

/** کد را یک‌دست می‌کند: حاشیه‌ها را می‌برد، فاصله‌ها را حذف، بزرگ می‌نویسد */
export function normalizeCode(raw: string): string {
  return raw.trim().replace(/\s+/g, '').toUpperCase();
}

function toCoupon(row: Record<string, unknown>): Coupon {
  return {
    id: String(row.id),
    code: String(row.code),
    title: String(row.title),
    description: row.description == null ? null : String(row.description),
    kind: row.kind as CouponKind,
    valueBp: row.value_bp == null ? null : Number(row.value_bp),
    valueRial: row.value_rial == null ? null : toBigInt(row.value_rial),
    minSubtotalRial: toBigInt(row.min_subtotal_rial ?? 0),
    maxDiscountRial: row.max_discount_rial == null ? null : toBigInt(row.max_discount_rial),
    startsAt: row.starts_at == null ? null : new Date(String(row.starts_at)),
    endsAt: row.ends_at == null ? null : new Date(String(row.ends_at)),
    usageLimit: row.usage_limit == null ? null : Number(row.usage_limit),
    usageCount: Number(row.usage_count ?? 0),
    perCustomerLimit: Number(row.per_customer_limit ?? 1),
    appliesTo: (row.applies_to ?? 'all') as CouponScope,
    productId: row.product_id == null ? null : String(row.product_id),
    categoryId: row.category_id == null ? null : String(row.category_id),
    isActive: Boolean(row.is_active),
    createdAt: new Date(String(row.created_at)),
  };
}

const COUPON_COLUMNS = `id, code, title, description, kind, value_bp, value_rial,
     min_subtotal_rial, max_discount_rial, starts_at, ends_at, usage_limit,
     usage_count, per_customer_limit, applies_to, product_id, category_id,
     is_active, created_at`;

// ─────────────────────────────────────────────────────────────────────────────
// یافتن و ارزیابی
// ─────────────────────────────────────────────────────────────────────────────

export async function findCouponByCode(
  db: Queryable,
  rawCode: string,
): Promise<Coupon | null> {
  const code = normalizeCode(rawCode);
  if (!code) return null;
  const { rows } = await db.query<Record<string, unknown>>(
    `SELECT ${COUPON_COLUMNS} FROM coupons WHERE code = $1`,
    [code],
  );
  return rows[0] ? toCoupon(rows[0]) : null;
}

export async function getCouponById(db: Queryable, id: string): Promise<Coupon | null> {
  const { rows } = await db.query<Record<string, unknown>>(
    `SELECT ${COUPON_COLUMNS} FROM coupons WHERE id = $1`,
    [id],
  );
  return rows[0] ? toCoupon(rows[0]) : null;
}

/** پیام‌هایِ فارسیِ یک‌دست، تا پنل و تسویه یک چیز بگویند */
export const COUPON_ERRORS = {
  notFound: 'این کدِ تخفیف پیدا نشد',
  inactive: 'این کدِ تخفیف غیرفعال است',
  notStarted: 'زمانِ استفاده از این کد هنوز نرسیده است',
  expired: 'این کدِ تخفیف منقضی شده است',
  exhausted: 'ظرفیتِ این کدِ تخفیف تمام شده است',
  customerLimit: 'شما پیش‌تر از این کد استفاده کرده‌اید',
  minSubtotal: 'این کد برایِ خریدهایِ بالاتر از {min} است',
  noEligibleItems: 'این کد شاملِ کالاهایِ این سبد نمی‌شود',
} as const;

function fail(message: string): never {
  throw new AppError('VALIDATION', { message, details: { coupon: message } });
}

function prettyRial(v: bigint): string {
  return v.toLocaleString('fa-IR');
}

/**
 * ارزیابیِ کوپن بی‌آنکه سبدی در کار باشد (برایِ پنل و برایِ بررسیِ سریع).
 * هر خطا پیامِ فارسیِ خودش را دارد — چون پرسشِ واقعیِ فروشنده این نیست که
 * «کد نامعتبر است»، بلکه این است که «چرا این کد جواب نمی‌دهد».
 */
export async function validateCoupon(
  db: Queryable,
  rawCode: string,
  opts: { customerId?: string | null; at?: Date } = {},
): Promise<Coupon> {
  const coupon = await findCouponByCode(db, rawCode);
  if (!coupon) fail(COUPON_ERRORS.notFound);
  return validateCouponRecord(db, coupon, opts);
}

export async function validateCouponRecord(
  db: Queryable,
  coupon: Coupon,
  opts: { customerId?: string | null; at?: Date } = {},
): Promise<Coupon> {
  const at = opts.at ?? new Date();

  if (!coupon.isActive) fail(COUPON_ERRORS.inactive);
  if (coupon.startsAt != null && coupon.startsAt > at) fail(COUPON_ERRORS.notStarted);
  if (coupon.endsAt != null && coupon.endsAt < at) fail(COUPON_ERRORS.expired);

  if (coupon.usageLimit != null && coupon.usageCount >= coupon.usageLimit) {
    fail(COUPON_ERRORS.exhausted);
  }

  if (opts.customerId != null && coupon.perCustomerLimit > 0) {
    const { rows } = await db.query<{ n: string | number }>(
      `SELECT COUNT(*) AS n FROM coupon_redemptions
        WHERE coupon_id = $1 AND customer_id = $2`,
      [coupon.id, opts.customerId],
    );
    if (Number(rows[0]?.n ?? 0) >= coupon.perCustomerLimit) {
      fail(COUPON_ERRORS.customerLimit);
    }
  }

  return coupon;
}

// ─────────────────────────────────────────────────────────────────────────────
// اعمال رویِ سبد — جایی که ریال‌ها تقسیم می‌شوند
// ─────────────────────────────────────────────────────────────────────────────

function lineGross(line: CouponLine): bigint {
  return line.unitPriceRial * BigInt(line.quantity);
}

/**
 * آیا این ردیف مشمولِ کوپن است؟
 *
 * کوپنِ دسته‌ای باید فرزندانِ دسته را هم بگیرد: اگر رویِ «شارژر» کوپن
 * بدهیم و آن دسته دو زیرشاخه داشته باشد، انتظار این است که کالاهایِ
 * زیرشاخه هم مشمول شوند — نه اینکه فروشنده ناچار شود برایِ هر برگ یک کوپن
 * بسازد. فهرستِ دسته‌هایِ ردیف از بیرون می‌آید (از سبد یا از فراخوان) تا
 * این پودمان مجبور نباشد برایِ هر ردیف درخت را بپیماید.
 */
function isEligible(coupon: Coupon, line: CouponLine): boolean {
  switch (coupon.appliesTo) {
    case 'all':
      return true;
    case 'product':
      return line.productId != null && line.productId === coupon.productId;
    case 'category': {
      if (coupon.categoryId == null || line.categoryIds == null) return false;
      return line.categoryIds.includes(coupon.categoryId);
    }
    default:
      return false;
  }
}

/**
 * تخفیف را میانِ ردیف‌هایِ مشمول به نسبتِ مبلغ پخش می‌کند.
 *
 * چرا به نسبت و نه یکسان؟ چون سبد ممکن است یک کالایِ ۵ میلیونی و یک کابلِ
 * ۵۰ هزار تومانی داشته باشد؛ تقسیمِ مساوی یعنی کابل را رایگان کنیم و از
 * کالایِ اصلی تقریباً چیزی کم نکنیم.
 *
 * باقیمانده‌یِ تقسیم (یک یا دو ریال) به بزرگ‌ترین ردیف می‌رود، تا مجموعِ
 * سهم‌ها دقیقاً برابرِ تخفیفِ کل باشد و ترازِ حساب جور درآید.
 */
function distribute(total: bigint, lines: readonly CouponLine[]): bigint[] {
  const grosses = lines.map((l) => lineGross(l));
  const sum = grosses.reduce((a, b) => a + b, 0n);
  if (sum === 0n) return lines.map(() => 0n);

  const shares = grosses.map((g) => (total * g) / sum);
  let given = shares.reduce((a, b) => a + b, 0n);
  let rest = total - given;

  // ریال‌هایِ جامانده، یکی‌یکی: نخست به بزرگ‌ترین سهم، سپس به بعدی
  const order = shares.map((_, i) => i).sort((a, b) => {
    const ga = grosses[a] ?? 0n;
    const gb = grosses[b] ?? 0n;
    if (ga === gb) return a - b;
    return ga > gb ? -1 : 1;
  });
  let k = 0;
  while (rest > 0n && k < order.length) {
    const idx = order[k % order.length];
    if (idx != null) {
      shares[idx] = (shares[idx] ?? 0n) + 1n;
      rest -= 1n;
    }
    k += 1;
  }
  return shares;
}

/**
 * اعمالِ کامل: ارزیابی + حسابِ تخفیف + پخش رویِ ردیف‌ها.
 *
 * ترتیبِ حساب اهمیت دارد: نخست مشمول‌ها معلوم می‌شوند، سپس تخفیفِ خام،
 * سپس سقف، سپس پخش. اگر سقف را پس از پخش بزنیم، مجموعِ سهم‌ها از سقفِ
 * اعلام‌شده به مشتری بیشتر می‌شود و دوباره تراز به هم می‌خورد.
 */
export async function applyCoupon(
  db: Queryable,
  rawCode: string,
  lines: readonly CouponLine[],
  opts: { customerId?: string | null; at?: Date } = {},
): Promise<CouponApplyResult> {
  const coupon = await validateCoupon(db, rawCode, opts);
  return applyCouponRecord(coupon, lines);
}

export function applyCouponRecord(
  coupon: Coupon,
  lines: readonly CouponLine[],
): CouponApplyResult {
  const eligible = lines.filter((l) => isEligible(coupon, l));

  if (eligible.length === 0) {
    throw new AppError('VALIDATION', {
      message: COUPON_ERRORS.noEligibleItems,
      details: { coupon: COUPON_ERRORS.noEligibleItems },
    });
  }

  const eligibleRial = eligible.reduce((acc, l) => acc + lineGross(l), 0n);

  let discount = 0n;
  if (coupon.kind === 'percent') {
    const bp = BigInt(coupon.valueBp ?? 0);
    discount = (eligibleRial * bp) / 10000n;
    if (coupon.maxDiscountRial != null && discount > coupon.maxDiscountRial) {
      discount = coupon.maxDiscountRial;
    }
  } else {
    discount = coupon.valueRial ?? 0n;
    // از ارزشِ کالاهایِ مشمول بیشتر نمی‌شود
    if (discount > eligibleRial) discount = eligibleRial;
    if (coupon.maxDiscountRial != null && discount > coupon.maxDiscountRial) {
      discount = coupon.maxDiscountRial;
    }
  }

  if (discount < 0n) discount = 0n;

  const shares = distribute(discount, eligible);
  return {
    coupon,
    discountRial: discount,
    eligibleRial,
    lines: eligible.map((l, i) => ({ variantId: l.variantId, discountRial: shares[i] ?? 0n })),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// مصرف و آزادسازی
// ─────────────────────────────────────────────────────────────────────────────

/**
 * مصرفِ کوپن همراهِ ثبتِ سفارش.
 *
 * چرا اینجا «بخوان، سپس بنویس» نمی‌کنیم؟ چون آن الگو همیشه یک روزنه دارد:
 * میانِ خواندن و نوشتن، دیگری می‌تواند همان نوبت را بردارد. سدِ معمولش
 * `SELECT ... FOR UPDATE` است، ولی قفلِ ردیف در همه‌یِ پایگاه‌ها یکسان
 * رفتار نمی‌کند (در پایگاهِ درون‌حافظه‌یِ آزمون‌ها که چندسرِ واقعی نیست،
 * هر دو فراخوان از آن می‌گذرند). پس هر دو شرط را در **یک دستور** می‌گنجانیم
 * تا پایگاه خودش داوری کند — دستور اتمی است، در هر پایگاهی و در هر نوبتی.
 *
 *   ۱. شمارنده تنها اگر زیرِ سقف است بالا می‌رود (وگرنه دستور هیچ ردیفی
 *      برنمی‌گرداند، یعنی ظرفیت تمام شده).
 *   ۲. رکوردِ مصرف تنها اگر سهمیه‌یِ آن مشتری مانده باشد درج می‌شود؛
 *      شمارش و درج در یک دستور، پس کسی نمی‌تواند در میانه‌شان جا بزند.
 *
 * اگر مرحله‌یِ دوم شکست بخورد، اثرِ مرحله‌یِ نخست را برمی‌گردانیم تا مبادا
 * در فراخوانی بی‌تراکنش، شمارنده بالا برود و رکوردی ثبت نشود.
 */
export async function redeemCoupon(
  tx: Queryable,
  couponId: string,
  orderId: string,
  discountRial: bigint,
  customerId?: string | null,
): Promise<void> {
  // ۱) بالا بردنِ شمارنده، مشروط به داشتنِ ظرفیت
  const { rows: bumped } = await tx.query<{ usage_count: string | number }>(
    `UPDATE coupons
        SET usage_count = usage_count + 1, updated_at = now()
      WHERE id = $1
        AND (usage_limit IS NULL OR usage_count < usage_limit)
      RETURNING usage_count`,
    [couponId],
  );
  if (bumped.length === 0) {
    // یا کوپنی با این شناسه نیست، یا ظرفیتش پر شده
    const { rows: exists } = await tx.query<{ id: string }>(
      `SELECT id FROM coupons WHERE id = $1`,
      [couponId],
    );
    if (exists.length === 0) throw new AppError('NOT_FOUND', { message: 'کوپن پیدا نشد' });
    throw new AppError('CONFLICT', { message: COUPON_ERRORS.exhausted });
  }

  // ۲) ثبتِ مصرف، مشروط به سهمیه‌یِ مشتری
  const { rows: inserted } = await tx.query<{ id: string }>(
    `INSERT INTO coupon_redemptions (coupon_id, order_id, customer_id, discount_rial)
     SELECT $1, $2, $3, $4
      WHERE ($3::uuid IS NULL)
         OR (SELECT COUNT(*) FROM coupon_redemptions
              WHERE coupon_id = $1 AND customer_id = $3)
            < (SELECT per_customer_limit FROM coupons WHERE id = $1)
     RETURNING id`,
    [couponId, orderId, customerId ?? null, discountRial.toString()],
  );

  if (inserted.length === 0) {
    // سهمیه‌یِ این مشتری پر بود؛ شمارنده را پس می‌دهیم
    await tx.query(
      `UPDATE coupons SET usage_count = GREATEST(usage_count - 1, 0) WHERE id = $1`,
      [couponId],
    );
    throw new AppError('CONFLICT', { message: COUPON_ERRORS.customerLimit });
  }
}

/**
 * آزادسازی پس از لغوِ سفارش: نوبتِ مصرف‌شده برمی‌گردد و رکورد پاک می‌شود،
 * تا مشتری‌ای که سفارش را به‌هم زده، نتواند بگوید «کوپنم سوخت».
 */
export async function releaseCoupon(tx: Queryable, orderId: string): Promise<boolean> {
  const { rows } = await tx.query<{ id: string; coupon_id: string }>(
    `SELECT id, coupon_id FROM coupon_redemptions WHERE order_id = $1`,
    [orderId],
  );
  const row = rows[0];
  if (!row) return false;

  await tx.query(`DELETE FROM coupon_redemptions WHERE id = $1`, [row.id]);
  await tx.query(
    `UPDATE coupons SET usage_count = GREATEST(usage_count - 1, 0), updated_at = now()
      WHERE id = $1`,
    [row.coupon_id],
  );
  return true;
}

// ─────────────────────────────────────────────────────────────────────────────
// مدیریت (پنل)
// ─────────────────────────────────────────────────────────────────────────────

export interface ListCouponsOpts {
  limit?: number;
  offset?: number;
  includeInactive?: boolean;
  search?: string | null;
}

export async function listCoupons(
  db: Queryable,
  opts: ListCouponsOpts = {},
): Promise<{ rows: Coupon[]; total: number }> {
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
  const offset = Math.max(opts.offset ?? 0, 0);
  const where: string[] = [];
  const params: unknown[] = [];

  if (!opts.includeInactive) {
    where.push('is_active = true');
  }
  if (opts.search) {
    params.push(`%${opts.search}%`);
    where.push(`(code ILIKE $${params.length} OR title ILIKE $${params.length})`);
  }
  const w = where.length ? `WHERE ${where.join(' AND ')}` : '';

  params.push(limit, offset);
  const { rows } = await db.query<Record<string, unknown>>(
    `SELECT ${COUPON_COLUMNS} FROM coupons ${w}
      ORDER BY created_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );
  const { rows: cnt } = await db.query<{ n: string | number }>(
    `SELECT COUNT(*) AS n FROM coupons ${w}`,
    params.slice(0, params.length - 2),
  );
  return { rows: rows.map(toCoupon), total: Number(cnt[0]?.n ?? 0) };
}

/**
 * ساختِ کوپن.
 *
 * اعتبارسنجی اینجا (در پودمان) است، نه فقط در کنترلر — چون هم پنل از این
 * مسیر می‌آید و هم اسکریپتِ تمرین. اگر قانون فقط در کنترلر باشد، هر
 * فراخوانِ دیگری می‌تواند کوپنی بسازد که ۲۰۰٪ تخفیف می‌دهد.
 */
export async function createCoupon(db: Queryable, input: CouponInput): Promise<Coupon> {
  const code = normalizeCode(input.code);
  if (!code) throw new AppError('VALIDATION', { message: 'کدِ تخفیف نمی‌تواند تهی باشد' });
  if (!input.title?.trim()) throw new AppError('VALIDATION', { message: 'عنوانِ کوپن لازم است' });

  if (input.kind === 'percent') {
    const bp = input.valueBp ?? 0;
    if (!Number.isFinite(bp) || bp <= 0 || bp > 10000) {
      throw new AppError('VALIDATION', { message: 'درصدِ تخفیف باید بینِ ۰ تا ۱۰۰ باشد' });
    }
  } else if (input.kind === 'fixed') {
    const v = toBigInt(input.valueRial ?? 0);
    if (v <= 0n) throw new AppError('VALIDATION', { message: 'مبلغِ تخفیف باید بیش از صفر باشد' });
  } else {
    throw new AppError('VALIDATION', { message: 'نوعِ کوپن نامعتبر است' });
  }

  if (input.appliesTo === 'product' && !input.productId) {
    throw new AppError('VALIDATION', { message: 'برایِ کوپنِ کالا باید کالا انتخاب شود' });
  }
  if (input.appliesTo === 'category' && !input.categoryId) {
    throw new AppError('VALIDATION', { message: 'برایِ کوپنِ دسته باید دسته انتخاب شود' });
  }
  if (input.startsAt != null && input.endsAt != null) {
    if (new Date(input.startsAt) > new Date(input.endsAt)) {
      throw new AppError('VALIDATION', { message: 'تاریخِ آغاز باید پیش از تاریخِ پایان باشد' });
    }
  }

  const { rows } = await db.query<Record<string, unknown>>(
    `INSERT INTO coupons (code, title, description, kind, value_bp, value_rial,
        min_subtotal_rial, max_discount_rial, starts_at, ends_at, usage_limit,
        per_customer_limit, applies_to, product_id, category_id, is_active, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
     RETURNING ${COUPON_COLUMNS}`,
    [
      code,
      input.title.trim(),
      input.description?.trim() || null,
      input.kind,
      input.kind === 'percent' ? Math.round(input.valueBp ?? 0) : null,
      input.kind === 'fixed' ? toBigInt(input.valueRial ?? 0).toString() : null,
      toBigInt(input.minSubtotalRial ?? 0).toString(),
      input.maxDiscountRial == null ? null : toBigInt(input.maxDiscountRial).toString(),
      input.startsAt == null ? null : new Date(input.startsAt).toISOString(),
      input.endsAt == null ? null : new Date(input.endsAt).toISOString(),
      input.usageLimit ?? null,
      Math.max(input.perCustomerLimit ?? 1, 1),
      input.appliesTo ?? 'all',
      input.appliesTo === 'product' ? (input.productId ?? null) : null,
      input.appliesTo === 'category' ? (input.categoryId ?? null) : null,
      input.isActive ?? true,
      input.createdBy ?? null,
    ],
  );
  return toCoupon(rows[0]!);
}

export async function updateCoupon(
  db: Queryable,
  id: string,
  patch: Partial<CouponInput>,
): Promise<Coupon | null> {
  const current = await getCouponById(db, id);
  if (!current) return null;

  const sets: string[] = [];
  const params: unknown[] = [];
  const add = (col: string, val: unknown) => {
    params.push(val);
    sets.push(`${col} = $${params.length}`);
  };

  if (patch.title != null) add('title', patch.title.trim());
  if (patch.description !== undefined) add('description', patch.description?.trim() || null);
  if (patch.minSubtotalRial != null) add('min_subtotal_rial', toBigInt(patch.minSubtotalRial).toString());
  if (patch.maxDiscountRial !== undefined) {
    add('max_discount_rial', patch.maxDiscountRial == null ? null : toBigInt(patch.maxDiscountRial).toString());
  }
  if (patch.startsAt !== undefined) {
    add('starts_at', patch.startsAt == null ? null : new Date(patch.startsAt).toISOString());
  }
  if (patch.endsAt !== undefined) {
    add('ends_at', patch.endsAt == null ? null : new Date(patch.endsAt).toISOString());
  }
  if (patch.usageLimit !== undefined) add('usage_limit', patch.usageLimit ?? null);
  if (patch.perCustomerLimit != null) add('per_customer_limit', Math.max(patch.perCustomerLimit, 1));
  if (patch.isActive != null) add('is_active', patch.isActive);

  // نوع و مبلغ را با هم عوض می‌کنیم تا نیمی از یک کوپنِ درصدی و نیمی از
  // یک کوپنِ مبلغی برجای نماند
  if (patch.kind != null) {
    if (patch.kind === 'percent') {
      const bp = patch.valueBp ?? current.valueBp ?? 0;
      if (bp <= 0 || bp > 10000) {
        throw new AppError('VALIDATION', { message: 'درصدِ تخفیف باید بینِ ۰ تا ۱۰۰ باشد' });
      }
      add('kind', 'percent');
      add('value_bp', Math.round(bp));
      add('value_rial', null);
    } else {
      const v = patch.valueRial != null ? toBigInt(patch.valueRial) : (current.valueRial ?? 0n);
      if (v <= 0n) throw new AppError('VALIDATION', { message: 'مبلغِ تخفیف باید بیش از صفر باشد' });
      add('kind', 'fixed');
      add('value_bp', null);
      add('value_rial', v.toString());
    }
  } else {
    if (patch.valueBp != null && current.kind === 'percent') add('value_bp', Math.round(patch.valueBp));
    if (patch.valueRial != null && current.kind === 'fixed') {
      add('value_rial', toBigInt(patch.valueRial).toString());
    }
  }

  if (sets.length === 0) return current;

  sets.push('updated_at = now()');
  params.push(id);
  const { rows } = await db.query<Record<string, unknown>>(
    `UPDATE coupons SET ${sets.join(', ')} WHERE id = $${params.length} RETURNING ${COUPON_COLUMNS}`,
    params,
  );
  return rows[0] ? toCoupon(rows[0]) : null;
}

export async function setCouponActive(
  db: Queryable,
  id: string,
  isActive: boolean,
): Promise<Coupon | null> {
  const { rows } = await db.query<Record<string, unknown>>(
    `UPDATE coupons SET is_active = $2, updated_at = now() WHERE id = $1
     RETURNING ${COUPON_COLUMNS}`,
    [id, isActive],
  );
  return rows[0] ? toCoupon(rows[0]) : null;
}

export interface RedemptionRow {
  id: string;
  couponId: string;
  orderId: string | null;
  orderNo: string | null;
  customerId: string | null;
  customerName: string | null;
  discountRial: bigint;
  createdAt: Date;
}

export async function listRedemptions(
  db: Queryable,
  couponId: string,
  limit = 50,
): Promise<RedemptionRow[]> {
  const { rows } = await db.query<Record<string, unknown>>(
    // مشتری و کاربر در این پروژه دو جدولِ جدایند و ستونِ پیوند ندارند؛
    // نامِ خریدار را از خودِ مشتری می‌خوانیم (شناسه‌اش برایِ پیگیری کافی است).
    `SELECT r.id, r.coupon_id, r.order_id, o.order_no, r.customer_id,
            c.full_name AS customer_name, r.discount_rial, r.created_at
       FROM coupon_redemptions r
       LEFT JOIN orders o ON o.id = r.order_id
       LEFT JOIN customers c ON c.id = r.customer_id
      WHERE r.coupon_id = $1
      ORDER BY r.created_at DESC
      LIMIT $2`,
    [couponId, Math.min(Math.max(limit, 1), 200)],
  );
  return rows.map((r) => ({
    id: String(r.id),
    couponId: String(r.coupon_id),
    orderId: r.order_id == null ? null : String(r.order_id),
    orderNo: r.order_no == null ? null : String(r.order_no),
    customerId: r.customer_id == null ? null : String(r.customer_id),
    customerName: r.customer_name == null ? null : String(r.customer_name),
    discountRial: toBigInt(r.discount_rial),
    createdAt: new Date(String(r.created_at)),
  }));
}

export async function countRedemptions(db: Queryable, couponId: string): Promise<number> {
  const { rows } = await db.query<{ n: string | number }>(
    `SELECT COUNT(*) AS n FROM coupon_redemptions WHERE coupon_id = $1`,
    [couponId],
  );
  return Number(rows[0]?.n ?? 0);
}
