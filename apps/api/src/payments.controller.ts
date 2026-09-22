import { Body, Controller, Get, Headers, Inject, Param, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import { AppError, formatToman } from '@set/shared-kernel';
import { PaymentService } from '@set/payments';
import { enqueueSms } from '@set/commerce';
import type { Database } from '@set/db';
import type { AccessControl } from '@set/rbac';
import type { AccessClaims, TokenService } from '@set/auth';
import { DB, TOKEN_SERVICE, ACCESS_CONTROL, CONFIG } from './tokens.js';
import type { AppConfig } from './config.js';

const StartDto = z.object({
  orderId: z.string().uuid(),
  gateway: z.enum(['sandbox', 'zarinpal', 'idpay']).optional(),
  mobile: z.string().nullish(),
  email: z.string().email().nullish(),
});

const VerifyDto = z.object({
  authority: z.string().min(6),
  gateway: z.enum(['sandbox', 'zarinpal', 'idpay']).optional(),
  /** فقط برای درگاهِ آزمایشی */
  decision: z.enum(['paid', 'cancelled', 'failed']).nullish(),
});

const DecisionDto = z.object({ decision: z.enum(['paid', 'cancelled', 'failed']) });

/**
 * آیا درگاهِ آزمایشی (شبیه‌سازِ پرداخت) در این محیط اجازه دارد؟
 *
 * این قاعده **دو جا** خوانده می‌شود و باید یکی باشد:
 *   • این‌جا، تا درخواستِ نامشروع پیش از هر خواندن از پایگاه برگردد؛
 *   • `PaymentService.config()`، که خودِ سرویس هم با آن درگاه را می‌سازد.
 *
 * اگر دو قاعده جدا نوشته شوند، محیطِ توسعه قربانی است: در این مخزن یک‌بار
 * نگهبان `PAYMENT_ALLOW_SANDBOX=1` را حتی در `development` می‌خواست، در حالی که
 * سرویس و `docs/pardakht-iran.md` آن را باز می‌دانستند — یعنی صفحهٔ «پرداختِ
 * آزمایشی»یِ فروشگاه ۴۰۳ می‌داد و نخستین آزمونِ پرداختِ هر تازه‌وارد شکست
 * می‌خورد. پس یک تابع، دو مصرف‌کننده، و آزمونِ **تطابقِ** این دو در
 * `payments.controller.test.ts`.
 */
export function sandboxAllowed(config: { PAYMENT_ALLOW_SANDBOX: boolean; NODE_ENV: string }): boolean {
  return config.PAYMENT_ALLOW_SANDBOX || config.NODE_ENV !== 'production';
}

/**
 * درگاهِ پرداخت.
 *
 * دو مسیرِ حساس:
 *   • POST /payments/start   — ساختِ تراکنش و گرفتنِ نشانیِ هدایت
 *   • POST /payments/verify  — تأییدِ قطعی نزدِ درگاه (فقط از سمتِ سرور)
 *
 * مسیرِ دوم را مرورگر مستقیماً صدا نمی‌زند؛ صفحه‌ی بازگشتِ فروشگاه (Route
 * Handler در Next) آن را فراخوانی می‌کند تا مشتری نتواند با دستکاریِ نشانی
 * وانمود کند پرداخت کرده است.
 */
@Controller('payments')
export class PaymentsController {
  private readonly payments: PaymentService;

  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(CONFIG) private readonly config: AppConfig,
    @Inject(TOKEN_SERVICE) private readonly tokens: TokenService,
    @Inject(ACCESS_CONTROL) private readonly access: AccessControl,
  ) {
    this.payments = new PaymentService(db);
  }

  /**
   * نشانیِ فروشگاه — **همیشه** از تنظیماتِ سرور.
   *
   * پیش از این، نشانیِ بازگشت می‌توانست در بدنه‌یِ درخواست بیاید
   * (`appUrl`). یعنی هر کس می‌توانست درگاه را به نشانیِ خودش برگرداند:
   * مشتری پس از پرداخت به سایتی می‌رسید که شبیهِ فروشگاه است، و نشانیِ
   * `callback` تراکنش هم به دستِ همان می‌افتاد. این همان «تغییر مسیرِ باز»
   * است، با یک تفاوتِ بدتر: در اینجا پایِ پول در میان است.
   *
   * نشانی باید از پیکربندی بیاید، نه از درخواست — درست مانندِ این‌که مبلغ را
   * از مشتری نمی‌پرسیم.
   */
  private appUrl(): string {
    return this.config.APP_URL.replace(/\/$/, '');
  }

  private requireInternal(token: string | undefined): void {
    if (this.config.NODE_ENV === 'production' && (!this.config.INTERNAL_API_TOKEN || token !== this.config.INTERNAL_API_TOKEN)) {
      throw new AppError('UNAUTHENTICATED');
    }
    if (this.config.INTERNAL_API_TOKEN && token !== this.config.INTERNAL_API_TOKEN) {
      throw new AppError('UNAUTHENTICATED');
    }
  }

  /**
   * توکن را می‌خواند و دسترسی را وارسی می‌کند (همان قراردادِ دیگرِ مسیرهایِ
   * پنل): بی‌توکن ۴۰۱، بی‌دسترسی ۴۰۳.
   */
  private async requireUser(
    authorization: string | undefined,
    resource: string,
    action: string,
  ): Promise<AccessClaims> {
    const token = authorization?.startsWith('Bearer ') ? authorization.slice(7) : undefined;
    if (!token) throw new AppError('UNAUTHENTICATED');

    const claims = await this.tokens.verifyAccess(token);
    if (!claims) throw new AppError('UNAUTHENTICATED');

    await this.access.assert({ userId: claims.sub, branchId: null }, resource, action);
    return claims;
  }

  /** درگاه‌هایی که پیکربندی شده‌اند — برای نمایشِ گزینه‌ها در صفحه‌ی تسویه */
  @Get('gateways')
  async gateways() {
    const svc = new PaymentService(this.db);
    return { gateways: await svc.availableGateways(this.appUrl()) };
  }

  @Post('start')
  start(@Headers('x-set-internal') internalToken: string | undefined, @Body() body: unknown) {
    this.requireInternal(internalToken);
    const dto = StartDto.parse(body ?? {});
    const svc = new PaymentService(this.db);
    return svc.start({
      orderId: dto.orderId,
      gateway: dto.gateway,
      appUrl: this.appUrl(),
      mobile: dto.mobile ?? null,
      email: dto.email ?? null,
    });
  }

  @Post('verify')
  async verify(@Body() body: unknown) {
    const dto = VerifyDto.parse(body ?? {});
    const svc = new PaymentService(this.db);
    const result = await svc.verify({
      authority: dto.authority,
      gateway: dto.gateway,
      appUrl: this.appUrl(),
      decision: dto.decision ?? null,
    });

    // پیامکِ پرداختِ موفقِ آنلاین
    if (result.status === 'success') {
      try {
        const { rows: orderInfo } = await this.db.query<{ customer_mobile: string | null; order_no: string; total_rial: string }>(
          `SELECT o.customer_mobile, o.order_no, o.total_rial::text
             FROM orders o JOIN payments p ON p.order_id = o.id
            WHERE p.id = $1`, [result.paymentId],
        );
        if (orderInfo[0]?.customer_mobile) {
          await enqueueSms(this.db, {
            phone: orderInfo[0].customer_mobile,
            templateKey: 'order_paid',
            vars: { order: orderInfo[0].order_no, amount: formatToman(BigInt(orderInfo[0].total_rial)) },
          });
          // پیامک تأیید سفارش
          await enqueueSms(this.db, {
            phone: orderInfo[0].customer_mobile,
            templateKey: 'order_confirmed',
            vars: { order: orderInfo[0].order_no },
          });
        }
      } catch { /* پیامک نباید تأیید پرداخت را متوقف کند */ }
    }

    return result;
  }

  /**
   * اطلاعاتِ کمینه‌ی یک تراکنش بر اساسِ authority.
   * چرا لازم است؟ چون برخی درگاه‌ها هنگامِ بازگشت فقط همین شناسه را می‌دهند
   * (مثلاً صفحه‌ی شبیه‌سازی) و ما باید مبلغ/شماره‌ی سفارش را نشان دهیم.
   * authority رشته‌ای با آنتروپیِ بالاست، پس نشانی حدس‌زدنی نیست.
   */
  @Get('authority/:authority')
  byAuthority(
    @Headers('x-set-internal') internalToken: string | undefined,
    @Param('authority') authority: string,
  ) {
    this.requireInternal(internalToken);
    return this.db
      .query<{ id: string; order_no: string; amount_rial: string; gateway: string; status: string }>(
        `SELECT p.id::text AS id, o.order_no, p.amount_rial::text, p.gateway, p.status
           FROM payments p JOIN orders o ON o.id = p.order_id
          WHERE p.authority = $1`,
        [authority],
      )
      .then(({ rows }) => {
        const r = rows[0];
        if (!r) return null;
        return { paymentId: r.id, orderNo: r.order_no, amountRial: r.amount_rial, gateway: r.gateway, status: r.status };
      });
  }

  /** وضعیتِ پرداخت — صفحه‌ی نتیجه با این مسیر نتیجه را نشان می‌دهد */
  @Get('status/:id')
  status(@Headers('x-set-internal') internalToken: string | undefined, @Param('id') id: string) {
    this.requireInternal(internalToken);
    const svc = new PaymentService(this.db);
    return svc.status(id);
  }

  /**
   * تعیینِ نتیجه در درگاهِ آزمایشی.
   * در تولید این مسیر در دسترس نیست (سرویس آن را رد می‌کند).
   */
  @Post('sandbox/:authority/decision')
  decide(@Param('authority') authority: string, @Body() body: unknown) {
    // سرویس هم همین را بررسی می‌کند؛ رد کردن در اینجا یعنی درخواستِ
    // نامشروع پیش از هر خواندن از پایگاه بازمی‌گردد.
    //
    // قاعده باید همان قاعدهٔ `PaymentService` باشد (تولید: فقط با کلیدِ صریح،
    // توسعه/آزمون: همیشه). پیش‌تر این‌جا تنها `PAYMENT_ALLOW_SANDBOX` را
    // می‌خواند و پیش‌فرضش «۰» بود — یعنی رویِ machineِ تازه‌نصب، با این‌که
    // خودِ سرویس و `docs/pardakht-iran.md` درگاهِ آزمایشی را روشن می‌دانستند،
    // صفحهٔ «پرداختِ آزمایشی»یِ storefront ۴۰۳ می‌گرفت و اولین تستِ پرداختِ
    // هر تازه‌وارد با «اجازه ندارید» تمام می‌شد.
    if (!sandboxAllowed(this.config)) {
      throw new AppError('FORBIDDEN', { message: 'درگاهِ آزمایشی غیرفعال است (در تولید: PAYMENT_ALLOW_SANDBOX=1).' });
    }
    const dto = DecisionDto.parse(body ?? {});
    const svc = new PaymentService(this.db);
    return svc.setSandboxDecision(authority, dto.decision).then(() => ({ ok: true }));
  }

  /**
   * فهرستِ پرداخت‌ها برای پنل — **تنها با احراز و مجوزِ مالی**.
   *
   * چرا این بررسی اینجا افتاده بود؟ چون مسیر زیرِ `/admin/` نیست، پس در
   * نگاشتِ «مسیرهایِ مدیریتی» هم نمی‌آمد؛ اما محتوایش از هر گزارشِ مالی
   * حساس‌تر است: مبلغ، شماره‌یِ سفارش، شناسه‌یِ پیگیری و چهار رقمِ آخرِ
   * کارتِ همه‌یِ مشتریان. نبودِ بررسی یعنی یک درخواستِ ساده‌یِ ناشناس کلِ
   * تاریخچه‌یِ تراکنش‌هایِ فروشگاه را برمی‌گرداند.
   */
  @Get()
  async list(
    @Headers('authorization') authorization: string | undefined,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
    @Query('status') status?: string,
    @Query('gateway') gateway?: string,
  ) {
    await this.requireUser(authorization, 'report', 'financial.view');
    const take = Math.min(Number(limit ?? 50) || 50, 200);
    const skip = Math.max(Number(offset ?? 0) || 0, 0);
    const conditions: string[] = [];
    const params: unknown[] = [];
    let i = 1;
    if (status) {
      conditions.push(`p.status = $${i++}`);
      params.push(status);
    }
    if (gateway) {
      conditions.push(`p.gateway = $${i++}`);
      params.push(gateway);
    }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    return this.db
      .query<Record<string, unknown>>(
        `SELECT p.id, p.order_id, o.order_no, p.amount_rial::text, p.gateway, p.status,
                p.authority, p.ref_id, p.card_pan_masked, p.failure_code, p.failure_message,
                p.created_at, p.verified_at
           FROM payments p JOIN orders o ON o.id = p.order_id
           ${where}
          ORDER BY p.created_at DESC
          LIMIT ${take} OFFSET ${skip}`,
        params,
      )
      .then(({ rows }) => ({ payments: rows, count: rows.length }));
  }
}
