export type PaymentGatewayKey = 'sandbox' | 'zarinpal' | 'idpay';

export interface StartPaymentRequest {
  /** مبلغ به ریال — واحدِ ذخیره‌سازی در همه‌جایِ سامانه ریال است */
  amountRial: bigint;
  /** شماره‌ی سفارشِ خودمان (در آی‌دی‌پی order_id، در زرین‌پال در توضیحات) */
  orderNo: string;
  description: string;
  /** نشانی‌ای که درگاه مشتری را پس از پرداخت به آن برمی‌گرداند */
  callbackUrl: string;
  mobile?: string | null;
  email?: string | null;
}

export interface StartPaymentResult {
  /** شناسه‌ی تراکنش نزدِ درگاه */
  authority: string;
  /** نشانی‌ای که مرورگرِ مشتری باید به آن هدایت شود */
  redirectUrl: string;
  /** پاسخِ خامِ درگاه — برای ردیابیِ اختلاف‌ها */
  raw?: unknown;
}

export interface VerifyPaymentResult {
  ok: boolean;
  refId: string | null;
  cardPanMasked: string | null;
  /** کدِ عددیِ درگاه (در زرین‌پال ۱۰۰/۱۰۱، در آی‌دی‌پی ۱۰۰/۱۰۱) */
  code: number | null;
  /** پیامِ فارسیِ آماده برای نمایش به مشتری */
  message: string;
  raw?: unknown;
}

export interface GatewayConfig {
  /** کدام درگاه پیش‌فرض است */
  defaultGateway: PaymentGatewayKey;
  /** نشانیِ عمومیِ سایت (برای ساختنِ callback) */
  appUrl: string;
  zarinpal: { merchantId: string; currency: 'IRR' | 'IRT'; sandbox: boolean };
  idpay: { apiKey: string; sandbox: boolean };
  /** اجازه‌ی درگاهِ آزمایشی — در تولید باید خاموش باشد */
  allowSandbox: boolean;
}

/**
 * قراردادِ یک درگاه.
 *
 * چرا این لایه؟ چون در ایران چند درگاهِ رایج است (زرین‌پال، آی‌دی‌پی، زیبال،
 * درگاهِ مستقیمِ بانک) و هر کدام را می‌توان عوض کرد یا همزمان داشت. بقیه‌یِ
 * سامانه فقط این دو متد را می‌شناسد و از تفاوتِ درگاه‌ها بی‌خبر است.
 */
export interface PaymentGateway {
  readonly key: PaymentGatewayKey;
  /** نامِ نمایشی به فارسی */
  readonly label: string;
  /** آیا پیکربندی شده و می‌توان استفاده‌اش کرد؟ */
  isEnabled(config: GatewayConfig): boolean;
  start(req: StartPaymentRequest, config: GatewayConfig): Promise<StartPaymentResult>;
  /**
   * تأییدِ نهایی.
   * نکته‌ی حیاتی: درگاه‌های ایرانی «بازگشتِ مشتری» را تأییدِ پرداخت نمی‌دانند؛
   * فقط فراخوانیِ verify از سمتِ سرور پرداخت را قطعی می‌کند.
   */
  verify(input: {
    authority: string;
    amountRial: bigint;
    config: GatewayConfig;
    /** شماره‌ی سفارشِ خودمان — برخی درگاه‌ها (آی‌دی‌پی) برای تأیید لازم دارند */
    orderNo?: string;
    /** فقط برای درگاهِ آزمایشی: تصمیمی که کاربر در صفحه‌ی شبیه‌سازی گرفته */
    decision?: string | null;
  }): Promise<VerifyPaymentResult>;
}

/** خطایِ قابلِ نمایش به مشتری — پیام از پیش به فارسی ترجمه شده است */
export class PaymentError extends Error {
  constructor(
    message: string,
    readonly code: string = 'PAYMENT_FAILED',
    readonly gatewayCode?: number | string,
  ) {
    super(message);
    this.name = 'PaymentError';
  }
}
