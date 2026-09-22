/**
 * ثبتِ خطاها (بخش Y) — هر خطای سامانه یک کدِ ثابت دارد.
 * هیچ خطایی بدون traceId به کاربر برنمی‌گردد، و هیچ خطای داخلی بدون لاگ نمی‌ماند.
 */
export const ERROR_CODES = {
  VALIDATION: { code: 'ERR-001', http: 400, fa: 'داده‌های ارسالی معتبر نیست.' },
  NOT_FOUND: { code: 'ERR-002', http: 404, fa: 'مورد درخواستی یافت نشد.' },
  FORBIDDEN: { code: 'ERR-003', http: 403, fa: 'شما اجازه‌ی انجام این کار را ندارید.' },
  UNAUTHENTICATED: { code: 'ERR-004', http: 401, fa: 'لطفاً وارد حساب کاربری خود شوید.' },
  CONFLICT: { code: 'ERR-005', http: 409, fa: 'وضعیت داده‌ها تغییر کرده است؛ دوباره تلاش کنید.' },
  OUT_OF_STOCK: { code: 'ERR-006', http: 409, fa: 'موجودی کافی نیست.' },
  PRICE_CHANGED: { code: 'ERR-007', http: 409, fa: 'قیمت کالا تغییر کرده است؛ سبد را بررسی کنید.' },
  PAYMENT_FAILED: { code: 'ERR-008', http: 402, fa: 'پرداخت ناموفق بود.' },
  IDEMPOTENCY_CONFLICT: { code: 'ERR-009', http: 409, fa: 'درخواست تکراری با داده‌ی متفاوت.' },
  RATE_LIMITED: { code: 'ERR-010', http: 429, fa: 'تعداد درخواست‌ها بیش از حد مجاز است.' },
  EXTERNAL_DEPENDENCY: { code: 'ERR-011', http: 503, fa: 'سرویس خارجی در دسترس نیست؛ عملیات در صف قرار گرفت.' },
  INVARIANT: { code: 'ERR-012', http: 422, fa: 'قانونی از قوانینِ کسب‌وکار نقض شده است.' },
  INTERNAL: { code: 'ERR-013', http: 500, fa: 'خطای داخلیِ سامانه.' },
} as const;

export type ErrorKey = keyof typeof ERROR_CODES;

export class AppError extends Error {
  readonly key: ErrorKey;
  readonly code: string;
  readonly http: number;
  readonly fa: string;
  readonly traceId?: string;
  readonly details?: unknown;

  constructor(key: ErrorKey, opts: { message?: string; traceId?: string; details?: unknown } = {}) {
    const def = ERROR_CODES[key];
    super(opts.message ?? def.fa);
    this.name = 'AppError';
    this.key = key;
    this.code = def.code;
    this.http = def.http;
    this.fa = def.fa;
    this.traceId = opts.traceId;
    this.details = opts.details;
  }

  toJSON() {
    return {
      error: {
        code: this.code,
        key: this.key,
        message: this.fa,
        details: this.details ?? null,
        traceId: this.traceId ?? null,
      },
    };
  }
}

export function isAppError(e: unknown): e is AppError {
  return e instanceof AppError;
}
