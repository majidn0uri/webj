import { maskPan } from './codes.js';
import type { GatewayConfig, PaymentGateway, StartPaymentRequest, StartPaymentResult, VerifyPaymentResult } from './types.js';

/**
 * درگاهِ آزمایشی (سندباکسِ داخلی).
 *
 * چرا به جایِ اتصال به اینترنت، یک درگاهِ شبیه‌سازی‌شده‌ی داخلی داریم؟
 *   ۱) توسعه و تست در ایران، بدونِ دسترسی به درگاهِ واقعی و بدونِ پولِ واقعی؛
 *   ۲) همه‌ی مسیرِ واقعی طی می‌شود: رفتن به درگاه ← بازگشت ← تأییدِ سمتِ سرور؛
 *      فقط «صفحه‌ی بانک» به‌جایِ بانک، صفحه‌ی خودمان است؛
 *   ۳) هیچ وابستگیِ خارجی: سایت با اینترنتِ داخلی هم کامل کار می‌کند.
 *
 * تفاوت با درگاهِ واقعی در یک چیز است: نتیجه‌ی پرداخت را کاربر در صفحه‌ی
 * شبیه‌سازی تعیین می‌کند (پرداخت موفق / انصراف / خطا). در درگاهِ واقعی این را
 * بانک تعیین می‌کند. بقیه‌یِ سامانه تفاوتی نمی‌بیند.
 */
export class SandboxGateway implements PaymentGateway {
  readonly key = 'sandbox' as const;
  readonly label = 'درگاهِ آزمایشی (بدون پولِ واقعی)';

  isEnabled(config: GatewayConfig): boolean {
    return config.allowSandbox;
  }

  async start(req: StartPaymentRequest, config: GatewayConfig): Promise<StartPaymentResult> {
    const serial = Math.random().toString(36).slice(2, 10).toUpperCase();
    const authority = `SBX${Date.now().toString(36).toUpperCase()}${serial}`;
    return {
      authority,
      // صفحه‌ی شبیه‌سازیِ بانک — خودمان میزبانش هستیم
      redirectUrl: `${config.appUrl}/pay/sandbox/${authority}`,
      raw: { simulated: true, orderNo: req.orderNo, amountRial: req.amountRial.toString() },
    };
  }

  async verify(input: {
    authority: string;
    amountRial: bigint;
    config: GatewayConfig;
    decision?: string | null;
  }): Promise<VerifyPaymentResult> {
    // تصمیم را سامانه از پایگاه‌داده می‌خواند و اینجا به درگاه می‌دهد؛
    // در درگاهِ واقعی این تصمیم را بانک می‌دهد، نه پایگاه‌داده.
    switch (input.decision) {
      case 'paid':
        return {
          ok: true,
          refId: `SIM${Math.floor(Math.random() * 9_000_000 + 1_000_000)}`,
          cardPanMasked: maskPan('6037991123451234'),
          code: 100,
          message: 'پرداخت با موفقیت شبیه‌سازی شد.',
          raw: { simulated: true, decision: 'paid' },
        };
      case 'cancelled':
        return { ok: false, refId: null, cardPanMasked: null, code: -22, message: 'شما از پرداخت انصراف دادید.', raw: { simulated: true } };
      case 'failed':
        return {
          ok: false,
          refId: null,
          cardPanMasked: null,
          code: -51,
          message: 'پرداخت ناموفق بود (شبیه‌سازی). هیچ مبلغی کسر نشده است.',
          raw: { simulated: true },
        };
      default:
        return {
          ok: false,
          refId: null,
          cardPanMasked: null,
          code: -11,
          message: 'نتیجه‌ای برای این تراکنش ثبت نشده است.',
          raw: { simulated: true },
        };
    }
  }
}
