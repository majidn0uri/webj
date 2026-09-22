/**
 * مرجوعیِ مشتری و گارانتی — انواع و برچسب‌ها
 *
 * چرا این فایل جدا است؟ چون در مرجوعی، «نام‌ها» خودشان تصمیم‌اند: تفاوتِ
 * «انصراف» با «معیوب» فقط یک برچسب نیست، بلکه تعیین می‌کند مهلت چقدر است،
 * چه کسی هزینه‌ی رفت‌وبرگشت را می‌دهد، و آیا صورتحسابِ اصلاحی صادر می‌شود یا
 * نه. بی‌دقتی در این نام‌ها یعنی بی‌عدالتی در مبلغی که به مشتری برمی‌گردد.
 */

export type ReturnKind = 'withdrawal' | 'defective' | 'warranty' | 'wrong_item';

/** برچسبِ فارسیِ هر انگیزه — در رابط و پیامک به کار می‌رود */
export const RETURN_KINDS: Array<{ value: ReturnKind; label: string; hint: string }> = [
  {
    value: 'withdrawal',
    label: 'انصراف از خرید',
    hint: 'مشتری در مهلتِ قانونی و بی‌دلیل کالا را برمی‌گرداند',
  },
  {
    value: 'defective',
    label: 'کالای معیوب',
    hint: 'عیب از کالاست؛ محدود به مهلتِ ۷ روز نیست و کارمزد ندارد',
  },
  {
    value: 'warranty',
    label: 'ادعایِ گارانتی',
    hint: 'مهلت تا پایانِ گارانتی است و نیازمندِ بررسیِ مرکزِ خدمات',
  },
  {
    value: 'wrong_item',
    label: 'کالای اشتباه فرستاده‌شده',
    hint: 'خطایِ فروشنده؛ هزینه‌ی رفت‌وبرگشت با ماست',
  },
];

export type ReturnStatus =
  | 'requested'
  | 'approved'
  | 'rejected'
  | 'in_transit'
  | 'received'
  | 'inspecting'
  | 'refund_pending'
  | 'refunded'
  | 'closed'
  | 'cancelled';

export const RETURN_STATUS_LABELS: Record<ReturnStatus, string> = {
  requested: 'در انتظارِ بررسی',
  approved: 'تأییدشده',
  rejected: 'ردشده',
  in_transit: 'در راهِ بازگشت',
  received: 'رسیده به انبار',
  inspecting: 'در حالِ بازرسی',
  refund_pending: 'در انتظارِ بازگشتِ وجه',
  refunded: 'وجه برگشت داده شد',
  closed: 'بسته‌شده',
  cancelled: 'لغوشده',
};

/**
 * وضعیتِ کالا پس از بازرسی.
 *
 * این فهرست مستقیم به پول وصل است: «قابلِ فروش» یعنی کالا به قفسه برمی‌گردد و
 * بهای تمام‌شده برمی‌گردد؛ «آسیب‌دیده» یعنی نه — و بهایش همان‌جا در بهای
 * کالای فروخته‌شده می‌ماند. پس بازرسی یک دکمه‌یِ تشریفاتی نیست، یک تصمیمِ
 * مالی است.
 */
export type ItemCondition = 'unknown' | 'sellable' | 'opened' | 'damaged' | 'defective' | 'wrong_item';

export const ITEM_CONDITION_LABELS: Record<ItemCondition, string> = {
  unknown: 'بررسی‌نشده',
  sellable: 'سالم و قابلِ فروش',
  opened: 'بازشده اما سالم',
  damaged: 'آسیب‌دیده',
  defective: 'معیوب',
  wrong_item: 'اشتباه (مالِ ما نیست)',
};

export type RefundMethod = 'original' | 'bank_transfer' | 'store_credit' | 'exchange';

export const REFUND_METHOD_LABELS: Record<RefundMethod, string> = {
  original: 'به همان راهِ پرداخت',
  bank_transfer: 'واریز به حساب',
  store_credit: 'اعتبار در فروشگاه',
  exchange: 'تعویض با کالای دیگر',
};

export interface ReturnSettings {
  /** مهلتِ انصراف (روزِ تقویمی) */
  windowDays: number;
  /** پذیرشِ خودکارِ انصرافِ بی‌دلیل و بی‌نقص */
  autoApproveWithdrawal: boolean;
  /** کارمزدِ بازگشت برایِ انصراف، بر حسبِ ده‌هزارم (۵۰۰ = ۵٪) */
  restockFeeBp: number;
  /** مدتِ گارانتیِ پیش‌فرض برایِ کالایِ بی‌مدت (ماه) */
  warrantyDefaultMonths: number;
}

export interface ReturnRow {
  id: string;
  return_no: string;
  order_id: string;
  order_no?: string;
  user_id: string | null;
  branch_id: string | null;
  kind: ReturnKind;
  status: ReturnStatus;
  reason: string | null;
  customer_note: string | null;
  pickup_method: 'courier' | 'in_person';
  tracking_code: string | null;
  requested_at: string;
  decided_at: string | null;
  decided_by: string | null;
  decision_note: string | null;
  received_at: string | null;
  refunded_at: string | null;
  refund_method: RefundMethod | null;
  refund_rial: string;
  restock_fee_rial: string;
  entry_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface ReturnItemRow {
  id: string;
  return_id: string;
  order_item_id: string;
  variant_id: string;
  quantity: number;
  condition: ItemCondition;
  restock: boolean;
  refund_rial: string;
  note: string | null;
}

export interface ReturnEventRow {
  id: string;
  return_id: string;
  event_type: string;
  from_status: ReturnStatus | null;
  to_status: ReturnStatus | null;
  actor_id: string | null;
  note: string | null;
  created_at: string;
}

export interface WarrantyRow {
  id: string;
  order_item_id: string;
  order_id: string;
  variant_id: string;
  user_id: string | null;
  serial_no: string | null;
  provider: 'manufacturer' | 'store' | 'seller';
  starts_at: string;
  months: number;
  ends_at: string;
  status: 'active' | 'claimed' | 'expired' | 'void';
  notes: string | null;
}
