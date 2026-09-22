import { Body, Controller, Get, Headers, HttpCode, Inject, Patch, Post, Query } from '@nestjs/common';

import { AppError } from '@set/shared-kernel';
import { EmailService, sendCheckDueReminders } from '@set/commerce';
import type { Database } from '@set/db';
import type { AccessControl } from '@set/rbac';
import type { AccessClaims, TokenService } from '@set/auth';

import { DB, TOKEN_SERVICE, ACCESS_CONTROL } from './tokens.js';

/**
 * مدیریت ایمیل — تنظیمات SMTP و صف
 *
 * فروشنده SMTP خود را تنظیم می‌کند و ایمیل‌های ارسال‌نشده را مدیریت می‌کند.
 */

@Controller('admin/email')
export class AdminEmailController {
  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(TOKEN_SERVICE) private readonly tokens: TokenService,
    @Inject(ACCESS_CONTROL) private readonly access: AccessControl,
  ) {}

  private async require(authorization: string | undefined): Promise<AccessClaims> {
    const token = authorization?.startsWith('Bearer ') ? authorization.slice(7) : undefined;
    if (!token) throw new AppError('UNAUTHENTICATED');
    const claims = await this.tokens.verifyAccess(token);
    if (!claims) throw new AppError('UNAUTHENTICATED');
    await this.access.assert({ userId: claims.sub, branchId: null }, 'settings', 'write');
    return claims;
  }

  /**
   * GET /admin/email/config — تنظیمات فعلی SMTP
   */
  @Get('config')
  async getConfig(@Headers('authorization') authorization: string | undefined) {
    await this.require(authorization);

    const { rows } = await this.db.query<{ value: string }>(
      `SELECT value FROM store_settings WHERE key = 'smtp_config'`,
    );

    if (!rows[0]?.value) {
      return { configured: false, config: null };
    }

    const cfg = JSON.parse(rows[0].value);
    // رمز عبور را مخفی کن
    return {
      configured: true,
      config: {
        host: cfg.host,
        port: cfg.port,
        secure: cfg.secure,
        user: cfg.user,
        from: cfg.from,
        passSet: !!cfg.pass,
      },
    };
  }

  /**
   * POST /admin/email/config — ذخیره تنظیمات SMTP
   */
  @Post('config')
  async saveConfig(
    @Body() body: Record<string, unknown>,
    @Headers('authorization') authorization: string | undefined,
  ) {
    await this.require(authorization);

    const host = String(body.host ?? '').trim();
    const port = Number(body.port ?? 587);
    const secure = body.secure === true;
    const user = String(body.user ?? '').trim();
    const pass = String(body.pass ?? '').trim();
    const from = String(body.from ?? '').trim();

    if (!host) throw new AppError('VALIDATION', { message: 'آدرس سرور SMTP را بنویسید.' });
    if (!from) throw new AppError('VALIDATION', { message: 'فرستنده را بنویسید.' });

    // اگر رمز جدید نداده، رمز قبلی را نگه دار
    let finalPass = pass;
    if (!pass) {
      const { rows } = await this.db.query<{ value: string }>(
        `SELECT value FROM store_settings WHERE key = 'smtp_config'`,
      );
      if (rows[0]?.value) {
        const old = JSON.parse(rows[0].value);
        finalPass = old.pass ?? '';
      }
    }

    const config = { host, port, secure, user, pass: finalPass, from };

    await this.db.query(
      `INSERT INTO store_settings (key, value, updated_at)
       VALUES ('smtp_config', $1, now())
       ON CONFLICT (key) DO UPDATE SET value = $1, updated_at = now()`,
      [JSON.stringify(config)],
    );

    return { message: 'تنظیمات SMTP ذخیره شد.' };
  }

  /**
   * POST /admin/email/test — ارسال ایمیل آزمایشی
   */
  @Post('test')
  async sendTest(
    @Body() body: Record<string, unknown>,
    @Headers('authorization') authorization: string | undefined,
  ) {
    await this.require(authorization);

    const to = String(body.to ?? '').trim();
    if (!to || !to.includes('@')) {
      throw new AppError('VALIDATION', { message: 'آدرس ایمیل معتبر بنویسید.' });
    }

    const svc = new EmailService(this.db);
    const ok = await svc.sendCustom(to, 'تست اتصال — فروشگاه', `
      <p>تبریک! اتصال SMTP شما به‌درستی کار می‌کند. 🎉</p>
      <p>از این پس نوتیفیکیشن‌های سفارش به مشتریان ارسال خواهد شد.</p>
    `);

    return { sent: ok, message: ok ? 'ایمیل تست ارسال شد.' : 'SMTP تنظیم نیست — ایمیل در صف ذخیره شد.' };
  }

  /**
   * GET /admin/email/queue — وضعیت صف
   */
  @Get('queue')
  async queueStats(@Headers('authorization') authorization: string | undefined) {
    await this.require(authorization);

    const stats = await this.db.query<{
      pending: string;
      sent_today: string;
      failed: string;
    }>(
      `SELECT
         COUNT(*) FILTER (WHERE sent_at IS NULL AND attempts < 3) AS pending,
         COUNT(*) FILTER (WHERE sent_at > now() - interval '1 day') AS sent_today,
         COUNT(*) FILTER (WHERE attempts >= 3 AND sent_at IS NULL) AS failed
       FROM email_queue`,
    );

    return {
      pending: Number(stats.rows[0]?.pending ?? 0),
      sentToday: Number(stats.rows[0]?.sent_today ?? 0),
      failed: Number(stats.rows[0]?.failed ?? 0),
    };
  }

  /**
   * POST /admin/email/flush — ارسال دستی صف
   */
  @Post('flush')
  async flush(@Headers('authorization') authorization: string | undefined) {
    await this.require(authorization);

    const svc = new EmailService(this.db);
    const sent = await svc.flushQueue(100);
    return { sent, message: `${sent} ایمیل ارسال شد.` };
  }

  /**
   * POST /admin/email/notify-order — ارسال نوتیفیکیشن سفارش
   */
  @Post('notify-order')
  async notifyOrder(
    @Body() body: Record<string, unknown>,
    @Headers('authorization') authorization: string | undefined,
  ) {
    await this.require(authorization);

    const orderNo = String(body.orderNo ?? '');
    const email = String(body.email ?? '');
    const type = String(body.type ?? 'order_confirmed');

    const svc = new EmailService(this.db);
    const ok = await svc.sendEvent(
      { type: type as any, orderNo, customerName: String(body.customerName ?? ''), total: Number(body.total ?? 0) },
      email,
    );

    return { sent: ok };
  }

  /**
   * POST /admin/email/check-due-reminders — یادآوری سررسید چک‌ها
   * باید هر روز توسط cron job فراخوانی شود.
   */
  @Post('check-due-reminders')
  @HttpCode(200)
  async checkDueReminders(@Headers('authorization') authorization: string | undefined) {
    await this.require(authorization);
    const result = await sendCheckDueReminders(this.db);
    return { ...result, message: `${result.sent} یادآوری ارسال شد.` };
  }
}