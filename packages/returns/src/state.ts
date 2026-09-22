import { AppError } from '@set/shared-kernel';
import type { ReturnStatus } from './types.js';
import { RETURN_STATUS_LABELS } from './types.js';

/**
 * ماشینِ وضعیتِ مرجوعی.
 *
 * چرا یک ماشینِ وضعیتِ صریح؟ چون مرجوعی پول است که از جیبِ فروشگاه بیرون
 * می‌رود. اگر هر انتقالی مجاز باشد، یک اشتباهِ ساده (بازگشتِ وجهِ کالایی که
 * هنوز به انبار نرسیده) ممکن می‌شود — و کشفِ آن هفته‌ها طول می‌کشد. اینجا
 * مسیرِ مجاز نوشته شده و بقیه راه‌ها بسته است.
 *
 * اصلِ راهنما: «وجه فقط پس از بازرسیِ کالا برمی‌گردد.»
 * دلیلش روشن است: اگر پیش از رسیدنِ کالا پول را برگردانیم، دیگر هیچ ابزاری
 * برای پس‌گرفتنِ آن نداریم مگر پیگیریِ حقوقی.
 */
const TRANSITIONS: Record<ReturnStatus, readonly ReturnStatus[]> = {
  // درخواستِ تازه: یا پذیرفته می‌شود، یا رد، یا خودِ مشتری لغو می‌کند
  requested: ['approved', 'rejected', 'cancelled'],
  approved: ['in_transit', 'cancelled'],
  in_transit: ['received', 'cancelled'],
  received: ['inspecting', 'rejected'],
  inspecting: ['refund_pending', 'rejected'],
  refund_pending: ['refunded', 'closed'],
  refunded: ['closed'],
  // وضعیت‌هایِ پایانی
  closed: [],
  cancelled: [],
  rejected: ['closed'],
};

export function allowedTransitions(from: ReturnStatus): readonly ReturnStatus[] {
  return TRANSITIONS[from];
}

export function canTransition(from: ReturnStatus, to: ReturnStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export function assertTransition(from: ReturnStatus, to: ReturnStatus): void {
  if (!canTransition(from, to)) {
    const allowed = TRANSITIONS[from];
    const hint =
      allowed.length > 0
        ? `از «${RETURN_STATUS_LABELS[from]}» فقط می‌توان به ${allowed
            .map((s) => `«${RETURN_STATUS_LABELS[s]}»`)
            .join('، ')} رفت.`
        : `«${RETURN_STATUS_LABELS[from]}» وضعیتِ پایانی است.`;
    throw new AppError('CONFLICT', {
      message: `این تغییرِ وضعیت مجاز نیست: ${hint}`,
    });
  }
}

/** وضعیت‌هایی که دیگر تغییر نمی‌کنند */
export function isTerminal(status: ReturnStatus): boolean {
  return TRANSITIONS[status].length === 0;
}

/**
 * وضعیت‌هایی که در آن‌ها مرجوعی هنوز «باز» است و در کارتابلِ پشتیبان می‌آید.
 */
export const OPEN_STATUSES: readonly ReturnStatus[] = [
  'requested',
  'approved',
  'in_transit',
  'received',
  'inspecting',
  'refund_pending',
];

export function isOpen(status: ReturnStatus): boolean {
  return OPEN_STATUSES.includes(status);
}
