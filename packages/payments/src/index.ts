import type { Database, Queryable } from '@set/db';
import { AppError, type Rial } from '@set/shared-kernel';
import { OrderService } from '@set/orders';
import { IdPayGateway } from './idpay.js';
import { SandboxGateway } from './sandbox.js';
import { ZarinpalGateway } from './zarinpal.js';
import type {
  GatewayConfig,
  PaymentGateway,
  PaymentGatewayKey,
  StartPaymentResult,
  VerifyPaymentResult,
} from './types.js';

export * from './types.js';

/**
 * پرداختِ آنلاینِ ایرانی.
 *
 * سه تصمیمِ مهم که بقیه‌یِ این فایل بر اساسِ آن‌ها نوشته شده:
 *
 * ۱) «بازگشتِ مشتری از درگاه» به‌هیچ‌وجه به معنایِ پرداخت نیست. تنها چیزی که
 *    پرداخت را قطعی می‌کند، فراخوانیِ verify از سمتِ سرور است. پس اگر کاربر
 *    نشانی را دستکاری کند (callback?Status=OK)، سامانه باز هم از درگاه
 *    می‌پرسد و اگر درگاه نپذیرد، سفارش تسویه نمی‌شود.
 *
 * ۲) تأیید باید «یک‌بار مصرف» باشد. درگاه‌ها ممکن است یک تراکنش را دوبار
 *    برگردانند (کاربر دکمه‌ی بازگشت را می‌زند، یا درگاه دیر پاسخ می‌دهد و
 *    کاربر دوباره تلاش می‌کند). اگر اینجا قفلِ ردیف نباشد، ممکن است موجودی
 *    دو بار از انبار خارج شود یا دو سندِ حسابداری بنشیند. بنابراین ردیفِ
 *    پرداخت با SELECT … FOR UPDATE قفل می‌شود.
 *
 * ۳) تسویه‌یِ سفارش (خروجِ کالا از انبار + سندِ حسابداری) در همان تراکنشِ
 *    تأیید انجام می‌شود — نه بعد از آن. پس هیچ‌گاه «پول گرفته شده اما کالا
 *    از انبار نرفته» یا برعکس پیش نمی‌آید.
 */

export interface StartInput {
  orderId: string;
  gateway?: PaymentGatewayKey;
  appUrl: string;
  mobile?: string | null;
  email?: string | null;
}

export interface StartOutput extends StartPaymentResult {
  paymentId: string;
  gateway: PaymentGatewayKey;
  amountRial: string;
}

export interface PaymentStatusView {
  paymentId: string;
  orderNo: string;
  gateway: string;
  status: 'pending' | 'success' | 'failed';
  amountRial: string;
  refId: string | null;
  cardPanMasked: string | null;
  message: string | null;
  createdAt: string;
  verifiedAt: string | null;
}

export class PaymentService {
  private readonly gateways: Record<PaymentGatewayKey, PaymentGateway> = {
    sandbox: new SandboxGateway(),
    zarinpal: new ZarinpalGateway(),
    idpay: new IdPayGateway(),
  };

  constructor(private readonly db: Database) {}

  /**
   * پیکربندیِ مؤثر: متغیرهایِ محیط، سپس تنظیماتِ پایگاه.
   *
   * چرا پایگاه؟ چون مدیرِ فروشگاه باید بتواند کلیدِ درگاه را از پنل عوض کند؛
   * اگر فقط متغیرِ محیطی بود، هر تغییر یعنی دسترسی به سرور و راه‌اندازیِ
   * دوباره — یعنی همان وابستگی به برنامه‌نویس که قرار نبود باشد.
   *
   * اما یک قاعده‌ی امنیتی: پایگاه فقط می‌تواند **محدودتر** کند. اگر سرور در
   * حالتِ تولید بالا آمده و اجازه‌ی درگاهِ آزمایشی نداده، نوشتنِ «حالتِ
   * آزمایشی = بله» در پایگاه آن را روشن نمی‌کند. چرا؟ چون کسی که به پایگاه
   * دسترسی دارد نباید بتواند مقصدِ پول را با یک ردیف عوض کند.
   */
  async configFromDb(appUrl: string): Promise<GatewayConfig> {
    const base = this.config(appUrl);
    let stored = new Map<string, string>();
    try {
      const { rows } = await this.db.query<{ key: string; value: string }>(
        `SELECT key, value FROM store_settings
          WHERE key IN ('payment_gateway','payment_sandbox_mode','zarinpal_merchant_id','idpay_api_key')`,
      );
      stored = new Map(rows.map((r) => [r.key, r.value]));
    } catch {
      // جدول نباشد (مثلاً پایگاهِ آزمایشیِ بسیار کوچک) → همان پیکربندیِ محیطی؛
      // پرداخت نباید به‌خاطرِ نبودِ یک جدولِ تنظیمات از کار بیفتد.
      return base;
    }

    const gateway = stored.get('payment_gateway');
    const sandboxWanted = stored.get('payment_sandbox_mode') !== 'false';
    const merchantId = stored.get('zarinpal_merchant_id');
    const idpayKey = stored.get('idpay_api_key');

    return {
      ...base,
      defaultGateway:
        gateway === 'zarinpal' || gateway === 'idpay' || gateway === 'sandbox'
          ? gateway
          : base.defaultGateway,
      zarinpal: {
        ...base.zarinpal,
        merchantId: merchantId || base.zarinpal.merchantId,
        sandbox: base.zarinpal.sandbox && sandboxWanted,
      },
      idpay: {
        ...base.idpay,
        apiKey: idpayKey || base.idpay.apiKey,
        sandbox: base.idpay.sandbox && sandboxWanted,
      },
      allowSandbox: base.allowSandbox && sandboxWanted,
    };
  }

