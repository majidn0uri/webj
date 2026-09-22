import type { Queryable } from '@set/db';
import { AppError } from '@set/shared-kernel';
import { getBoolean } from './settings.js';

/**
 * قیمت‌گذاری — قواعدِ BR-01 تا BR-08
 *
 * ترتیبِ محاسبه (مهم است، چون روی مبلغ نهایی اثر دارد):
 *
 *   ۱) قیمتِ پایه بر اساس نوعِ اکانت             (BR-01 , BR-02)
 *   ۲) تخفیفِ کالا در بازه‌ی زمانیِ فعال          (BR-03)
 *        و فقط برای همکار اگر مجاز باشد          (BR-04)
 *   ۳) تخفیفِ دستیِ کارمند تا سقفِ کالا          (BR-05)
 *   ۴) قیمتِ ثبت‌شده برای همیشه همان می‌ماند      (BR-06 — در سند، نه اینجا)
 *
 * این تابع فقط «قیمتِ پیشنهادی» را حساب می‌کند؛ ثبتِ قیمت روی سفارش کارِ
 * سرویسِ سفارش است تا بعداً تغییر قیمت، سند را تغییر ندهد.
 */

export interface PriceContext {
  /** مشتریِ واردشده؛ نبود یعنی مهمان */
  customer?: { id: string; isPartner: boolean } | null;
  /** درصدِ تخفیفِ دستی که کارمند می‌خواهد بدهد (BR-05) */
  manualDiscountPercent?: number;
  /** آیا مدیر این تخفیفِ دستی را تأیید کرده است؟ */
  managerApproved?: boolean;
}

export interface ResolvedPrice {
  variantId: string;
  /** قیمتِ پایه (فروش یا همکاری) پیش از هر تخفیف */
  baseRial: bigint;
  /** آیا از قیمتِ همکاری استفاده شد؟ */
  partnerPriceUsed: boolean;
  /** تخفیفِ خودکارِ کالا (در بازه‌ی فعال) */
  discountRial: bigint;
  discountPercent: number;
  /** تخفیفِ دستیِ کارمند (پس از کنترلِ سقف) */
  manualRial: bigint;
  /** قیمتِ نهاییِ هر واحد */
  unitRial: bigint;
  /** برای نمایشِ «قیمتِ قبل» در سایت */
  wasRial: bigint;
  discountWindowActive: boolean;
}

interface VariantRow {
  id: string;
  price_rial: string;
  partner_price_rial: string | null;
  discount_percent: string | null;
  discount_amount_rial: string | null;
  discount_starts_at: Date | null;
  discount_ends_at: Date | null;
  discount_on_partner: boolean;
  max_discount_percent: string | number;
  partner_price_percent: string | null;
}

export async function resolvePrice(
  db: Queryable,
  variantId: string,
  ctx: PriceContext = {},
  at: Date = new Date(),
): Promise<ResolvedPrice> {
  const { rows } = await db.query<VariantRow>(
    `SELECT v.id, v.price_rial::text, v.partner_price_rial::text,
            p.discount_percent::text, p.discount_amount_rial::text,
            p.discount_starts_at, p.discount_ends_at, p.discount_on_partner,
            p.max_discount_percent, p.partner_price_percent::text
       FROM product_variants v
       JOIN products p ON p.id = v.product_id
      WHERE v.id = $1`,
    [variantId],
  );
  const row = rows[0];
  if (!row) throw new AppError('NOT_FOUND', { message: 'تنوع یافت نشد' });
  return computePrice(row, ctx, at, await getBoolean(db, 'discount_on_partner'));
}

/** محاسبه‌ی خالص (بدون پایگاه‌داده) — برای آزمون‌پذیری و استفاده در سبد */
export function computePrice(
  row: VariantRow,
  ctx: PriceContext,
  at: Date,
  globalDiscountOnPartner: boolean,
): ResolvedPrice {
  const saleRial = BigInt(row.price_rial);
  const isPartner = ctx.customer?.isPartner === true;

  // --- ۱) قیمت پایه: همکار ← قیمت همکاری، در غیر این صورت قیمت فروش (BR-01)
  let baseRial = saleRial;
  let partnerPriceUsed = false;

  if (isPartner) {
    if (row.partner_price_rial != null) {
      baseRial = BigInt(row.partner_price_rial);
      partnerPriceUsed = true;
    } else if (row.partner_price_percent != null) {
      // حالتِ دومِ سند: درصدی از قیمت فروش
      const pct = Number(row.partner_price_percent);
      baseRial = (saleRial * BigInt(100 - pct)) / 100n;
      partnerPriceUsed = true;
    }
    // BR-02: اگر هیچ‌کدام نبود → همان قیمت فروش
  }

  // --- ۲) تخفیفِ کالا فقط در بازه‌ی تاریخ (BR-03)
  const windowActive =
    (row.discount_percent != null || row.discount_amount_rial != null) &&
    (row.discount_starts_at == null || new Date(row.discount_starts_at) <= at) &&
    (row.discount_ends_at == null || new Date(row.discount_ends_at) >= at);

  // BR-04: تخفیف روی قیمت همکاری فقط با اجازه
  const discountAllowed = !isPartner || row.discount_on_partner || globalDiscountOnPartner;

  let discountRial = 0n;
  let discountPercent = 0;

  if (windowActive && discountAllowed) {
    if (row.discount_percent != null) {
      discountPercent = Number(row.discount_percent);
      discountRial = (baseRial * BigInt(discountPercent)) / 100n;
    } else if (row.discount_amount_rial != null) {
      discountRial = BigInt(row.discount_amount_rial);
      if (discountRial > baseRial) discountRial = baseRial;
      discountPercent = Number((discountRial * 100n) / (baseRial || 1n));
    }
  }

  const afterAuto = baseRial - discountRial;

  // --- ۳) تخفیفِ دستیِ کارمند تا سقفِ کالا (BR-05)
  let manualRial = 0n;
  const wanted = Math.max(0, ctx.manualDiscountPercent ?? 0);
  if (wanted > 0) {
    const cap = Number(row.max_discount_percent ?? 0);
    if (wanted > cap && !ctx.managerApproved) {
      throw new AppError('FORBIDDEN', {
        message: `تخفیفِ ${wanted}٪ از سقفِ مجازِ این کالا (${cap}٪) بیشتر است؛ فقط با تأییدِ مدیر`,
      });
    }
    manualRial = (afterAuto * BigInt(wanted)) / 100n;
  }

  const unitRial = afterAuto - manualRial;

  return {
    variantId: row.id,
    baseRial,
    partnerPriceUsed,
    discountRial,
    discountPercent,
    manualRial,
    unitRial: unitRial < 0n ? 0n : unitRial,
    wasRial: saleRial,
    discountWindowActive: windowActive,
  };
}

/**
 * مبلغِ قابلِ نمایش برای مهمان (BR-... بخش ۱۱: «نمایش قیمت به مهمان: ببیند»)
 * اگر مدیر خاموش کرده باشد، مقدار null برمی‌گردد تا صفحه «برای دیدنِ قیمت وارد شوید» نشان دهد.
 */
export async function priceVisibleToGuest(db: Queryable): Promise<boolean> {
  return getBoolean(db, 'show_price_to_guest');
}
