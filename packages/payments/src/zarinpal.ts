import { maskPan, zarinpalMessage } from './codes.js';
import type { GatewayConfig, PaymentGateway, StartPaymentRequest, StartPaymentResult, VerifyPaymentResult } from './types.js';

/**
 * زرین‌پال — REST نسخه‌ی ۴
 *
 * نشانی‌ها (طبقِ مستنداتِ رسمی):
 *   درخواست:  POST https://payment.zarinpal.com/pg/v4/payment/request.json
 *   هدایت:    GET  https://www.zarinpal.com/pg/StartPay/{authority}
 *   تأیید:    POST https://payment.zarinpal.com/pg/v4/payment/verify.json
 *   محیطِ تست: https://sandbox.zarinpal.com/...
 *
 * واحدِ پول: ریال به‌صورتِ پیش‌فرض؛ اگر currency=IRT باشد، مبلغ باید به تومان
 * فرستاده شود. ما در سامانه همه‌جا ریال داریم، پس یا IRR می‌فرستیم یا هنگامِ
 * IRT مبلغ را بر ۱۰ تقسیم می‌کنیم — این تصمیم در همین یک نقطه گرفته می‌شود.
 */
const REQUEST_PATH = '/pg/v4/payment/request.json';
const VERIFY_PATH = '/pg/v4/payment/verify.json';

interface ZarinpalRequestResponse {
  data?: { code?: number; message?: string; authority?: string; fee_type?: string; fee?: number };
  errors?: { code?: number; message?: string; validations?: Record<string, string> } | Record<string, unknown> | never[];
}

interface ZarinpalVerifyResponse {
  data?: {
    code?: number;
    message?: string;
    ref_id?: number;
    card_pan?: string;
    card_hash?: string;
    fee_type?: string;
    fee?: number;
  };
  errors?: { code?: number; message?: string } | never[];
}

export class ZarinpalGateway implements PaymentGateway {
  readonly key = 'zarinpal' as const;
  readonly label = 'زرین‌پال';

  private baseUrl(): string {
    return process.env.ZARINPAL_BASE_URL ?? 'https://payment.zarinpal.com';
  }

  private startPayUrl(authority: string): string {
    const base = this.baseUrl().includes('sandbox')
      ? 'https://sandbox.zarinpal.com'
      : 'https://www.zarinpal.com';
    return `${base}/pg/StartPay/${authority}`;
  }

  isEnabled(config: GatewayConfig): boolean {
    return config.zarinpal.merchantId.length > 0;
  }

  /** مبلغ را مطابقِ واحدِ درگاه می‌فرستیم */
  private amountForGateway(amountRial: bigint, config: GatewayConfig): number {
    return config.zarinpal.currency === 'IRT' ? Number(amountRial / 10n) : Number(amountRial);
  }

  async start(req: StartPaymentRequest, config: GatewayConfig): Promise<StartPaymentResult> {
    const body = {
      merchant_id: config.zarinpal.merchantId,
      amount: this.amountForGateway(req.amountRial, config),
      callback_url: req.callbackUrl,
      description: req.description.slice(0, 200),
      currency: config.zarinpal.currency,
      metadata: {
        mobile: req.mobile ?? undefined,
        email: req.email ?? undefined,
        order_no: req.orderNo,
      },
    };

    const json = (await postJson(`${this.baseUrl()}${REQUEST_PATH}`, body)) as ZarinpalRequestResponse;

    const errors = json.errors;
    const hasError = errors && (Array.isArray(errors) ? errors.length > 0 : true);
    if (hasError) {
      const code = Array.isArray(errors) ? -1 : Number((errors as { code?: number }).code ?? -1);
      throw new Error(zarinpalMessage(code));
    }

    const authority = json.data?.authority;
    if (!authority) throw new Error('درگاه پاسخی نداد؛ دوباره تلاش کنید.');

    return {
      authority,
      redirectUrl: this.startPayUrl(authority),
      raw: json,
    };
  }

  async verify(input: { authority: string; amountRial: bigint; config: GatewayConfig }): Promise<VerifyPaymentResult> {
    const body = {
      merchant_id: input.config.zarinpal.merchantId,
      amount: this.amountForGateway(input.amountRial, input.config),
      authority: input.authority,
    };

    const json = (await postJson(`${this.baseUrl()}${VERIFY_PATH}`, body)) as ZarinpalVerifyResponse;

    const code = Number(json.data?.code ?? -1);
    // ۱۰۰ = موفق؛ ۱۰۱ = پیش‌تر تأیید شده (هنوز «پرداخت شده» است، نه خطا)
    const ok = code === 100 || code === 101;

    return {
      ok,
      refId: json.data?.ref_id != null ? String(json.data.ref_id) : null,
      cardPanMasked: json.data?.card_pan ? maskPan(json.data.card_pan) : null,
      code,
      message: zarinpalMessage(code),
      raw: json,
    };
  }
}

/** فراخوانیِ شبکه با مهلتِ زمانی — درگاه نباید بتواند درخواست را معطل کند */
async function postJson(url: string, body: unknown, timeoutMs = 12_000): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`پاسخِ نامعتبر از درگاه (${res.status})`);
    return (await res.json()) as unknown;
  } finally {
    clearTimeout(timer);
  }
}