  /** پیکربندی از متغیرهایِ محیط — هیچ کلیدی در کد نیست */
  config(appUrl: string): GatewayConfig {
    const isProd = process.env.NODE_ENV === 'production';
    return {
      defaultGateway: (process.env.PAYMENT_GATEWAY as PaymentGatewayKey) ?? 'sandbox',
      appUrl,
      zarinpal: {
        merchantId: process.env.ZARINPAL_MERCHANT_ID ?? '',
        currency: process.env.ZARINPAL_CURRENCY === 'IRT' ? 'IRT' : 'IRR',
        sandbox: process.env.ZARINPAL_SANDBOX === '1',
      },
      idpay: {
        apiKey: process.env.IDPAY_API_KEY ?? '',
        sandbox: process.env.IDPAY_SANDBOX !== '0',
      },
      // در تولید، درگاهِ آزمایشی فقط با تأییدِ صریح فعال می‌شود
      allowSandbox: isProd ? process.env.PAYMENT_ALLOW_SANDBOX === '1' : true,
    };
  }

  /** درگاه‌هایی که مشتری می‌تواند انتخاب کند (فقط پیکربندی‌شده‌ها) */
  async availableGateways(appUrl: string): Promise<Array<{ key: PaymentGatewayKey; label: string; recommended?: boolean }>> {
    const config = await this.configFromDb(appUrl);
    const order: PaymentGatewayKey[] = ['zarinpal', 'idpay', 'sandbox'];
    return order
      .map((key) => ({ key, gateway: this.gateways[key] as PaymentGateway, recommended: key === config.defaultGateway }))
      .filter(({ gateway }) => gateway.isEnabled(config))
      .map(({ key, gateway, recommended }) => ({ key, label: gateway.label, recommended }));
  }

  /**
   * آغازِ پرداخت: ردیفِ پرداخت ساخته می‌شود و نشانیِ هدایت به درگاه برگردانده
   * می‌شود. سفارش در وضعیتِ pending_payment می‌ماند و موجودی همچنان رزرو است.
   */
  async start(input: StartInput): Promise<StartOutput> {
    const config = await this.configFromDb(input.appUrl);
    const gatewayKey = input.gateway ?? config.defaultGateway;
    const gateway = this.gateways[gatewayKey];
    if (!gateway) throw new AppError('VALIDATION', { message: 'درگاهِ پرداخت نامعتبر است.' });
    if (!gateway.isEnabled(config)) {
      throw new AppError('VALIDATION', { message: `درگاهِ «${gateway.label}» پیکربندی نشده است.` });
    }

    // سفارش را می‌خوانیم — مبلغ از پایگاه‌داده می‌آید، نه از مرورگر
    const { rows } = await this.db.query<{
      id: string;
      order_no: string;
      total_rial: string;
      status: string;
      customer_mobile: string | null;
      customer_name: string | null;
    }>(
      `SELECT id, order_no, total_rial, status, customer_mobile, customer_name
         FROM orders WHERE id = $1`,
      [input.orderId],
    );
    const order = rows[0];
    if (!order) throw new AppError('NOT_FOUND', { message: 'سفارش پیدا نشد.' });
    if (order.status === 'paid') {
      throw new AppError('CONFLICT', { message: 'این سفارش پیش از این پرداخت شده است.' });
    }
    if (order.status === 'cancelled') {
      throw new AppError('CONFLICT', { message: 'این سفارش لغو شده است.' });
    }

    const amountRial = BigInt(order.total_rial);
    const callbackUrl = `${input.appUrl}/pay/callback`;

    const result = await gateway.start(
      {
        amountRial,
        orderNo: order.order_no,
        description: `پرداختِ سفارش ${order.order_no} — ست‌شاپ`,
        callbackUrl,
        mobile: input.mobile ?? order.customer_mobile ?? null,
        email: input.email ?? null,
      },
      config,
    );

    const { rows: inserted } = await this.db.query<{ id: string }>(
      `INSERT INTO payments (order_id, amount_rial, method, gateway, status, authority, callback_url, gateway_response)
       VALUES ($1,$2,$3,$4,'pending',$5,$6,$7::jsonb)
       RETURNING id`,
      [
        input.orderId,
        amountRial.toString(),
        gatewayKey,
        gatewayKey,
        result.authority,
        callbackUrl,
        JSON.stringify({ start: result.raw ?? null, orderNo: order.order_no }),
      ],
    );

    return {
      paymentId: inserted[0]!.id,
      gateway: gatewayKey,
      amountRial: amountRial.toString(),
      authority: result.authority,
      redirectUrl: result.redirectUrl,
    };
  }

