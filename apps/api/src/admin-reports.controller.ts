import { Controller, Get, Headers, Inject, Query } from '@nestjs/common';
import { AppError, parseJalali, formatJalali } from '@set/shared-kernel';
import type { Database } from '@set/db';
import type { AccessControl } from '@set/rbac';
import type { AccessClaims, TokenService } from '@set/auth';
import {
  cachedReport,
  debtors,
  grossProfit,
  stockTurnover,
  type GrossProfitGrouping,
} from '@set/reports';
import { DB, TOKEN_SERVICE, ACCESS_CONTROL } from './tokens.js';

/**
 * گزارش‌هایِ مدیریتی — سودِ ناخالص، گردشِ موجودی، سنِ بدهی.
 *
 * سه قاعده در این مسیرها:
 *
 *   ۱) دسترسی جدا است (`reports.read`): حاشیه‌یِ سودِ شرکت و سنِ بدهیِ
 *      مشتریان به کارِ فروشنده ربطی ندارد. فروشنده این مسیرها را نمی‌بیند.
 *   ۲) تاریخ‌ها را کاربر شمسی می‌فرستد (۱۴۰۵/۰۶/۲۰) و پایگاه میلادی
 *      می‌خواهد؛ تبدیل در یک‌جا انجام می‌شود تا هر مسیری سازِ خود را نزند.
 *      تاریخِ نامعتبر خطایِ روشن می‌دهد، نه یک بازه‌یِ تصادفی.
 *   ۳) خروجیِ سنگین در میانگیر است (`report_cache`). کلیدِ میانگیر همه‌ی
 *      فیلترها را در خود دارد؛ پس تغییرِ هر فیلتر نتیجه‌یِ تازه می‌سازد و
 *      عددِ کهنه جایِ تازه نشان داده نمی‌شود.
 */

/** تاریخ را از ورودیِ کاربر می‌خواند: شمسی (۱۴۰۵/۰۶/۲۰) یا میلادی (ISO) */
function toDate(input: string | undefined, fallback: Date, endOfDay = false): Date {
  if (!input) return fallback;
  const jalali = parseJalali(input);
  if (jalali) {
    if (endOfDay) {
      // انتهایِ روزِ شمسی: فردا، منهایِ یک میلی‌ثانیه (بازه ناشمول است)
      const next = new Date(jalali.getTime() + 24 * 60 * 60 * 1000);
      return new Date(next.getTime() - 1);
    }
    return jalali;
  }
  const iso = new Date(input);
  if (!Number.isNaN(iso.getTime())) return iso;
  throw new AppError('VALIDATION', {
    message: `تاریخ نامعتبر است: «${input}». تاریخ را شمسی وارد کنید، مثلِ ${formatJalali(new Date())}`,
  });
}

@Controller('admin/reports')
export class AdminReportsController {
  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(TOKEN_SERVICE) private readonly tokens: TokenService,
    @Inject(ACCESS_CONTROL) private readonly access: AccessControl,
  ) {}

  /** فقط کسی که دسترسیِ «مشاهده‌ی گزارش‌های مدیریتی» دارد */
  private async requireReports(authorization: string | undefined): Promise<AccessClaims> {
    const token = authorization?.startsWith('Bearer ') ? authorization.slice(7) : undefined;
    if (!token) throw new AppError('UNAUTHENTICATED');
    const claims = await this.tokens.verifyAccess(token);
    if (!claims) throw new AppError('UNAUTHENTICATED');
    await this.access.assert({ userId: claims.sub, branchId: null }, 'reports', 'read');
    return claims;
  }

  /** سودِ ناخالص در یک بازه، به تفکیکِ کالا / برند / نوع / روز */
  @Get('gross-profit')
  async grossProfit(
    @Headers('authorization') authorization: string | undefined,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('groupBy') groupBy?: string,
    @Query('branchId') branchId?: string,
    @Query('channel') channel?: string,
    @Query('rebuild') rebuild?: string,
  ) {
    await this.requireReports(authorization);

    const now = new Date();
    const toDate_ = toDate(to, now, true);
    const fromDate_ = toDate(
      from,
      new Date(toDate_.getTime() - 30 * 24 * 60 * 60 * 1000),
      false,
    );

    if (fromDate_.getTime() >= toDate_.getTime()) {
      throw new AppError('VALIDATION', {
        message: 'تاریخِ آغاز باید پیش از تاریخِ پایان باشد.',
      });
    }

    const grouping: GrossProfitGrouping =
      groupBy === 'brand' || groupBy === 'product_type' || groupBy === 'day'
        ? groupBy
        : 'variant';

    const result = await cachedReport(this.db, {
      reportKey: 'gross_profit',
      periodKey: [
        fromDate_.toISOString().slice(0, 10),
        toDate_.toISOString().slice(0, 10),
        grouping,
        branchId ?? 'all',
        channel ?? 'all',
      ].join('|'),
      rebuild: rebuild === '1' || rebuild === 'true',
      build: async () => {
        const payload = await grossProfit(this.db, {
          from: fromDate_,
          to: toDate_,
          groupBy: grouping,
          branchId: branchId ?? null,
          channel: channel === 'web' || channel === 'pos' ? channel : null,
        });
        return { payload, rowCount: payload.rows.length };
      },
    });

    return {
      report: result.payload,
      meta: {
        cached: result.cached,
        generatedAt: result.generatedAt.toISOString(),
        buildMs: result.buildMs,
      },
    };
  }

  /** گردشِ موجودی: هر کالا چند روز دوام می‌آورد و چقدر سرمایه خوابانده */
  @Get('stock-turnover')
  async stockTurnover(
    @Headers('authorization') authorization: string | undefined,
    @Query('windowDays') windowDays?: string,
    @Query('warehouseId') warehouseId?: string,
    @Query('rebuild') rebuild?: string,
  ) {
    await this.requireReports(authorization);

    const days = Math.min(Math.max(Number(windowDays ?? 90) || 90, 7), 730);
    const result = await cachedReport(this.db, {
      reportKey: 'stock_turnover',
      periodKey: `${days}|${warehouseId ?? 'all'}`,
      rebuild: rebuild === '1' || rebuild === 'true',
      build: async () => {
        const payload = await stockTurnover(this.db, {
          windowDays: days,
          warehouseId: warehouseId ?? null,
        });
        return { payload, rowCount: payload.rows.length };
      },
    });

    return {
      report: result.payload,
      meta: {
        cached: result.cached,
        generatedAt: result.generatedAt.toISOString(),
        buildMs: result.buildMs,
      },
    };
  }

  /** سنِ بدهی: چه کسی چقدر و چقدر دیر بدهکار است + بدهیِ خودمان */
  @Get('debtors')
  async debtors(
    @Headers('authorization') authorization: string | undefined,
    @Query('creditTermDays') creditTermDays?: string,
    @Query('branchId') branchId?: string,
    @Query('rebuild') rebuild?: string,
  ) {
    await this.requireReports(authorization);

    const term = Math.min(Math.max(Number(creditTermDays ?? 30) || 30, 0), 365);
    const result = await cachedReport(this.db, {
      reportKey: 'debtors',
      periodKey: `${term}|${branchId ?? 'all'}`,
      rebuild: rebuild === '1' || rebuild === 'true',
      build: async () => {
        const payload = await debtors(this.db, {
          creditTermDays: term,
          branchId: branchId ?? null,
        });
        return { payload, rowCount: payload.rows.length };
      },
    });

    return {
      report: result.payload,
      meta: {
        cached: result.cached,
        generatedAt: result.generatedAt.toISOString(),
        buildMs: result.buildMs,
      },
    };
  }
}
