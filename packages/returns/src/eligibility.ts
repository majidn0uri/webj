import { formatJalali } from '@set/shared-kernel';
import type { ReturnKind, ReturnSettings } from './types.js';

/**
 * شایستگیِ مرجوعی — آیا این درخواست را می‌توان پذیرفت؟
 *
 * چرا این تصمیم یک تابعِ جدا و قابلِ آزمایش است؟ چون «پذیرفتن یا رد کردنِ
 * درخواستِ مشتری» حساس‌ترین تصمیمِ پس از فروش است: ردِ نادرست یعنی از دست
 * دادنِ مشتری، پذیرشِ نادرست یعنی زیانِ مستقیم. هر دو باید با معیارِ روشن و
 * یکسان انجام شوند — نه با سلیقه‌یِ کارمندِ شیفت.
 *
 * سه معیار داریم:
 *   ۱) سفارش پرداخت‌شده باشد (کالا که نرفته، برگشتی معنا ندارد)؛
 *   ۲) مقدار، از آنچه مانده بیشتر نباشد (بیش‌مرجوعی)؛
 *   ۳) مهلت — که برایِ هر انگیزه متفاوت است (پایین را ببینید).
 */

export interface EligibilityInput {
  kind: ReturnKind;
  /** زمانِ پرداخت؛ مرجوعی از این لحظه حساب می‌شود نه از زمانِ ارسال */
  paidAt: Date | null;
  orderStatus: string;
  now?: Date;
  settings: ReturnSettings;
  /** تعدادِ کلِ خریداری‌شده در این ردیف */
  purchasedQuantity: number;
  /** تعدادی که پیش‌تر (در مرجوعی‌هایِ زنده) برگشته است */
  alreadyReturned: number;
  /** تعدادی که این بار درخواست شده */
  requestedQuantity: number;
  /** پایانِ گارانتی اگر ردیف گارانتی دارد (فقط برای kind=warranty) */
  warrantyEndsAt?: Date | null;
  /** نوعِ کالا (از product_type) برایِ بررسیِ «قابلِ مرجوع نیست» */
  productType?: string | null;
}

export interface EligibilityResult {
  eligible: boolean;
  /** دلیل‌هایِ رد — به فارسی و آماده برایِ نمایش به مشتری و کارمند */
  reasons: string[];
  /** روزهایِ گذشته از پرداخت (برایِ نمایش) */
  daysSincePurchase: number;
  /** آخرین مهلت، اگر انگیزه مهلت دارد */
  deadlineAt: Date | null;
  /** چند روز تا پایانِ مهلت مانده (منفی یعنی گذشته) */
  daysLeft: number | null;
}

/** نوع‌هایی که ذاتاً قابلِ مرجوع کردن نیستند (خدمات و کالایِ دیجیتال) */
const NON_RETURNABLE_TYPES = new Set(['service', 'digital', 'gift_card']);

const DAY_MS = 24 * 60 * 60 * 1000;

export function daysBetween(from: Date, to: Date): number {
  return Math.floor((to.getTime() - from.getTime()) / DAY_MS);
}

export function evaluateEligibility(input: EligibilityInput): EligibilityResult {
  const now = input.now ?? new Date();
  const reasons: string[] = [];
  const daysSincePurchase = input.paidAt ? daysBetween(input.paidAt, now) : 0;

  // ۱) سفارش باید پرداخت‌شده باشد
  if (input.orderStatus !== 'paid') {
    reasons.push(
      input.orderStatus === 'cancelled'
        ? 'این سفارش لغو شده است و چیزی برایِ مرجوع کردن ندارد.'
        : 'تنها سفارشِ پرداخت‌شده قابلِ مرجوعی است (این سفارش هنوز تسویه نشده).',
    );
  }

  // ۲) مقدار: نه صفر، نه بیش از مانده
  const remaining = input.purchasedQuantity - input.alreadyReturned;
  if (input.requestedQuantity <= 0) {
    reasons.push('تعدادِ مرجوعی باید دست‌کم یک باشد.');
  } else if (input.requestedQuantity > remaining) {
    reasons.push(
      `از این کالا ${remaining} عدد قابلِ مرجوعی است (${input.alreadyReturned} از ${input.purchasedQuantity} عدد پیش‌تر برگشته).`,
    );
  }

  // ۳) نوعِ کالا
  if (input.productType && NON_RETURNABLE_TYPES.has(input.productType)) {
    reasons.push('این گونه‌یِ کالا (خدمات/دیجیتال) قابلِ مرجوعی نیست.');
  }

  // ۴) مهلت — بسته به انگیزه
  let deadlineAt: Date | null = null;

  if (input.kind === 'withdrawal' && input.paidAt) {
    // حقِ انصراف: مهلت از روزِ پرداخت. چرا پرداخت و نه تحویل؟ چون تحویل در
    // این سامانه هنوز رخدادِ مستقلی ندارد (وضعیتِ «تحویل‌شده» بعداً می‌آید) و
    // سنجیدن از پرداخت، به نفعِ مشتری است: مهلتش زودتر شروع نمی‌شود.
    deadlineAt = new Date(input.paidAt.getTime() + input.settings.windowDays * DAY_MS);
    if (now.getTime() > deadlineAt.getTime()) {
      // تاریخ را شمسی و فارسی می‌گوییم: مشتری و کارمند با تقویمِ میلادی
      // مهلت را نمی‌سنجند
      reasons.push(
        `مهلتِ انصراف (${input.settings.windowDays} روز) در ${formatJalali(deadlineAt)} گذشته است.`,
      );
    }
  } else if (input.kind === 'warranty') {
    // ادعایِ گارانتی: مهلت همان عمرِ گارانتی است، نه ۷ روزِ انصراف.
    const endsAt =
      input.warrantyEndsAt ??
      (input.paidAt
        ? addMonths(input.paidAt, input.settings.warrantyDefaultMonths)
        : null);
    deadlineAt = endsAt;
    if (!endsAt) {
      reasons.push('برایِ این کالا گارانتی تعریف نشده است.');
    } else if (now.getTime() > endsAt.getTime()) {
      reasons.push('گارانتیِ این کالا پایان یافته است.');
    }
  }
  // defective و wrong_item عمداً مهلت ندارند: تقصیر از ما بوده و قانون هم
  // برایِ کالایِ معیوب مهلتِ انصراف نمی‌خواهد (خیارِ عیب).

  const daysLeft = deadlineAt ? daysBetween(now, deadlineAt) : null;

  return {
    eligible: reasons.length === 0,
    reasons,
    daysSincePurchase,
    deadlineAt,
    daysLeft,
  };
}

export function addMonths(from: Date, months: number): Date {
  const d = new Date(from.getTime());
  const targetMonth = d.getMonth() + months;
  const day = d.getDate();
  // سرریزِ ماه: ۳۱ فروردین + ۱ ماه = ۱ خرداد نمی‌شود؛ ماهِ مقصد را می‌سازیم و
  // اگر روز از روزهایِ آن ماه بیشتر بود، به آخرین روزِ همان ماه می‌لغزانیم.
  d.setDate(1);
  d.setMonth(targetMonth);
  const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  d.setDate(Math.min(day, lastDay));
  return d;
}