  /**
   * تأییدِ پرداخت.
   *
   * @param decision فقط برای درگاهِ آزمایشی است ('paid' | 'cancelled' | 'failed')
   */
  async verify(input: {
    authority: string;
    gateway?: PaymentGatewayKey;
    appUrl: string;
    decision?: string | null;
  }): Promise<{
    status: 'success' | 'failed' | 'already';
    orderNo: string;
    paymentId: string;
    refId: string | null;
    message: string;
  }> {
    const config = this.config(input.appUrl);

    return this.db.transaction(async (tx) => {
      // قفلِ ردیف: اگر دو درخواستِ همزمان برای یک authority بیاید، دومی صبر
      // می‌کند و سپس می‌بیند که کار انجام شده است.
      const { rows } = await tx.query<{
        id: string;
        order_id: string;
        gateway: string;
        amount_rial: string;
        status: string;
        ref_id: string | null;
        gateway_response: unknown;
      }>(
        `SELECT id, order_id, gateway, amount_rial, status, ref_id, gateway_response
           FROM payments WHERE authority = $1 FOR UPDATE`,
        [input.authority],
      );
      const payment = rows[0];
      if (!payment) throw new AppError('NOT_FOUND', { message: 'چنین تراکنشی ثبت نشده است.' });

      if (payment.status === 'success') {
        // تأییدِ تکراری: بی‌اثر و بی‌خطا (idempotent)
        const orderNo = await this.orderNo(tx, payment.order_id);
        return {
          status: 'already' as const,
          orderNo,
          paymentId: payment.id,
          refId: payment.ref_id,
          message: 'این پرداخت پیش از این تأیید شده است.',
        };
      }

      const gatewayKey = (input.gateway ?? payment.gateway) as PaymentGatewayKey;
      const gateway = this.gateways[gatewayKey];
      if (!gateway) throw new AppError('VALIDATION', { message: 'درگاهِ پرداخت نامعتبر است.' });

      const stored = (payment.gateway_response ?? {}) as { orderNo?: string; decision?: string };
      // تصمیمِ درگاهِ آزمایشی در خودِ ردیف است (توسطِ setSandboxDecision)؛
      // در درگاهِ واقعی این تصمیم را بانک می‌دهد و اینجا همیشه خالی است.
      const decision = input.decision ?? stored.decision ?? null;

      let result: VerifyPaymentResult;
      try {
        result = await gateway.verify({
          authority: input.authority,
          amountRial: BigInt(payment.amount_rial),
          config,
          orderNo: stored.orderNo ?? undefined,
          decision,
        });
      } catch (err) {
        // خطایِ شبکه/درگاه: پرداخت «ناموفق» نیست، «نامعلوم» است. پس وضعیت را
        // pending نگه می‌داریم تا بتوان دوباره تلاش کرد، و پیام را می‌دهیم.
        await tx.query(`UPDATE payments SET failure_code = $2, failure_message = $3 WHERE id = $1`, [
          payment.id,
          'GATEWAY_UNREACHABLE',
          err instanceof Error ? err.message : 'خطای ناشناخته',
        ]);
        throw new AppError('EXTERNAL_DEPENDENCY', {
          message: 'ارتباط با درگاه برقرار نشد. مبلغی کسر نشده است؛ دوباره تلاش کنید.',
          details: { gateway: gatewayKey, reason: err instanceof Error ? err.message : 'unknown' },
        });
      }

      if (!result.ok) {
        await tx.query(
          `UPDATE payments
              SET status = 'failed', failure_code = $2, failure_message = $3, gateway_response =
                  COALESCE(gateway_response, '{}'::jsonb) || $4::jsonb
            WHERE id = $1`,
          [
            payment.id,
            result.code != null ? String(result.code) : null,
            result.message,
            JSON.stringify({ verify: result.raw ?? null }),
          ],
        );
        const orderNo = await this.orderNo(tx, payment.order_id);
        return { status: 'failed' as const, orderNo, paymentId: payment.id, refId: null, message: result.message };
      }

      // --- پرداخت قطعی شد: تسویه‌یِ سفارش در همین تراکنش
      //     (خروجِ کالا از انبار + سندِ حسابداری + ثبتِ پرداخت)
      await new OrderService(this.db).confirmPaymentOn(tx, payment.order_id, {
        amountRial: BigInt(payment.amount_rial) as Rial,
        method: 'online', // پولِ درگاه به حسابِ بانکی می‌رود (۱۲۰۰)، نه صندوقِ حضوری (۱۱۰۰)
        referenceNo: result.refId ?? undefined,
        // همان ردیفی که درگاه ساخته تسویه می‌شود — ردیفِ دومی ساخته نمی‌شود،
        // وگرنه هر فروشِ آنلاین دو پرداخت در گزارش نشان می‌داد
        paymentId: payment.id,
        gateway: payment.gateway,
        cardPanMasked: result.cardPanMasked,
      });

      await tx.query(
        `UPDATE payments
            SET status = 'success', ref_id = $2, card_pan_masked = $3, verified_at = now(),
                failure_code = NULL, failure_message = NULL,
                gateway_response = COALESCE(gateway_response, '{}'::jsonb) || $4::jsonb
          WHERE id = $1`,
        [payment.id, result.refId, result.cardPanMasked, JSON.stringify({ verify: result.raw ?? null })],
      );

      const orderNo = await this.orderNo(tx, payment.order_id);
      return { status: 'success' as const, orderNo, paymentId: payment.id, refId: result.refId, message: result.message };
    });
  }

