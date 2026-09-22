import { Body, Controller, Get, Headers, HttpCode, Inject, Param, Post, Query, Res } from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import { z } from 'zod';
import { AppError, formatToman } from '@set/shared-kernel';
import type { Database } from '@set/db';
import { AccountingService, periodOf } from '@set/accounting';
import { renderInvoicePdf } from '@set/exports';
import type { AccessControl } from '@set/rbac';
import type { AccessClaims, TokenService } from '@set/auth';
import { DB, TOKEN_SERVICE, ACCESS_CONTROL } from './tokens.js';

/**
 * پنلِ حسابداری — مسیرهایِ خواندن و نوشتنِ دفترکل.
 *
 * دو نکته‌ی امنیتی که این فایل آن‌ها را اصلاح می‌کند:
 *
 *  ۱) مسیرهایِ قدیمیِ `/accounting/*` هیچ احرازِ هویتی نداشتند؛ هر کسی
 *     می‌توانست سندِ حسابداری ثبت کند یا کلِ دفترکل را بخواند. اکنون هر مسیر
 *     دو بررسی دارد: توکنِ معتبر، و اجازه‌ی `accounting.read` / `accounting.write`.
 *
 *  ۲) «چه کسی سند را ثبت کرد» از بدنه‌ی درخواست گرفته نمی‌شود؛ از `claims.sub`
 *     می‌آید. در غیر این صورت هر کاربری می‌توانست سند را به نامِ دیگری ثبت کند
 *     و ردِ حسابرسی بی‌ارزش می‌شد.
 */

/* ---------------------------------- قراردادها ---------------------------------- */

/** مبالغ به‌صورتِ رشته جابه‌جا می‌شوند: عددِ جاوااسکریپت برای BIGINT کافی نیست */
const Money = z.string().regex(/^-?\d+$/, 'مبلغ باید یک عددِ صحیح (ریال) باشد');

const JournalDto = z.object({
  description: z.string().min(3, 'شرحِ سند دست‌کم ۳ نویسه است'),
  lines: z
    .array(
      z.object({
        accountCode: z.string().min(3),
        debitRial: Money.default('0'),
        creditRial: Money.default('0'),
        description: z.string().max(300).nullish(),
      }),
    )
    .min(2, 'هر سند دست‌کم دو ردیف دارد'),
});

const ReverseDto = z.object({
  entryId: z.string().uuid(),
  reason: z.string().min(3, 'دلیلِ برگشت دست‌کم ۳ نویسه است'),
});

const PurchaseDto = z.object({
  supplierName: z.string().min(2),
  supplierNationalId: z.string().nullish(),
  supplierEconomicCode: z.string().nullish(),
  supplierPostalCode: z.string().nullish(),
  supplierInvoiceNo: z.string().nullish(),
  issuedAt: z.string().nullish(),
  dueAt: z.string().nullish(),
  warehouseId: z.string().uuid(),
  items: z
    .array(
      z.object({
        variantId: z.string().uuid(),
        quantity: z.number().int().positive(),
        unitCostRial: Money,
      }),
    )
    .min(1),
  extraCostRial: Money.nullish(),
  vatRial: Money.nullish(),
});

const PageQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(30),
  offset: z.coerce.number().int().min(0).default(0),
});

const JournalQuery = PageQuery.extend({
  period: z.string().regex(/^\d{6}$/).nullish(),
  referenceType: z.string().max(32).nullish(),
  q: z.string().max(120).nullish(),
});

