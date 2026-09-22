/**
 * چرخه‌یِ سفارش — یک منبعِ حقیقت.
 *
 * تا پیش از این، وضعیتِ سفارش در چند پرونده پراکنده بود: هر کدی که وضعیتی
 * را عوض می‌کرد، خودش هم تصمیم می‌گرفت که «از کجا به کجا» رواست. نتیجه
 * این بود که پرسشِ ساده‌یِ «الان می‌شود این سفارش را بسته‌بندی کرد؟» در
 * هیچ جایی پاسخِ واحدی نداشت، و دو مسیر می‌توانستند دو پاسخِ متفاوت
 * بدهند.
 *
 * اینجا چرخه یک‌بار تعریف می‌شود و همه‌یِ گذارها از یک در می‌گذرند. سه
 * فایده‌یِ فوری:
 *
 *   • خطا پیش از رخ دادن گرفته می‌شود (نه پس از آن که ردیف عوض شد)؛
 *   • برچسبِ فارسیِ هر وضعیت یک‌جاست، پس رابط و پیامک و گزارش یکی
 *     حرف می‌زنند؛
 *   • افزودنِ یک گام (مانندِ «بسته‌بندی») یعنی تغییر در یک جدول، نه
 *     گشتنِ دنبالِ هر `UPDATE orders SET status` در پروژه.
 */

import { AppError } from '@set/shared-kernel';

export type OrderStatus =
  | 'pending_payment'
  | 'paid'
  | 'confirmed'
  | 'packing'
  | 'processing'
  | 'shipped'
  | 'delivered'
  | 'cancelled'
  | 'refunded'
  | 'returned';

/** برچسبِ فارسی — همان که مشتری در پیگیری می‌بیند */
export const STATUS_LABEL: Record<OrderStatus, string> = {
  pending_payment: 'در انتظارِ پرداخت',
  paid: 'پرداخت‌شده',
  confirmed: 'تأییدشده',
  packing: 'در حالِ بسته‌بندی',
  processing: 'در حالِ آماده‌سازی',
  shipped: 'ارسال‌شده',
  delivered: 'تحویل‌شده',
  cancelled: 'لغوشده',
  refunded: 'مستردشده',
  returned: 'مرجوع‌شده',
};

/**
 * گذارهایِ مجاز.
 *
 * چرا برخی گذارها نیستند؟ چون هر کدام یک اشتباهِ واقعی است:
 *   • پرداخت‌نشده نمی‌تواند بسته‌بندی شود (کالا هنوز فروخته نشده)؛
 *   • ارسال‌شده به «بسته‌بندی» برنمی‌گردد (بسته رفته است)؛
 *   • تحویل‌شده تنها به «مرجوع‌شده» می‌رود.
 */
const TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  pending_payment: ['paid', 'cancelled'],
  paid: ['confirmed', 'packing', 'cancelled', 'refunded'],
  confirmed: ['packing', 'cancelled', 'refunded'],
  packing: ['shipped', 'confirmed', 'cancelled', 'refunded'],
  processing: ['packing', 'shipped', 'cancelled'],
  shipped: ['delivered', 'returned'],
  delivered: ['returned'],
  cancelled: [],
  refunded: [],
  returned: [],
};

export function canTransition(from: OrderStatus, to: OrderStatus): boolean {
  return TRANSITIONS[from]?.includes(to) ?? false;
}

/**
 * گذاری را می‌آزماید، یا با پیامی روشن رد می‌کند.
 *
 * پیام نامِ هر دو وضعیت را می‌گوید؛ چون «عملیات مجاز نیست» به دردِ
 * پشتیبان نمی‌خورد — او می‌خواهد بداند سفارش کجاست و باید چه کند.
 */
export function assertTransition(from: string, to: OrderStatus): void {
  const current = from as OrderStatus;
  if (!STATUS_LABEL[current]) {
    throw new AppError('VALIDATION', { message: `وضعیتِ سفارش ناشناس است: ${from}` });
  }
  if (!canTransition(current, to)) {
    throw new AppError('CONFLICT', {
      message: `سفارش در وضعیتِ «${STATUS_LABEL[current]}» است و نمی‌توان آن را به «${STATUS_LABEL[to]}» برد.`,
    });
  }
}

/** ترتیبِ نمایش در ردیفِ پیگیریِ مشتری */
export const TRACKING_STEPS: OrderStatus[] = [
  'pending_payment',
  'paid',
  'confirmed',
  'packing',
  'shipped',
  'delivered',
];

/**
 * جایِ یک وضعیت در ردیفِ پیگیری.
 *
 * برایِ اینکه مشتری بفهمد «کجایِ راه است»، نه فقط «چه وضعیتی دارد». مرجوعی
 * و لغو در این ردیف جایی ندارند: پایانِ راه‌اند، نه گامی از آن.
 */
export function trackingStep(status: string): number {
  return TRACKING_STEPS.indexOf(status as OrderStatus);
}