  /** ثبتِ تصمیم در درگاهِ آزمایشی (فقط در غیرِتولید) */
  async setSandboxDecision(authority: string, decision: 'paid' | 'cancelled' | 'failed'): Promise<void> {
    if (!this.config('').allowSandbox) {
      throw new AppError('FORBIDDEN', { message: 'درگاهِ آزمایشی غیرفعال است.' });
    }
    const { rows: touched } = await this.db.query<{ id: string }>(
      `UPDATE payments
          SET gateway_response = COALESCE(gateway_response, '{}'::jsonb) || jsonb_build_object('decision', $2::text)
        WHERE authority = $1 AND gateway = 'sandbox' AND status = 'pending'
        RETURNING id`,
      [authority, decision],
    );
    if (!touched.length) throw new AppError('NOT_FOUND', { message: 'تراکنشِ آزمایشی پیدا نشد یا پیش از این تعیین تکلیف شده است.' });
  }

  /** وضعیتِ یک پرداخت — برای صفحه‌ی نتیجه */
  async status(paymentId: string): Promise<PaymentStatusView> {
    const { rows } = await this.db.query<{
      id: string;
      order_no: string;
      gateway: string;
      status: string;
      amount_rial: string;
      ref_id: string | null;
      reference_no: string | null;
      card_pan_masked: string | null;
      failure_message: string | null;
      created_at: string;
      verified_at: string | null;
    }>(
      `SELECT p.id, o.order_no, p.gateway, p.status, p.amount_rial, p.ref_id, p.reference_no,
              p.card_pan_masked, p.failure_message, p.created_at, p.verified_at
         FROM payments p JOIN orders o ON o.id = p.order_id
        WHERE p.id = $1`,
      [paymentId],
    );
    const r = rows[0];
    if (!r) throw new AppError('NOT_FOUND', { message: 'پرداخت پیدا نشد.' });
    return {
      paymentId: r.id,
      orderNo: r.order_no,
      gateway: r.gateway,
      status: r.status as PaymentStatusView['status'],
      amountRial: r.amount_rial,
      refId: r.ref_id ?? r.reference_no,
      cardPanMasked: r.card_pan_masked,
      message: r.failure_message,
      createdAt: r.created_at,
      verifiedAt: r.verified_at,
    };
  }

  private async orderNo(db: Queryable, orderId: string): Promise<string> {
    const { rows } = await db.query<{ order_no: string }>(`SELECT order_no FROM orders WHERE id = $1`, [orderId]);
    return rows[0]?.order_no ?? '';
  }
}