const LedgerQuery = z.object({
  accountCode: z.string().min(3),
  from: z.string().nullish(),
  to: z.string().nullish(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
});

const PeriodQuery = z.object({ period: z.string().regex(/^\d{6}$/).nullish() });

/** نوعِ ماهیتِ حساب: کدام طرف، مانده‌ی «عادی» حساب است */
const DEBIT_NATURE = new Set(['asset', 'expense']);

function signedBalance(type: string, debit: bigint, credit: bigint): bigint {
  return DEBIT_NATURE.has(type) ? debit - credit : credit - debit;
}

/** فقط بخشِ تاریخِ یک رشته‌ی ISO — برای مقایسه‌ی تاریخِ شمسی در پایگاه‌داده */
function toDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

@Controller('admin/accounting')
export class AdminAccountingController {
  private readonly accounting: AccountingService;

  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(TOKEN_SERVICE) private readonly tokens: TokenService,
    @Inject(ACCESS_CONTROL) private readonly access: AccessControl,
  ) {
    this.accounting = new AccountingService(db);
  }

  /**
   * احرازِ هویت + اجازه. نبودِ توکن ← ۴۰۱، نبودِ اجازه ← ۴۰۳.
   * پیش‌فرض روی `accounting.read` است؛ مسیرهایِ نوشتن صریحاً `write` می‌خواهند.
   */
  private async requireUser(
    authorization: string | undefined,
    action: 'read' | 'write' = 'read',
  ): Promise<AccessClaims> {
    const token = authorization?.startsWith('Bearer ') ? authorization.slice(7) : undefined;
    if (!token) throw new AppError('UNAUTHENTICATED');

    const claims = await this.tokens.verifyAccess(token);
    if (!claims) throw new AppError('UNAUTHENTICATED');

    await this.access.assert({ userId: claims.sub, branchId: null }, 'accounting', action);
    return claims;
  }

  /* ================================ خواندن ================================ */

  /** مانده‌ی هر حساب — یک‌جا، با ماهیتِ حساب (بدهکار/بستانکار) لحاظ شده */
  private async accountBalances(): Promise<
    Array<{ code: string; name: string; type: string; debit: bigint; credit: bigint; balance: bigint }>
  > {
    const { rows } = await this.db.query<{
      code: string; name: string; type: string; debit: string; credit: string;
    }>(
      `SELECT a.code, a.name, a.type,
              COALESCE(SUM(jl.debit_rial), 0)::text  AS debit,
              COALESCE(SUM(jl.credit_rial), 0)::text AS credit
         FROM accounts a
         LEFT JOIN journal_lines jl ON jl.account_id = a.id
        WHERE a.is_active = true
        GROUP BY a.code, a.name, a.type
        ORDER BY a.code`,
    );

    return rows.map((r) => {
      const debit = BigInt(r.debit);
      const credit = BigInt(r.credit);
      return { code: r.code, name: r.name, type: r.type, debit, credit, balance: signedBalance(r.type, debit, credit) };
    });
  }

  /** پیشخوانِ حسابداری: شش عددی که حسابدار اولِ صبح می‌خواهد */
  @Get('summary')
  async summary(@Headers('authorization') authorization?: string) {
    await this.requireUser(authorization);

    const accounts = await this.accountBalances();
    const by = (code: string) => accounts.find((a) => a.code === code)?.balance ?? 0n;
    const sum = (type: string) =>
      accounts.filter((a) => a.type === type).reduce((acc, a) => acc + a.balance, 0n);

    const { rows: entryRows } = await this.db.query<{ n: string; last_no: string | null }>(
      `SELECT COUNT(*)::text AS n, MAX(entry_no) AS last_no FROM journal_entries`,
    );

    const { rows: valueRows } = await this.db.query<{ v: string; q: string }>(
      `SELECT COALESCE(SUM(quantity * avg_cost_rial), 0)::text AS v,
              COALESCE(SUM(quantity), 0)::text AS q
         FROM inventory_valuation`,
    );

    const revenue = sum('revenue');
    const cogs = by('5000');
    const expenses = sum('expense');
    const net = revenue - cogs - expenses;

    return {
      period: periodOf(new Date()),
      entries: Number(entryRows[0]?.n ?? 0),
      lastEntryNo: entryRows[0]?.last_no ?? null,
      totals: {
        debit: accounts.reduce((a, x) => a + x.debit, 0n).toString(),
        credit: accounts.reduce((a, x) => a + x.credit, 0n).toString(),
      },
      balances: {
        cash: by('1100').toString(),
        bank: by('1200').toString(),
        inventory: by('1000').toString(),
        vatCredit: by('1300').toString(),
        payables: by('2000').toString(),
        revenue: revenue.toString(),
        cogs: cogs.toString(),
        expenses: expenses.toString(),
        net: net.toString(),
      },
      display: {
        cash: formatToman(by('1100')),
        bank: formatToman(by('1200')),
        inventory: formatToman(by('1000')),
        vatCredit: formatToman(by('1300')),
        payables: formatToman(by('2000')),
        revenue: formatToman(revenue),
        net: formatToman(net),
      },
      stock: {
        quantity: Number(valueRows[0]?.q ?? '0'),
        valueRial: valueRows[0]?.v ?? '0',
        display: formatToman(BigInt(valueRows[0]?.v ?? '0')),
      },
    };
  }

  /** درختِ حساب‌ها (کد، نام، نوع، مانده) */
  @Get('accounts')
  async accounts(@Headers('authorization') authorization?: string) {
    await this.requireUser(authorization);
    const rows = await this.accountBalances();

    return {
      count: rows.length,
      items: rows.map((r) => ({
        code: r.code,
        name: r.name,
        type: r.type,
        debitRial: r.debit.toString(),
        creditRial: r.credit.toString(),
        balanceRial: r.balance.toString(),
        display: {
          debit: formatToman(r.debit),
          credit: formatToman(r.credit),
          balance: formatToman(r.balance),
        },
      })),
    };
  }

  /** ترازِ آزمایشی — جمعِ بدهکار باید با جمعِ بستانکار برابر باشد */
  @Get('trial-balance')
  async trialBalance(@Headers('authorization') authorization?: string) {
    await this.requireUser(authorization);
    const tb = await this.accounting.trialBalance();

    return {
      ...tb,
      display: {
        debit: formatToman(BigInt(tb.totals.debit)),
        credit: formatToman(BigInt(tb.totals.credit)),
      },
    };
  }

  /**
   * ترازنامه: دارایی = بدهی + حقوقِ صاحبانِ سهام.
   *
   * سود (یا زیانِ) دوره هنوز به حسابِ سرمایه منتقل نشده، پس در اینجا به‌صورتِ
   * «سودِ انباشته» به حقوقِ صاحبانِ سهام اضافه می‌شود — در غیر این صورت
   * ترازنامه همیشه نامتوازن به‌نظر می‌رسید، بی‌آنکه اشکالی در دفاتر باشد.
   */
  @Get('balance-sheet')
  async balanceSheet(@Headers('authorization') authorization?: string) {
    await this.requireUser(authorization);
    const accounts = await this.accountBalances();

    const group = (type: string) =>
      accounts
        .filter((a) => a.type === type)
        .map((a) => ({
          code: a.code,
          name: a.name,
          balanceRial: a.balance.toString(),
          display: formatToman(a.balance),
        }));

    const total = (type: string) =>
      accounts.filter((a) => a.type === type).reduce((acc, a) => acc + a.balance, 0n);

    const assets = total('asset');
    const liabilities = total('liability');
    const equity = total('equity');
    const net = total('revenue') - total('expense');
    const equityWithNet = equity + net;
    const totalLiabilitiesAndEquity = liabilities + equityWithNet;

    return {
      assets: { items: group('asset'), totalRial: assets.toString(), display: formatToman(assets) },
      liabilities: {
        items: group('liability'),
        totalRial: liabilities.toString(),
        display: formatToman(liabilities),
      },
      equity: {
        items: group('equity'),
        periodNetRial: net.toString(),
        periodNetDisplay: formatToman(net),
        totalRial: equityWithNet.toString(),
        display: formatToman(equityWithNet),
      },
      totalLiabilitiesAndEquity: {
        totalRial: totalLiabilitiesAndEquity.toString(),
        display: formatToman(totalLiabilitiesAndEquity),
      },
      balanced: assets === totalLiabilitiesAndEquity,
      differenceRial: (assets - totalLiabilitiesAndEquity).toString(),
    };
  }

  /** سود و زیان برای یک دوره‌ی شمسی (پیش‌فرض: همه‌ی دوره‌ها) */
  @Get('profit-loss')
  async profitLoss(
    @Headers('authorization') authorization?: string,
    @Query('period') period?: string,
  ) {
    await this.requireUser(authorization);
    const q = PeriodQuery.parse({ period });
    // محاسبه در لایه‌ی دامنه انجام می‌شود: آن‌جا معلوم است که بهای کالای
    // فروخته‌شده نباید دو بار از درآمد کسر شود
    return this.accounting.profitLoss(q.period ?? undefined);
  }

  /** دفترِ روزنامه: فهرستِ اسناد با ردیف‌هایشان */
  @Get('journal')
  async journal(
    @Headers('authorization') authorization?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
    @Query('period') period?: string,
    @Query('referenceType') referenceType?: string,
    @Query('q') q?: string,
  ) {
    await this.requireUser(authorization);
    const query = JournalQuery.parse({ limit, offset, period, referenceType, q });

    const params: unknown[] = [query.limit, query.offset];
    const conditions: string[] = [];

    if (query.period) {
      params.push(query.period);
      conditions.push(`period = $${params.length}`);
    }
    if (query.referenceType) {
      params.push(query.referenceType);
      conditions.push(`reference_type = $${params.length}`);
    }
    if (query.q) {
      params.push(`%${query.q}%`);
      conditions.push(`(entry_no ILIKE $${params.length} OR description ILIKE $${params.length})`);
    }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const { rows: entries } = await this.db.query<{
      id: string; entry_no: string; description: string; reference_type: string | null;
      status: string; posted_at: string; period: string | null;
    }>(
      `SELECT id, entry_no, description, reference_type, status, posted_at, period
         FROM journal_entries
         ${where}
        ORDER BY posted_at DESC, entry_no DESC
        LIMIT $1 OFFSET $2`,
      params,
    );

    const ids = entries.map((e) => e.id);
    // ردیف‌ها در یک پرس‌وجویِ جدا می‌آیند، نه در حلقه —
    // الگویِ N+1 در دفترکل یعنی باز شدنِ یک سند صدها پرس‌وجو می‌فرستد.
    const { rows: lines } = ids.length
      ? await this.db.query<{
          entry_id: string; account_code: string; account_name: string;
          debit_rial: string; credit_rial: string; description: string | null;
        }>(
          `SELECT jl.entry_id, a.code AS account_code, a.name AS account_name,
                  jl.debit_rial::text, jl.credit_rial::text, jl.description
             FROM journal_lines jl
             JOIN accounts a ON a.id = jl.account_id
            WHERE jl.entry_id = ANY($1::uuid[])
            ORDER BY jl.debit_rial DESC, a.code`,
          [ids],
        )
      : { rows: [] };

    const grouped = new Map<string, Array<{
      accountCode: string; accountName: string;
      debitRial: string; creditRial: string;
      debit: string; credit: string; description: string | null;
    }>>();
    for (const l of lines) {
      const list = grouped.get(l.entry_id) ?? [];
      list.push({
        accountCode: l.account_code,
        accountName: l.account_name,
        debitRial: l.debit_rial,
        creditRial: l.credit_rial,
        debit: formatToman(BigInt(l.debit_rial)),
        credit: formatToman(BigInt(l.credit_rial)),
        description: l.description,
      });
      grouped.set(l.entry_id, list);
    }

    const { rows: totalRows } = await this.db.query<{ n: string }>(
      `SELECT COUNT(*)::text AS n FROM journal_entries ${where}`,
      conditions.length ? params.slice(2) : [],
    );

    return {
      total: Number(totalRows[0]?.n ?? 0),
      count: entries.length,
      items: entries.map((e) => {
        const entryLines = grouped.get(e.id) ?? [];
        const debit = entryLines.reduce((a, l) => a + BigInt(l.debitRial), 0n);
        return {
          id: e.id,
          entryNo: e.entry_no,
          description: e.description,
          referenceType: e.reference_type,
          status: e.status,
          postedAt: e.posted_at,
          period: e.period,
          lines: entryLines,
          totalRial: debit.toString(),
          display: { total: formatToman(debit) },
        };
      }),
    };
  }

  /**
   * دفترِ کلِ یک حساب: هر ردیف با مانده‌ی انباشته (گردشِ حساب).
   *
   * مانده در پایگاه‌داده محاسبه نمی‌شود چون نیاز به تابعِ پنجره‌ای و
   * مرتب‌سازیِ پایدار دارد؛ در حافظه با BIGINT انجام می‌شود، پس هیچ
   * خطایِ اعشاری در مبالغ راه نمی‌یابد.
   */
  @Get('ledger')
  async ledger(
    @Headers('authorization') authorization?: string,
    @Query('accountCode') accountCode?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('limit') limit?: string,
  ) {
    await this.requireUser(authorization);
    const q = LedgerQuery.parse({ accountCode, from, to, limit });

    const { rows: accountRows } = await this.db.query<{ id: string; name: string; type: string }>(
      `SELECT id, name, type FROM accounts WHERE code = $1`,
      [q.accountCode],
    );
    const account = accountRows[0];
    if (!account) throw new AppError('NOT_FOUND', { message: `حسابِ ${q.accountCode} تعریف نشده است.` });

    const params: unknown[] = [account.id, q.limit];
    let dateFilter = '';
    if (q.from) {
      params.push(q.from);
      dateFilter += ` AND je.posted_at >= $${params.length}::timestamptz`;
    }
    if (q.to) {
      params.push(q.to);
      dateFilter += ` AND je.posted_at < ($${params.length}::date + 1)`;
    }

    const { rows } = await this.db.query<{
      entry_id: string; entry_no: string; description: string;
      posted_at: string; debit_rial: string; credit_rial: string; line_description: string | null;
    }>(
      `SELECT je.id AS entry_id, je.entry_no, je.description, je.posted_at,
              jl.debit_rial::text, jl.credit_rial::text, jl.description AS line_description
         FROM journal_lines jl
         JOIN journal_entries je ON je.id = jl.entry_id
        WHERE jl.account_id = $1${dateFilter}
        ORDER BY je.posted_at ASC, je.entry_no ASC
        LIMIT $2`,
      params,
    );

    let running = 0n;
    const debitNature = DEBIT_NATURE.has(account.type);

    const items = rows.map((r) => {
      const debit = BigInt(r.debit_rial);
      const credit = BigInt(r.credit_rial);
      running += debitNature ? debit - credit : credit - debit;
      return {
        entryId: r.entry_id,
        entryNo: r.entry_no,
        description: r.line_description ?? r.description,
        postedAt: r.posted_at,
        debitRial: debit.toString(),
        creditRial: credit.toString(),
        balanceRial: running.toString(),
        display: {
          debit: formatToman(debit),
          credit: formatToman(credit),
          balance: formatToman(running),
        },
      };
    });

    const totals = rows.reduce(
      (acc, r) => ({
        debit: acc.debit + BigInt(r.debit_rial),
        credit: acc.credit + BigInt(r.credit_rial),
      }),
      { debit: 0n, credit: 0n },
    );

    return {
      account: { code: q.accountCode, name: account.name, type: account.type },
      count: items.length,
      totals: {
        debitRial: totals.debit.toString(),
        creditRial: totals.credit.toString(),
        balanceRial: running.toString(),
        display: {
          debit: formatToman(totals.debit),
          credit: formatToman(totals.credit),
          balance: formatToman(running),
        },
      },
      items,
    };
  }

  /** فاکتورهایِ خرید — جدیدترین‌ها اول */
  @Get('purchases')
  async purchases(
    @Headers('authorization') authorization?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    await this.requireUser(authorization);
    const q = PageQuery.parse({ limit, offset });

    const { rows } = await this.db.query<{
      id: string; invoice_no: string; supplier_name: string;
      subtotal_rial: string; extra_cost_rial: string; vat_rial: string;
      total_rial: string; payable_rial: string;
      supplier_national_id: string | null; supplier_invoice_no: string | null;
      issued_at: string | null; created_at: string; warehouse: string | null;
    }>(
      `SELECT pi.id, pi.invoice_no, pi.supplier_name,
              pi.subtotal_rial::text, pi.extra_cost_rial::text, pi.vat_rial::text,
              pi.total_rial::text, pi.payable_rial::text,
              pi.supplier_national_id, pi.supplier_invoice_no, pi.issued_at,
              pi.created_at, w.name AS warehouse
         FROM purchase_invoices pi
         LEFT JOIN warehouses w ON w.id = pi.warehouse_id
        ORDER BY pi.created_at DESC
        LIMIT $1 OFFSET $2`,
      [q.limit, q.offset],
    );

    const { rows: totalRows } = await this.db.query<{ n: string }>(
      `SELECT COUNT(*)::text AS n FROM purchase_invoices`,
    );

    return {
      total: Number(totalRows[0]?.n ?? 0),
      count: rows.length,
      items: rows.map((r) => ({
        id: r.id,
        invoiceNo: r.invoice_no,
        supplierName: r.supplier_name,
        supplierNationalId: r.supplier_national_id,
        supplierInvoiceNo: r.supplier_invoice_no,
        issuedAt: r.issued_at,
        createdAt: r.created_at,
        warehouse: r.warehouse,
        subtotalRial: r.subtotal_rial,
        extraCostRial: r.extra_cost_rial,
        vatRial: r.vat_rial,
        totalRial: r.total_rial,
        payableRial: r.payable_rial,
        display: {
          subtotal: formatToman(BigInt(r.subtotal_rial)),
          extraCost: formatToman(BigInt(r.extra_cost_rial)),
          vat: formatToman(BigInt(r.vat_rial)),
          total: formatToman(BigInt(r.total_rial)),
          payable: formatToman(BigInt(r.payable_rial)),
        },
      })),
    };
  }

  /** جزئیاتِ یک فاکتورِ خرید با ردیف‌ها و بهای تمام‌شده‌ی هر ردیف */
  @Get('purchases/:id')
  async purchaseDetail(@Headers('authorization') authorization?: string, @Param('id') id?: string) {
    await this.requireUser(authorization);
    if (!id || !z.string().uuid().safeParse(id).success) {
      throw new AppError('VALIDATION', { message: 'شناسه‌ی فاکتور معتبر نیست.' });
    }

    const { rows } = await this.db.query<{
      id: string; invoice_no: string; supplier_name: string;
      supplier_national_id: string | null; supplier_economic_code: string | null;
      supplier_invoice_no: string | null; issued_at: string | null; due_at: string | null;
      subtotal_rial: string; extra_cost_rial: string; vat_rial: string;
      total_rial: string; payable_rial: string; warehouse: string | null;
    }>(
      `SELECT pi.id, pi.invoice_no, pi.supplier_name, pi.supplier_national_id,
              pi.supplier_economic_code, pi.supplier_invoice_no, pi.issued_at, pi.due_at,
              pi.subtotal_rial::text, pi.extra_cost_rial::text, pi.vat_rial::text,
              pi.total_rial::text, pi.payable_rial::text, w.name AS warehouse
         FROM purchase_invoices pi
         LEFT JOIN warehouses w ON w.id = pi.warehouse_id
        WHERE pi.id = $1`,
      [id],
    );

    const invoice = rows[0];
    if (!invoice) throw new AppError('NOT_FOUND', { message: 'فاکتوری با این شناسه نیست.' });

    const { rows: items } = await this.db.query<{
      variant_id: string; sku: string; product_title: string;
      quantity: number; unit_cost_rial: string; extra_cost_rial: string;
      vat_rial: string; total_cost_rial: string;
    }>(
      `SELECT pii.variant_id, pv.sku, p.title AS product_title,
              pii.quantity, pii.unit_cost_rial::text, pii.extra_cost_rial::text,
              pii.vat_rial::text, pii.total_cost_rial::text
         FROM purchase_invoice_items pii
         JOIN product_variants pv ON pv.id = pii.variant_id
         JOIN products p ON p.id = pv.product_id
        WHERE pii.invoice_id = $1
        ORDER BY p.title`,
      [id],
    );

    return {
      ...invoice,
      warehouse: invoice.warehouse,
      items: items.map((i) => ({
        variantId: i.variant_id,
        sku: i.sku,
        product: i.product_title,
        quantity: i.quantity,
        unitCostRial: i.unit_cost_rial,
        extraCostRial: i.extra_cost_rial,
        vatRial: i.vat_rial,
        totalCostRial: i.total_cost_rial,
        display: {
          unitCost: formatToman(BigInt(i.unit_cost_rial)),
          total: formatToman(BigInt(i.total_cost_rial)),
          vat: formatToman(BigInt(i.vat_rial)),
        },
      })),
      display: {
        subtotal: formatToman(BigInt(invoice.subtotal_rial)),
        vat: formatToman(BigInt(invoice.vat_rial)),
        total: formatToman(BigInt(invoice.total_rial)),
        payable: formatToman(BigInt(invoice.payable_rial)),
      },
    };
  }

  /** PDF فاکتور خرید */
  @Get('purchases/:id/pdf')
  async purchaseInvoicePdf(
    @Param('id') id: string,
    @Headers('authorization') authorization: string | undefined,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    await this.requireUser(authorization);
    if (!id || !z.string().uuid().safeParse(id).success) {
      throw new AppError('VALIDATION', { message: 'شناسه‌ی فاکتور معتبر نیست.' });
    }

    const { rows } = await this.db.query<{
      id: string; invoice_no: string; supplier_name: string;
      supplier_national_id: string | null; supplier_economic_code: string | null;
      supplier_postal_code: string | null; issued_at: string | null;
      subtotal_rial: string; extra_cost_rial: string; vat_rial: string;
      total_rial: string; payable_rial: string;
    }>(
      `SELECT id, invoice_no, supplier_name, supplier_national_id,
              supplier_economic_code, supplier_postal_code, issued_at,
              subtotal_rial::text, extra_cost_rial::text, vat_rial::text,
              total_rial::text, payable_rial::text
         FROM purchase_invoices WHERE id = $1`,
      [id],
    );
    const inv = rows[0];
    if (!inv) throw new AppError('NOT_FOUND', { message: 'فاکتوری با این شناسه نیست.' });

    const { rows: items } = await this.db.query<{
      product_title: string; sku: string; quantity: number;
      unit_cost_rial: string; vat_rial: string; total_cost_rial: string;
    }>(
      `SELECT p.title AS product_title, pv.sku, pii.quantity,
              pii.unit_cost_rial::text, pii.vat_rial::text, pii.total_cost_rial::text
         FROM purchase_invoice_items pii
         JOIN product_variants pv ON pv.id = pii.variant_id
         JOIN products p ON p.id = pv.product_id
        WHERE pii.invoice_id = $1 ORDER BY p.title`,
      [id],
    );

    // فروشنده = تأمین‌کننده
    const { rows: settings } = await this.db.query<{ key: string; value: string }>(
      `SELECT key, value FROM store_settings WHERE key IN ('store_name','store_address','store_phone','national_id','economic_code')`,
    );
    const sMap = Object.fromEntries(settings.map((s) => [s.key, s.value]));

    const spec = {
      number: inv.invoice_no,
      issuedAt: inv.issued_at ? new Date(inv.issued_at) : new Date(),
      status: 'paid',
      title: 'صورتحساب خرید',
      seller: {
        name: inv.supplier_name,
        nationalId: inv.supplier_national_id ?? undefined,
        economicCode: inv.supplier_economic_code ?? undefined,
        postalCode: inv.supplier_postal_code ?? undefined,
      },
      buyer: {
        name: sMap['store_name'] ?? 'فروشگاه',
        nationalId: sMap['national_id'] ?? undefined,
        economicCode: sMap['economic_code'] ?? undefined,
        address: sMap['store_address'] ?? undefined,
        phone: sMap['store_phone'] ?? undefined,
      },
      lines: items.map((it) => ({
        title: it.product_title,
        sku: it.sku,
        quantity: it.quantity,
        unitPriceRial: Number(it.unit_cost_rial),
        taxRial: Number(it.vat_rial),
      })),
      extraCostRial: Number(inv.extra_cost_rial),
      taxRial: Number(inv.vat_rial),
      note: `شناسه فاکتور: ${inv.invoice_no}`,
    };

    const buffer = renderInvoicePdf(spec as Parameters<typeof renderInvoicePdf>[0]);
    reply
      .header('Content-Type', 'application/pdf')
      .header('Content-Disposition', `attachment; filename="purchase-${inv.invoice_no}.pdf"`)
      .send(buffer);
  }

  /** ارزشِ موجودی به بهای میانگینِ موزون — عددی که در ترازنامه می‌نشیند */
  @Get('inventory-value')
  async inventoryValue(@Headers('authorization') authorization?: string) {
    await this.requireUser(authorization);

    const { rows } = await this.db.query<{
      variant_id: string; sku: string; product: string;
      quantity: number; avg_cost_rial: string; value_rial: string;
    }>(
      `SELECT iv.variant_id, pv.sku, p.title AS product, iv.quantity,
              iv.avg_cost_rial::text,
              (iv.quantity * iv.avg_cost_rial)::text AS value_rial
         FROM inventory_valuation iv
         JOIN product_variants pv ON pv.id = iv.variant_id
         JOIN products p ON p.id = pv.product_id
        WHERE iv.quantity <> 0
        ORDER BY (iv.quantity * iv.avg_cost_rial) DESC`,
    );

    const total = rows.reduce((acc, r) => acc + BigInt(r.value_rial), 0n);
    const count = rows.reduce((acc, r) => acc + r.quantity, 0);

    return {
      count: rows.length,
      totalQuantity: count,
      totalValueRial: total.toString(),
      display: { total: formatToman(total) },
      items: rows.map((r) => ({
        variantId: r.variant_id,
        sku: r.sku,
        product: r.product,
        quantity: r.quantity,
        avgCostRial: r.avg_cost_rial,
        valueRial: r.value_rial,
        display: {
          avgCost: formatToman(BigInt(r.avg_cost_rial)),
          value: formatToman(BigInt(r.value_rial)),
        },
      })),
    };
  }

  /**
   * داده‌ی مرجعِ فرم‌ها: حساب‌ها (برایِ سندِ دستی)، تنوع‌ها و انبارها
   * (برایِ فاکتورِ خرید). یک درخواست به‌جایِ سه درخواست.
   */
  @Get('reference')
  async reference(@Headers('authorization') authorization?: string) {
    await this.requireUser(authorization, 'write');

    const [accounts, variants, warehouses] = await Promise.all([
      this.db.query<{ code: string; name: string; type: string }>(
        `SELECT code, name, type FROM accounts WHERE is_active = true ORDER BY code`,
      ),
      this.db.query<{ id: string; sku: string; product: string; price_rial: string; on_hand: number }>(
        // جمعِ موجودی در همه‌ی انبارها: هنگامِ خرید باید دانست اکنون چند عدد داریم
        `SELECT pv.id, pv.sku, p.title AS product,
                COALESCE(pv.price_rial, 0)::text AS price_rial,
                COALESCE((SELECT SUM(si.on_hand) FROM stock_items si WHERE si.variant_id = pv.id), 0)::int AS on_hand
           FROM product_variants pv
           JOIN products p ON p.id = pv.product_id
          WHERE pv.is_active = true
          ORDER BY p.title, pv.sku
          LIMIT 500`,
      ),
      this.db.query<{ id: string; name: string; is_default: boolean }>(
        `SELECT id, name, is_default FROM warehouses ORDER BY is_default DESC, name`,
      ),
    ]);

    return {
      accounts: accounts.rows,
      variants: variants.rows,
      warehouses: warehouses.rows,
    };
  }

  /* ================================ نوشتن ================================ */

  /** ثبتِ سندِ دستی — تراز بودن در سرویس و در قیدِ پایگاه‌داده کنترل می‌شود */
  @Post('journal')
  async postJournal(@Body() body: unknown, @Headers('authorization') authorization?: string) {
    await this.requireUser(authorization, 'write');
    const input = JournalDto.parse(body);

    const entry = await this.accounting.postJournal({
      description: input.description,
      lines: input.lines.map((l) => ({
        accountCode: l.accountCode,
        debitRial: BigInt(l.debitRial),
        creditRial: BigInt(l.creditRial),
        description: l.description ?? undefined,
      })),
    });

    const total = input.lines.reduce((acc, l) => acc + BigInt(l.debitRial), 0n);
    return { ...entry, display: { total: formatToman(total) } };
  }

  /** برگشتِ سند — حذف هرگز؛ فقط سندِ معکوس */
  @Post('journal/reverse')
  @HttpCode(200)
  async reverse(@Body() body: unknown, @Headers('authorization') authorization?: string) {
    await this.requireUser(authorization, 'write');
    const input = ReverseDto.parse(body);
    return this.accounting.reverseEntry(input.entryId, input.reason);
  }

  /**
   * ثبتِ فاکتورِ خرید: ورودِ کالا به انبار + بهای میانگینِ موزون + سندِ خودکار.
   * ثبت‌کننده از توکن می‌آید، نه از بدنه — پس هیچ‌کس نمی‌تواند سند را
   * به نامِ دیگری ثبت کند.
   */
  @Post('purchases')
  async createPurchase(@Body() body: unknown, @Headers('authorization') authorization?: string) {
    const claims = await this.requireUser(authorization, 'write');
    const input = PurchaseDto.parse(body);

    const invoice = await this.accounting.postPurchaseInvoice({
      supplierName: input.supplierName,
      supplierNationalId: input.supplierNationalId ?? null,
      supplierEconomicCode: input.supplierEconomicCode ?? null,
      supplierPostalCode: input.supplierPostalCode ?? null,
      supplierInvoiceNo: input.supplierInvoiceNo ?? null,
      issuedAt: toDate(input.issuedAt),
      dueAt: toDate(input.dueAt),
      warehouseId: input.warehouseId,
      items: input.items.map((i) => ({
        variantId: i.variantId,
        quantity: i.quantity,
        unitCostRial: BigInt(i.unitCostRial),
      })),
      extraCostRial: input.extraCostRial ? BigInt(input.extraCostRial) : 0n,
      vatRial: input.vatRial ? BigInt(input.vatRial) : 0n,
      createdBy: claims.sub,
    });

    return {
      ...invoice,
      display: {
        subtotal: formatToman(BigInt(invoice.subtotalRial)),
        vat: formatToman(BigInt(invoice.vatRial)),
        total: formatToman(BigInt(invoice.totalCostRial)),
        payable: formatToman(BigInt(invoice.payableRial)),
      },
    };
  }

  /* ── مغایرت بانکی ──────────────────────────────────────────────────────── */

  @Post('reconciliation')
  async importBankStatement(
    @Body() body: unknown,
    @Headers('authorization') auth?: string,
  ) {
    const claims = await this.requireUser(auth, 'write');
    const input = z.object({
      bankAccount: z.string().min(1),
      statements: z.array(z.object({
        date: z.string(),
        description: z.string(),
        amountRial: z.string(),
        direction: z.enum(['debit', 'credit']),
      })).min(1),
    }).parse(body);

    let imported = 0;
    for (const s of input.statements) {
      await this.db.query(
        `INSERT INTO bank_reconciliation (bank_account, statement_date, description, amount_rial, direction)
         VALUES ($1, $2, $3, $4, $5)`,
        [input.bankAccount, s.date, s.description, s.amountRial, s.direction],
      );
      imported++;
    }
    return { imported, message: `${imported} تراکنش بانکی ثبت شد.` };
  }

  @Get('reconciliation')
  async listReconciliation(
    @Query('bankAccount') bankAccount?: string,
    @Query('matched') matched?: string,
    @Headers('authorization') auth?: string,
  ) {
    await this.requireUser(auth, 'read');
    const conditions = ['1=1'];
    const params: unknown[] = [];
    if (bankAccount) { params.push(bankAccount); conditions.push(`bank_account = $${params.length}`); }
    if (matched === 'false') conditions.push('NOT matched');
    if (matched === 'true') conditions.push('matched');

    const { rows } = await this.db.query(
      `SELECT id, bank_account, statement_date, description, amount_rial::text, direction, matched, journal_entry_id, note
       FROM bank_reconciliation WHERE ${conditions.join(' AND ')} ORDER BY statement_date DESC LIMIT 200`,
      params,
    );
    return { items: rows };
  }

  @Post('reconciliation/:id/match')
  async matchReconciliation(
    @Param('id') id: string,
    @Body() body: unknown,
    @Headers('authorization') auth?: string,
  ) {
    const claims = await this.requireUser(auth, 'write');
    const input = z.object({ journalEntryId: z.string().uuid(), note: z.string().nullish() }).parse(body);

    await this.db.query(
      `UPDATE bank_reconciliation SET matched = true, journal_entry_id = $1, note = $2,
       reconciled_by = $3, reconciled_at = now() WHERE id = $4`,
      [input.journalEntryId, input.note ?? null, claims.sub, id],
    );
    return { message: 'تطبیق ثبت شد.' };
  }

  /* ── گزارش سن بدهی (Aging) ──────────────────────────────────────────────── */

  @Get('aging')
  async agingReport(@Headers('authorization') auth?: string) {
    await this.requireUser(auth, 'read');

    const { rows } = await this.db.query(
      `SELECT
         c.id AS customer_id, c.full_name, c.phone, c.is_partner,
         COALESCE(SUM(o.total_rial) FILTER (WHERE o.status NOT IN ('paid','delivered','cancelled','refunded')), 0)::text AS unpaid_rial,
         COUNT(o.id) FILTER (WHERE o.status NOT IN ('paid','delivered','cancelled','refunded'))::int AS unpaid_count,
         COALESCE(SUM(o.total_rial) FILTER (WHERE o.status NOT IN ('paid','delivered','cancelled','refunded') AND o.created_at > now() - interval '30 days'), 0)::text AS d0_30,
         COALESCE(SUM(o.total_rial) FILTER (WHERE o.status NOT IN ('paid','delivered','cancelled','refunded') AND o.created_at <= now() - interval '30 days' AND o.created_at > now() - interval '60 days'), 0)::text AS d31_60,
         COALESCE(SUM(o.total_rial) FILTER (WHERE o.status NOT IN ('paid','delivered','cancelled','refunded') AND o.created_at <= now() - interval '60 days' AND o.created_at > now() - interval '90 days'), 0)::text AS d61_90,
         COALESCE(SUM(o.total_rial) FILTER (WHERE o.status NOT IN ('paid','delivered','cancelled','refunded') AND o.created_at <= now() - interval '90 days'), 0)::text AS d90_plus
       FROM customers c LEFT JOIN orders o ON o.customer_id = c.id
       GROUP BY c.id
       HAVING COALESCE(SUM(o.total_rial) FILTER (WHERE o.status NOT IN ('paid','delivered','cancelled','refunded')), 0) > 0
       ORDER BY unpaid_rial::bigint DESC`,
    );

    return {
      items: rows.map((r: Record<string, unknown>) => ({
        customerId: r.customer_id, fullName: r.full_name, phone: r.phone, isPartner: r.is_partner,
        unpaidToman: formatToman(BigInt(r.unpaid_rial as string)), unpaidCount: r.unpaid_count,
        d0_30: formatToman(BigInt(r.d0_30 as string)), d31_60: formatToman(BigInt(r.d31_60 as string)),
        d61_90: formatToman(BigInt(r.d61_90 as string)), d90plus: formatToman(BigInt(r.d90_plus as string)),
      })),
    };
  }
}
