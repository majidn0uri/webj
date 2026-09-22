import { idpayIsSuccess, idpayMessage, maskPan } from './codes.js';
import type { GatewayConfig, PaymentGateway, StartPaymentRequest, StartPaymentResult, VerifyPaymentResult } from './types.js';

/**
 * آی‌دی‌پی — نسخه‌ی ۱.۱
 *
 * نشانی‌ها (طبقِ مستنداتِ رسمی):
 *   ایجاد تراکنش: POST https://api.idpay.ir/v1.1/payment
 *   تأیید تراکنش: POST https://api.idpay.ir/v1.1/payment/verify
 *   سرآیندها:     X-API-KEY و (در حالتِ تست) X-SANDBOX: 1
 *
 * تفاوت با زرین‌پال: اینجا «وضعیت» عددِ جداگانه‌ای دارد (status) که در پاسخِ
 * تأیید می‌آید، و مبلغ همیشه به ریال است.
 */
const BASE = 'https://api.idpay.ir';

interface IdpayCreateResponse {
  id?: string;
  link?: string;
  error_code?: number;
  error_message?: string;
}

interface IdpayVerifyResponse {
  status?: number;
  track_id?: string | number;
  id?: string;
  order_id?: string;
  amount?: string | number;
  date?: string | number;
  payment?: { track_id?: string | number; amount?: string | number; card_no?: string; hashed_card_no?: string; date?: string };
  verify?: { date?: number };
  error_code?: number;
  error_message?: string;
}

export class IdPayGateway implements PaymentGateway {
  readonly key = 'idpay' as const;
  readonly label = 'آی‌دی‌پی';

  isEnabled(config: GatewayConfig): boolean {
    return config.idpay.apiKey.length > 0;
  }

  async start(req: StartPaymentRequest, config: GatewayConfig): Promise<StartPaymentResult> {
    const json = await postJson(
      `${BASE}/v1.1/payment`,
      {
        order_id: req.orderNo,
        amount: Number(req.amountRial),
        callback: req.callbackUrl,
        desc: req.description.slice(0, 200),
        mail: req.email ?? undefined,
        phone: req.mobile ?? undefined,
      },
      config.idpay.sandbox,
    );

    const body = json as IdpayCreateResponse;
    if (body.error_code !== undefined || !body.id) {
      throw new Error(idpayMessage(undefined, body.error_code));
    }

    return {
      authority: body.id,
      redirectUrl: body.link ?? `${BASE}/p/ws-sandbox/${body.id}`,
      raw: json,
    };
  }

  async verify(input: {
    authority: string;
    amountRial: bigint;
    config: GatewayConfig;
    orderNo?: string;
  }): Promise<VerifyPaymentResult> {
    // آی‌دی‌پی برای تأیید هم id و هم order_id را می‌خواهد
    const json = await postJson(`${BASE}/v1.1/payment/verify`, {
      id: input.authority,
      order_id: input.orderNo ?? '',
    }, input.config.idpay.sandbox);

    const body = json as IdpayVerifyResponse;
    const ok = body.error_code === undefined && idpayIsSuccess(body.status);

    return {
      ok,
      refId: body.payment?.track_id != null ? String(body.payment.track_id) : body.track_id != null ? String(body.track_id) : null,
      cardPanMasked: body.payment?.card_no ? maskPan(body.payment.card_no) : null,
      code: body.status ?? body.error_code ?? null,
      message: idpayMessage(body.status, body.error_code),
      raw: json,
    };
  }
}

async function postJson(url: string, body: unknown, sandbox: boolean, timeoutMs = 12_000): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json',
        'X-API-KEY': process.env.IDPAY_API_KEY ?? '',
        ...(sandbox ? { 'X-SANDBOX': '1' } : {}),
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`پاسخِ نامعتبر از درگاه (${res.status})`);
    return (await res.json()) as unknown;
  } finally {
    clearTimeout(timer);
  }
}
