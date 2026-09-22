import { Body, Controller, Get, Headers, HttpCode, Inject, Param, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import { AppError, formatToman } from '@set/shared-kernel';
import type { Database } from '@set/db';
import type { AccessControl } from '@set/rbac';
import type { AccessClaims, TokenService } from '@set/auth';
import { PosService } from '@set/pos';
import { enqueueSms } from '@set/commerce';
import { DB, TOKEN_SERVICE, ACCESS_CONTROL } from './tokens.js';

/**
 * صندوقِ فروشِ حضوری.
 *
 * تغییرِ مهم نسبت به نسخه‌ی پیشین: این مسیرها هیچ احرازِ هویتی نداشتند و
 * شناسه‌یِ کاربر را از بدنه‌ی درخواست می‌گرفتند — یعنی هر کسی می‌توانست
 * شیفت باز کند و «به نامِ هر کس» بفروشد. اکنون:
 *   • همه‌ی مسیرها توکنِ معتبر می‌خواهند (۴۰۱)،
 *   • همه‌ی مسیرها دسترسیِ pos.sell را بررسی می‌کنند (۴۰۳)،
 *   • شناسه‌ی کاربر همیشه از توکن می‌آید و هرگز از بدنه خوانده نمی‌شود.
 */

const OpenShiftDto = z.object({
  warehouseId: z.string().uuid(),
  branchId: z.string().uuid().nullish(),
  openingCashRial: z.string().default('0'),
});

const SellDto = z.object({
  items: z
    .array(z.object({ variantId: z.string().uuid(), quantity: z.number().int().positive() }))
    .min(1),
  paymentMethod: z.enum(['cash', 'card', 'card_to_card', 'cod', 'cheque']),
  /** شناسه‌یِ دستگاه برای جلوگیری از ثبتِ تکراری هنگامِ بازگشت از حالتِ آفلاین */
  offlineId: z.string().nullish(),
  customerMobile: z.string().nullish(),
  customerName: z.string().nullish(),
});

const MovementDto = z.object({
  type: z.enum(['payout', 'pickup', 'expense', 'float_in']),
  amountRial: z.string(),
  reason: z.string().nullish(),
});

const CloseShiftDto = z.object({
  countedCashRial: z.string(),
  note: z.string().nullish(),
});

@Controller('pos')
export class PosController {
  private readonly pos: PosService;

  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(TOKEN_SERVICE) private readonly tokens: TokenService,
    @Inject(ACCESS_CONTROL) private readonly access: AccessControl,
  ) {
    this.pos = new PosService(db);
  }

  /**
   * توکن معتبر + دسترسیِ صندوق؛ در غیر این صورت ۴۰۱ یا ۴۰۳.
   *
   * دو سطح عمداً از هم جدا شده‌اند:
   *   • `pos.read` — دیدنِ شیفت و ارقامِ فروش (کارِ حسابدار برای مغایرت‌گیری)؛
   *   • `pos.sell` — ثبتِ فروش، گشایش و بستنِ شیفت (کارِ فروشنده).
   * داشتنِ `pos.sell` مستلزمِ `pos.read` فرض می‌شود: هر که می‌فروشد، می‌بیند.
   */
  private async requirePos(
    authorization: string | undefined,
    action: 'read' | 'sell',
  ): Promise<AccessClaims> {
    const token = authorization?.startsWith('Bearer ') ? authorization.slice(7) : undefined;
    if (!token) throw new AppError('UNAUTHENTICATED');

    const claims = await this.tokens.verifyAccess(token);
    if (!claims) throw new AppError('UNAUTHENTICATED');

    if (action === 'read') {
      const canRead =
        (await this.access.can({ userId: claims.sub, branchId: null }, 'pos', 'read')) ||
        (await this.access.can({ userId: claims.sub, branchId: null }, 'pos', 'sell'));
      if (!canRead) {
        const { AppError: Err } = await import('@set/shared-kernel');
        throw new Err('FORBIDDEN', { details: { resource: 'pos', action, branch: null } });
      }
      return claims;
    }

    await this.access.assert({ userId: claims.sub, branchId: null }, 'pos', 'sell');
    return claims;
  }

  /** فهرستِ شیفت‌ها — برای اینکه پنل بتواند شیفتِ جاری را پیدا کند */
  @Get('shifts')
  async shifts(
    @Headers('authorization') authorization?: string,
    @Query('status') status?: string,
  ) {
    await this.requirePos(authorization, 'read');

    const wanted = status === 'closed' || status === 'open' ? status : 'open';

    const { rows } = await this.db.query<{
      id: string;
      status: string;
      opened_at: string;
      closed_at: string | null;
      opening_cash_rial: string;
      opened_by_name: string | null;
      sales_count: string;
      sales_total: string;
    }>(
      `SELECT s.id, s.status, s.opened_at, s.closed_at, s.opening_cash_rial,
              u.full_name AS opened_by_name,
              COALESCE((SELECT COUNT(*) FROM orders o
                         WHERE o.shift_id = s.id AND o.status = 'paid'), 0)::text AS sales_count,
              COALESCE((SELECT SUM(o.total_rial) FROM orders o
                         WHERE o.shift_id = s.id AND o.status = 'paid'), 0)::text AS sales_total
         FROM pos_shifts s
         LEFT JOIN users u ON u.id = s.opened_by
        WHERE s.status = $1
        ORDER BY s.opened_at DESC
        LIMIT 20`,
      [wanted],
    );

    return {
      count: rows.length,
      items: rows.map((r) => ({
        id: r.id,
        status: r.status,
        openedAt: r.opened_at,
        closedAt: r.closed_at,
        openedByName: r.opened_by_name,
        salesCount: Number(r.sales_count),
        salesTotalRial: r.sales_total,
        salesTotal: formatToman(BigInt(r.sales_total)),
        openingCash: formatToman(BigInt(r.opening_cash_rial)),
      })),
    };
  }

  @Post('shifts/open')
  async open(@Body() body: unknown, @Headers('authorization') authorization?: string) {
    const claims = await this.requirePos(authorization, 'sell');
    const input = OpenShiftDto.parse(body);

    return this.pos.openShift({
      warehouseId: input.warehouseId,
      // از توکن — هرگز از بدنه
      userId: claims.sub,
      branchId: input.branchId ?? null,
      openingCashRial: BigInt(input.openingCashRial),
    });
  }

  @Post('shifts/:id/sell')
  async sell(
    @Param('id') shiftId: string,
    @Body() body: unknown,
    @Headers('authorization') authorization?: string,
  ) {
    await this.requirePos(authorization, 'sell');
    const input = SellDto.parse(body);

    // پیدا کردنِ مشتری از شماره موبایل
    let customerId: string | null = null;
    if (input.customerMobile) {
      const { rows: cust } = await this.db.query<{ id: string }>(
        `SELECT id FROM customers WHERE phone = $1 LIMIT 1`, [input.customerMobile],
      );
      customerId = cust[0]?.id ?? null;
    }

    const sale = await this.pos.sell({ shiftId, ...input, customerId });

    // پیامکِ پرداخت + تأیید سفارش
    try {
      if (input.customerMobile) {
        await enqueueSms(this.db, {
          phone: input.customerMobile,
          templateKey: 'order_paid',
          vars: { order: sale.orderNo, amount: formatToman(BigInt(sale.totalRial)) },
        });
        await enqueueSms(this.db, {
          phone: input.customerMobile,
          templateKey: 'order_confirmed',
          vars: { order: sale.orderNo },
        });
      }
    } catch { /* پیامک نباید فروش را متوقف کند */ }

    return { ...sale, display: { total: formatToman(BigInt(sale.totalRial)) } };
  }

  @Post('shifts/:id/movement')
  @HttpCode(200)
  async movement(
    @Param('id') shiftId: string,
    @Body() body: unknown,
    @Headers('authorization') authorization?: string,
  ) {
    const claims = await this.requirePos(authorization, 'sell');
    const input = MovementDto.parse(body);

    await this.pos.addCashMovement({
      shiftId,
      type: input.type,
      amountRial: BigInt(input.amountRial),
      reason: input.reason ?? null,
      actorId: claims.sub,
    });
    return { ok: true };
  }

  @Post('shifts/:id/close')
  @HttpCode(200)
  async close(
    @Param('id') shiftId: string,
    @Body() body: unknown,
    @Headers('authorization') authorization?: string,
  ) {
    const claims = await this.requirePos(authorization, 'sell');
    const input = CloseShiftDto.parse(body);

    const closed = await this.pos.closeShift({
      shiftId,
      // از توکن — ثبت می‌شود که چه کسی صندوق را بسته است
      userId: claims.sub,
      countedCashRial: BigInt(input.countedCashRial),
      note: input.note ?? null,
    });

    return {
      ...closed,
      display: {
        expected: formatToman(BigInt(closed.expectedCashRial)),
        counted: formatToman(BigInt(closed.countedCashRial)),
        difference: formatToman(BigInt(closed.differenceRial)),
      },
    };
  }

  @Get('shifts/:id')
  async summary(@Param('id') shiftId: string, @Headers('authorization') authorization?: string) {
    await this.requirePos(authorization, 'read');

    const summary = await this.pos.shiftSummary(shiftId);
    if (!summary) throw new AppError('NOT_FOUND');
    return summary;
  }
}
