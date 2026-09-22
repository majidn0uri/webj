import type { Database, Queryable } from '@set/db';
import { nextNumber, publishEvent } from '@set/db';
import {
  allocate,
  getYear,
  jalaliMonth,
  isValidIranianNationalId,
  looksLikeEconomicCode,
  toEnglishDigits,
  formatToman,
  AppError,
  type Rial,
} from '@set/shared-kernel';

/**
 * حسابداریِ پایه — دفترکلِ دوبل و بهای تمام‌شده.
 *
 * قانونِ اول: هیچ سندی غیرتراز ثبت نمی‌شود (بدهکار = بستانکار)، و این در دو سطح
 * کنترل می‌شود: در کد و در قیدِ پایگاه‌داده.
 * قانونِ دوم: سند هرگز حذف نمی‌شود؛ اصلاح با سندِ معکوس است.
 */
export interface JournalLineInput {
  accountCode: string;
  debitRial?: Rial;
  creditRial?: Rial;
  description?: string;
}

export interface PostJournalInput {
  description: string;
  referenceType?: string | null;
  referenceId?: string | null;
  lines: JournalLineInput[];
  postedAt?: Date;
}

export interface PurchaseInvoiceInput {
  supplierName: string;
  warehouseId: string;
  items: Array<{ variantId: string; quantity: number; unitCostRial: Rial }>;
  /** هزینه‌های جانبی (حمل، گمرک، …) که بین ردیف‌ها توزیع می‌شود */
  extraCostRial?: Rial;
  /**
   * مالیات بر ارزش افزوده‌ی خرید.
   * این مبلغ «اعتبار» است، نه هزینه: به بهای کالا اضافه نمی‌شود (پس میانگینِ
   * موزون را تغییر نمی‌دهد) و در حسابِ ۱۳۰۰ بدهکار می‌شود تا در پایانِ دوره
   * از ارزش افزوده‌ی فروش کم شود.
   */
  vatRial?: Rial;
  /** هویتِ ایرانیِ تأمین‌کننده — برایِ سامانه‌ی مؤدیان و جلوگیری از ثبتِ تکراری */
  supplierNationalId?: string | null;
  supplierEconomicCode?: string | null;
  supplierPostalCode?: string | null;
  /** شماره‌ی فاکتورِ خودِ تأمین‌کننده (با شماره‌ی داخلیِ ما فرق دارد) */
  supplierInvoiceNo?: string | null;
  issuedAt?: Date | null;
  dueAt?: Date | null;
  createdBy?: string | null;
  /**
   * اثرِ این فاکتور بر موجودی (BR-19).
   *
   *   'increase' (پیش‌فرض)  ← خریدِ قطعی: کالا همراهِ فاکتور وارد انبار شده است.
   *   'none'                ← فاکتور فقط سندِ مالی است؛ موجودی با «رسیدِ انبار»
   *                           (KH) افزایش می‌یابد. این همان مسیرِ عادیِ تأمین
   *                           است: اول سفارش، بعد تحویل، بعد انبار.
   */
  stockEffect?: 'increase' | 'none';
}

export interface PostedPurchaseInvoice {
  invoiceId: string;
  invoiceNo: string;
  entryNo: string;
  subtotalRial: string;
  extraCostRial: string;
  vatRial: string;
  totalCostRial: string;
  payableRial: string;
  lines: Array<{ variantId: string; quantity: number; totalCostRial: string; vatRial: string }>;
}

export class AccountingService {
  constructor(private readonly db: Database) {}

  /**
   * ساختِ حساب در یک تراکنشِ «موجود».
   *
   * چرا نسخه‌یِ درون‌تراکنشی لازم شد؟ چون برگشت از فروش (مرجوعی) باید در
   * همان تراکنشی حساب‌هایش را بسازد که سند را می‌نویسد. اگر حساب از اتصالِ
   * بیرونِ تراکنش ساخته می‌شد، در پایگاه‌هایِ تک‌اتصالی تراکنش منتظرِ خودش
   * می‌ماند: بن‌بستِ خالص.
   */
  async ensureAccountOn(tx: Queryable, code: string, name: string, type: string): Promise<string> {
    const { rows } = await tx.query<{ id: string }>(
      `INSERT INTO accounts (code, name, type) VALUES ($1,$2,$3)
       ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name
       RETURNING id`,
      [code, name, type],
    );
    return rows[0]!.id;
  }

  /**
   * ساختِ حساب با اتصالِ خودِ سرویس.
   *
   * هشدار: درونِ یک تراکنش این را صدا نزنید؛ از `ensureAccountOn` با همان
   * `tx` استفاده کنید.
   */
  async ensureAccount(code: string, name: string, type: string): Promise<string> {
    return this.ensureAccountOn(this.db, code, name, type);
  }

  async postJournal(input: PostJournalInput): Promise<{ entryId: string; entryNo: string }> {
    if (input.lines.length < 2) {
      throw new AppError('VALIDATION', { details: { lines: 'هر سند دست‌کم دو ردیف دارد' } });
    }

    let totalDebit = 0n;
    let totalCredit = 0n;
    for (const line of input.lines) {
      const debit = line.debitRial ?? 0n;
      const credit = line.creditRial ?? 0n;
      if (debit > 0n && credit > 0n) {
        throw new AppError('VALIDATION', { details: { message: 'یک ردیف نمی‌تواند هم‌زمان بدهکار و بستانکار باشد' } });
      }
      totalDebit += debit;
      totalCredit += credit;
    }
    if (totalDebit !== totalCredit) {
      throw new AppError('INVARIANT', {
        details: { message: 'سند تراز نیست', debit: totalDebit.toString(), credit: totalCredit.toString() },
      });
    }
    if (totalDebit === 0n) {
      throw new AppError('VALIDATION', { details: { message: 'مبلغِ سند صفر است' } });
    }

    return this.db.transaction(async (tx) => {
      const postedAt = input.postedAt ?? new Date();
      const { formatted: entryNo } = await nextNumber(tx, 'journal_entry', {
        prefix: 'JV',
        jalaliYear: getYear(postedAt),
        pad: 6,
      });

      const { rows } = await tx.query<{ id: string }>(
        `INSERT INTO journal_entries (entry_no, description, reference_type, reference_id, posted_at, period)
         VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
        [
          entryNo,
          input.description,
          input.referenceType ?? null,
          input.referenceId ?? null,
          postedAt.toISOString(),
          periodOf(postedAt),
        ],
      );
      const entryId = rows[0]!.id;

      for (const line of input.lines) {
        const { rows: accounts } = await tx.query<{ id: string }>(
          `SELECT id FROM accounts WHERE code = $1`, [line.accountCode],
        );
        const accountId = accounts[0]?.id;
        if (!accountId) {
          throw new AppError('VALIDATION', { details: { accountCode: `حساب ${line.accountCode} تعریف نشده` } });
        }
        await tx.query(
          `INSERT INTO journal_lines (entry_id, account_id, debit_rial, credit_rial, description)
           VALUES ($1,$2,$3,$4,$5)`,
          [
            entryId,
            accountId,
            (line.debitRial ?? 0n).toString(),
            (line.creditRial ?? 0n).toString(),
            line.description ?? null,
          ],
        );
      }

      await publishEvent(tx, {
        aggregate: 'journal_entry',
        aggregateId: entryId,
        eventType: 'journal.posted',
        payload: { entryNo, debit: totalDebit.toString() },
      });

      return { entryId, entryNo };
    });
  }

  /**
   * فاکتورِ خرید: ورودِ کالا به انبار + به‌روزرسانیِ بهای میانگینِ موزون + سندِ حسابداری.
   * هزینه‌های جانبی با «توزیعِ دقیق» بین ردیف‌ها پخش می‌شود، پس هیچ ریالی باقی نمی‌ماند.
   */
  async postPurchaseInvoice(input: PurchaseInvoiceInput): Promise<PostedPurchaseInvoice> {
    const extraCost = input.extraCostRial ?? 0n;
    const vat = input.vatRial ?? 0n;

    // --- اعتبارسنجیِ هویتِ ایرانیِ تأمین‌کننده، پیش از هر نوشتنی
    // چرا اینجا؟ چون اگر فاکتور ثبت شود و بعداً رد شود، اصلاحش یک سندِ برگشت
    // و یک اصلاحِ بهای تمام‌شده است؛ جلوگیری از همان ابتدا ارزان‌تر است.
    const nationalId = normalizeNationalId(input.supplierNationalId);
    const economicCode = normalizeEconomicCode(input.supplierEconomicCode);
    const supplierInvoiceNo = blankToNull(input.supplierInvoiceNo);

    if (nationalId && !isValidIranianNationalId(nationalId)) {
      throw new AppError('VALIDATION', {
        message:
          'شناسه‌ی ملیِ تأمین‌کننده معتبر نیست (۱۰ رقم برای شخصِ حقیقی یا ۱۱ رقم برای شرکت، با رقمِ کنترلِ درست).',
        details: { field: 'supplierNationalId', value: nationalId },
      });
    }
    if (economicCode && !looksLikeEconomicCode(economicCode)) {
      throw new AppError('VALIDATION', {
        message: 'کدِ اقتصادیِ تأمین‌کننده معتبر نیست (دست‌کم ۱۰ رقم).',
        details: { field: 'supplierEconomicCode', value: economicCode },
      });
    }
    if (supplierInvoiceNo && !nationalId) {
      throw new AppError('VALIDATION', {
        message: 'برایِ ثبتِ شماره‌ی فاکتورِ تأمین‌کننده، شناسه‌ی ملیِ او لازم است.',
        details: { field: 'supplierNationalId' },
      });
    }

    return this.db.transaction(async (tx) => {
      const { formatted: invoiceNo } = await nextNumber(tx, 'purchase_invoice', {
        prefix: 'PINV',
        jalaliYear: getYear(new Date()),
        pad: 6,
      });

      // سهمِ هر ردیف از هزینه‌های جانبی، بر اساسِ ارزشِ ردیف
      const values = input.items.map((i) => Number(i.unitCostRial * BigInt(i.quantity)));
      const extraShares = allocate(extraCost, values);

      let subtotal = 0n;
      const lines: Array<{ variantId: string; quantity: number; unitCost: bigint; extra: bigint; total: bigint }> = [];

      input.items.forEach((item, index) => {
        const extra = extraShares[index] ?? 0n;
        const total = item.unitCostRial * BigInt(item.quantity) + extra;
        subtotal += item.unitCostRial * BigInt(item.quantity);
        lines.push({ variantId: item.variantId, quantity: item.quantity, unitCost: item.unitCostRial, extra, total });
      });

      const totalCost = subtotal + extraCost;
      // کلِ قابلِ پرداخت: بهای کالا + هزینه‌های جانبی + ارزش افزوده
      const payable = totalCost + vat;

      // سهمِ ارزش افزوده‌ی هر ردیف — فقط برایِ گزارش؛ در بهای کالا نمی‌نشیند
      const vatShares = allocate(vat, values);

      let inserted;
      try {
        inserted = await tx.query<{ id: string }>(
          `INSERT INTO purchase_invoices
             (invoice_no, supplier_name, warehouse_id, subtotal_rial, extra_cost_rial, vat_rial,
              total_rial, payable_rial, supplier_national_id, supplier_economic_code,
              supplier_postal_code, supplier_invoice_no, issued_at, due_at, created_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING id`,
          [
            invoiceNo, input.supplierName, input.warehouseId,
            subtotal.toString(), extraCost.toString(), vat.toString(),
            totalCost.toString(), payable.toString(),
            nationalId, economicCode, blankToNull(input.supplierPostalCode), supplierInvoiceNo,
            dateOnly(input.issuedAt), dateOnly(input.dueAt), input.createdBy ?? null,
          ],
        );
      } catch (error) {
        // قیدِ یکتا: همین تأمین‌کننده، همین شماره‌ی فاکتور — پیش‌تر ثبت شده است.
        // این یک «خطای هم‌زمانی» نیست؛ یک تلاشِ آشکار برای ثبتِ دوباره است.
        if (isUniqueViolation(error)) {
          throw new AppError('CONFLICT', {
            message:
              supplierInvoiceNo && nationalId
                ? `فاکتورِ شماره‌ی «${supplierInvoiceNo}» از این تأمین‌کننده پیش‌تر ثبت شده است.`
                : 'این فاکتور پیش‌تر ثبت شده است.',
            details: { field: 'supplierInvoiceNo', supplierNationalId: nationalId },
          });
        }
        throw error;
      }

      const invoiceId = inserted.rows[0]!.id;

      for (const [index, line] of lines.entries()) {
        const lineVat = vatShares[index] ?? 0n;
        await tx.query(
          `INSERT INTO purchase_invoice_items
             (invoice_id, variant_id, quantity, unit_cost_rial, extra_cost_rial, vat_rial, total_cost_rial)
           VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [
            invoiceId, line.variantId, line.quantity,
            line.unitCost.toString(), line.extra.toString(), lineVat.toString(), line.total.toString(),
          ],
        );

        // افزایشِ موجودی — فقط اگر این فاکتور «قطعی» باشد.
        // در مسیرِ تأمین، موجودی را «رسیدِ انبار» بالا می‌برد (BR-19)؛ بدونِ این
        // تفکیک، کالا دو بار وارد انبار می‌شد: یک‌بار با فاکتور، یک‌بار با رسید.
        if ((input.stockEffect ?? 'increase') === 'increase') {
          await tx.query(
            `INSERT INTO stock_items (variant_id, warehouse_id, on_hand)
             VALUES ($1,$2,$3)
             ON CONFLICT (variant_id, warehouse_id)
             DO UPDATE SET on_hand = stock_items.on_hand + EXCLUDED.on_hand, updated_at = now()`,
            [line.variantId, input.warehouseId, line.quantity],
          );

          await tx.query(
            `INSERT INTO stock_movements (variant_id, warehouse_id, quantity, reason, reference_type, reference_id, unit_cost_rial)
             VALUES ($1,$2,$3,'purchase','purchase_invoice',$4,$5)`,
            [line.variantId, input.warehouseId, line.quantity, invoiceId, line.unitCost.toString()],
          );

          // به‌روزرسانیِ بهای میانگینِ موزون
          await updateWeightedAverage(tx, input.warehouseId, line.variantId, line.quantity, line.total);
        }
      }

      // سندِ حسابداری:
      //   موجودیِ کالا      بدهکار = بهای کالا + هزینه‌های جانبی (بدونِ ارزش افزوده)
      //   اعتبارِ مالیاتی   بدهکار = ارزش افزوده (طلب از دولت؛ هزینه نیست)
      //   حساب‌های پرداختنی بستانکار = کلِ قابلِ پرداخت به تأمین‌کننده
      const journalLines: JournalLineInput[] = [
        { accountCode: '1000', debitRial: totalCost, description: 'ورود کالا به انبار' },
        { accountCode: '2000', creditRial: payable, description: `بدهی به ${input.supplierName}` },
      ];
      if (vat > 0n) {
        journalLines.push({
          accountCode: '1300',
          debitRial: vat,
          description: 'ارزش افزوده‌ی خرید (اعتبارِ مالیاتی)',
        });
      }

      const { entryNo } = await this.postJournalOn(tx, {
        description: `فاکتور خرید ${invoiceNo} از ${input.supplierName}`,
        referenceType: 'purchase_invoice',
        referenceId: invoiceId,
        lines: journalLines,
      });

      return {
        invoiceId,
        invoiceNo,
        entryNo,
        subtotalRial: subtotal.toString(),
        extraCostRial: extraCost.toString(),
        vatRial: vat.toString(),
        totalCostRial: totalCost.toString(),
        payableRial: payable.toString(),
        lines: lines.map((l, i) => ({
          variantId: l.variantId,
          quantity: l.quantity,
          totalCostRial: l.total.toString(),
          vatRial: (vatShares[i] ?? 0n).toString(),
        })),
      };
    });
  }

  /**
   * سندِ فروش — همان‌جا که کالا از انبار می‌رود.
   *
   * چهار اتفاق در یک تراکنش:
   *   ۱) درآمد شناسایی می‌شود (بستانکارِ ۴۰۰۰)،
   *   ۲) ارزش افزوده‌ی فروش به‌عنوانِ بدهیِ مالیاتی ثبت می‌شود (بستانکارِ ۲۱۰۰)،
   *   ۳) بهای کالایِ فروخته‌شده به بهایِ میانگینِ موزون از انبار خارج می‌شود،
   *   ۴) موجودیِ حسابداری به همان اندازه کم می‌شود.
   *
   * بدونِ این سند، «سود و زیان» همیشه صفر بود و ارزشِ موجودی در ترازنامه
   * هرگز کم نمی‌شد — یعنی ترازنامه دروغ می‌گفت.
   */
  async postSaleOn(
    tx: Queryable,
    input: {
      warehouseId: string;
      items: Array<{ variantId: string; quantity: number }>;
      /** خالصِ فروش (بدونِ ارزش افزوده) */
      subtotalRial: Rial;
      taxRial: Rial;
      shippingRial?: Rial;
      totalRial: Rial;
      /** نقد (صندوق) یا بانک (درگاهِ آنلاین) */
      settlementAccountCode?: string;
      referenceType: string;
      referenceId: string;
      description: string;
    },
  ): Promise<{ entryId: string; entryNo: string; cogsRial: string }> {
    const settlement = input.settlementAccountCode ?? '1100';
    const shipping = input.shippingRial ?? 0n;

    // بهای تمام‌شده: تعداد × بهای میانگینِ موزونِ همان انبار
    let cogs = 0n;
    for (const item of input.items) {
      const { rows } = await tx.query<{ avg_cost_rial: string; quantity: number }>(
        `SELECT avg_cost_rial, quantity FROM inventory_valuation
          WHERE variant_id = $1 AND warehouse_id = $2 FOR UPDATE`,
        [item.variantId, input.warehouseId],
      );
      const row = rows[0];
      const avg = BigInt(row?.avg_cost_rial ?? '0');
      const lineCost = avg * BigInt(item.quantity);
      cogs += lineCost;

      // کاهشِ موجودیِ حسابداری؛ بهای میانگین تغییر نمی‌کند (فروش قیمتی ندارد)
      const remaining = Math.max(0, (row?.quantity ?? 0) - item.quantity);
      await tx.query(
        `INSERT INTO inventory_valuation (variant_id, warehouse_id, quantity, avg_cost_rial)
         VALUES ($1,$2,$3,$4)
         ON CONFLICT (variant_id, warehouse_id)
         DO UPDATE SET quantity = EXCLUDED.quantity, updated_at = now()`,
        [item.variantId, input.warehouseId, remaining, avg.toString()],
      );
    }

    const lines: JournalLineInput[] = [
      { accountCode: settlement, debitRial: input.totalRial, description: 'دریافت از مشتری' },
      { accountCode: '4000', creditRial: input.subtotalRial + shipping, description: 'درآمدِ فروش کالا' },
    ];
    if (input.taxRial > 0n) {
      lines.push({
        accountCode: '2100',
        creditRial: input.taxRial,
        description: 'ارزش افزوده‌ی فروش (بدهیِ مالیاتی)',
      });
    }
    if (cogs > 0n) {
      lines.push({ accountCode: '5000', debitRial: cogs, description: 'بهای کالای فروخته‌شده' });
      lines.push({ accountCode: '1000', creditRial: cogs, description: 'خروجِ کالا از انبار' });
    }

    const entry = await this.postJournalOn(tx, {
      description: input.description,
      referenceType: input.referenceType,
      referenceId: input.referenceId,
      lines,
    });

    return { ...entry, cogsRial: cogs.toString() };
  }

  /**
   * ثبتِ سند در یک تراکنشِ «موجود».
   *
   * چرا عمومی؟ چون فروش باید در همان تراکنشی سند بخورد که موجودی را خارج
   * می‌کند؛ اگر تراکنشِ جدا باز می‌شد، ممکن بود کالا از انبار برود اما سندش
   * ثبت نشود (یا برعکس) — و ترازِ دفتر با انبار جدا می‌افتاد.
   */
  async postJournalOn(tx: Queryable, input: PostJournalInput & { postedAt?: Date }) {
    let totalDebit = 0n;
    let totalCredit = 0n;
    for (const line of input.lines) {
      totalDebit += line.debitRial ?? 0n;
      totalCredit += line.creditRial ?? 0n;
    }
    if (totalDebit !== totalCredit) throw new AppError('INVARIANT', { details: { message: 'سند تراز نیست' } });

    const postedAt = input.postedAt ?? new Date();
    const { formatted: entryNo } = await nextNumber(tx, 'journal_entry', {
      prefix: 'JV',
      jalaliYear: getYear(postedAt),
      pad: 6,
    });
    const { rows } = await tx.query<{ id: string }>(
      `INSERT INTO journal_entries (entry_no, description, reference_type, reference_id, posted_at, period)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
      [entryNo, input.description, input.referenceType ?? null, input.referenceId ?? null, postedAt.toISOString(), periodOf(postedAt)],
    );
    const entryId = rows[0]!.id;

    for (const line of input.lines) {
      const { rows: accounts } = await tx.query<{ id: string }>(`SELECT id FROM accounts WHERE code = $1`, [line.accountCode]);
      await tx.query(
        `INSERT INTO journal_lines (entry_id, account_id, debit_rial, credit_rial, description)
         VALUES ($1,$2,$3,$4,$5)`,
        [entryId, accounts[0]!.id, (line.debitRial ?? 0n).toString(), (line.creditRial ?? 0n).toString(), line.description ?? null],
      );
    }
    return { entryId, entryNo };
  }

  /** ترازِ آزمایشی: جمعِ بدهکار و بستانکارِ هر حساب */
  async trialBalance() {
    const { rows } = await this.db.query<{
      code: string; name: string; type: string; debit: string; credit: string;
    }>(
      `SELECT a.code, a.name, a.type,
              COALESCE(SUM(jl.debit_rial), 0)::text AS debit,
              COALESCE(SUM(jl.credit_rial), 0)::text AS credit
         FROM accounts a
         LEFT JOIN journal_lines jl ON jl.account_id = a.id
        GROUP BY a.code, a.name, a.type
        ORDER BY a.code`,
    );
    const totals = rows.reduce(
      (acc, r) => ({
        debit: acc.debit + BigInt(r.debit),
        credit: acc.credit + BigInt(r.credit),
      }),
      { debit: 0n, credit: 0n },
    );
    return {
      accounts: rows,
      totals: { debit: totals.debit.toString(), credit: totals.credit.toString() },
      balanced: totals.debit === totals.credit,
    };
  }

  /**
   * سود و زیانِ یک دوره‌ی شمسی (مثال: 140506).
   *
   * چرا اینجا و نه در کنترل‌کننده؟ چون «چه چیزی هزینه‌ی عملیاتی است و چه چیزی
   * بهای کالای فروخته‌شده» یک قاعده‌ی حسابداری است، نه یک تصمیمِ نمایشی. ماندنِ
   * این قاعده در لایه‌ی وب یعنی هر مسیرِ تازه‌ای که گزارش بسازد می‌تواند آن را
   * اشتباه پیاده کند — و اشتباهش در سودِ خالص دیده می‌شود، نه در کد.
   *
   * نکته‌ی مهم: بهای کالای فروخته‌شده (۵۰۰۰) یک‌بار در سودِ ناخالص کسر می‌شود؛
   * بنابراین در هزینه‌هایِ عملیاتی نباید دوباره شمرده شود.
   */
  async profitLoss(period?: string): Promise<{
    period: string;
    revenue: MoneyView;
    cogs: MoneyView;
    grossProfit: MoneyView;
    expenses: MoneyView;
    netProfit: MoneyView;
    marginPercent: number;
    lines: Array<{ code: string; type: string; amountRial: string }>;
  }> {
    const params: unknown[] = [];
    let where = '';
    if (period) {
      params.push(period);
      where = `WHERE je.period = $1`;
    }

    const { rows } = await this.db.query<{ type: string; code: string; debit: string; credit: string }>(
      `SELECT a.type, a.code,
              COALESCE(SUM(jl.debit_rial), 0)::text  AS debit,
              COALESCE(SUM(jl.credit_rial), 0)::text AS credit
         FROM journal_lines jl
         JOIN accounts a ON a.id = jl.account_id
         JOIN journal_entries je ON je.id = jl.entry_id
         ${where}
        GROUP BY a.type, a.code
        ORDER BY a.code`,
      params,
    );

    const revenue = rows
      .filter((r) => r.type === 'revenue')
      .reduce((acc, r) => acc + (BigInt(r.credit) - BigInt(r.debit)), 0n);
    const cogs = rows
      .filter((r) => r.code === '5000')
      .reduce((acc, r) => acc + (BigInt(r.debit) - BigInt(r.credit)), 0n);
    const expenses = rows
      .filter((r) => r.type === 'expense' && r.code !== '5000')
      .reduce((acc, r) => acc + (BigInt(r.debit) - BigInt(r.credit)), 0n);

    const gross = revenue - cogs;
    const net = gross - expenses;

    return {
      period: period ?? 'all',
      revenue: { rial: revenue.toString(), display: formatToman(revenue) },
      cogs: { rial: cogs.toString(), display: formatToman(cogs) },
      grossProfit: { rial: gross.toString(), display: formatToman(gross) },
      expenses: { rial: expenses.toString(), display: formatToman(expenses) },
      netProfit: { rial: net.toString(), display: formatToman(net) },
      marginPercent: revenue === 0n ? 0 : Number((net * 10_000n) / revenue) / 100,
      lines: rows.map((r) => ({
        code: r.code,
        type: r.type,
        amountRial: (signedBalance(r.type, BigInt(r.debit), BigInt(r.credit))).toString(),
      })),
    };
  }

  /** برگشتِ سند — هرگز حذف نمی‌شود */
  async reverseEntry(entryId: string, reason: string): Promise<{ entryId: string; entryNo: string }> {
    return this.db.transaction(async (tx) => {
      const { rows: lines } = await tx.query<{ account_code: string; debit_rial: string; credit_rial: string }>(
        `SELECT a.code AS account_code, jl.debit_rial, jl.credit_rial
           FROM journal_lines jl JOIN accounts a ON a.id = jl.account_id
          WHERE jl.entry_id = $1`, [entryId],
      );
      if (!lines.length) throw new AppError('NOT_FOUND');

      const reversed = await this.postJournalOn(tx, {
        description: `برگشتِ سند: ${reason}`,
        referenceType: 'reversal',
        referenceId: entryId,
        lines: lines.map((l) => ({
          accountCode: l.account_code,
          debitRial: BigInt(l.credit_rial),   // جابه‌جا
          creditRial: BigInt(l.debit_rial),
        })),
      });

      await tx.query(
        `UPDATE journal_entries SET status = 'reversed', reversed_by = $2 WHERE id = $1`,
        [entryId, reversed.entryId],
      );
      return reversed;
    });
  }
}

export function periodOf(date: Date): string {
  return `${getYear(date)}${String(jalaliMonth(date)).padStart(2, '0')}`;
}

/* ---------------------------------------------------------------------
   کمک‌تابع‌ها
   --------------------------------------------------------------------- */

/** موجودیِ حساب با علامت: دارایی و هزینه بدهکار، بدهی و درآمد بستانکار */
function signedBalance(type: string, debit: bigint, credit: bigint): bigint {
  return type === 'asset' || type === 'expense' ? debit - credit : credit - debit;
}

export interface MoneyView {
  rial: string;
  display: string;
}

/* ---------------------------------------------------------------------
   پاک‌سازیِ ورودی‌هایِ هویتِ ایرانی
   چرا این توابع اینجا و نه در کنترل‌کننده؟ چون «چه چیزی یک شناسه‌ی ملیِ
   معتبر است» یک قانونِ حسابداری/مالیاتی است، نه قانونِ قراردادِ HTTP؛
   اگر فردا ثبتِ فاکتور از یک مسیرِ دیگر (درون‌ریزیِ اکسل، وب‌هوک) انجام شود،
   همان قانون بی‌تغییر اعمال می‌شود.
   --------------------------------------------------------------------- */

/** ارقامِ فارسی/عربی → لاتین، حذفِ فاصله و خط تیره؛ تهی → null */
function normalizeNationalId(value: string | null | undefined): string | null {
  if (!value) return null;
  const digits = toEnglishDigits(String(value)).replace(/[\s-]/g, '');
  return digits.length ? digits : null;
}

function normalizeEconomicCode(value: string | null | undefined): string | null {
  return normalizeNationalId(value); // هر دو فقط رشته‌ای از ارقام‌اند
}

function blankToNull(value: string | null | undefined): string | null {
  const trimmed = value == null ? '' : String(value).trim();
  return trimmed.length ? trimmed : null;
}

/** تاریخِ میلادی → 'YYYY-MM-DD' برای ستونِ date؛ تهی → null */
function dateOnly(value: Date | null | undefined): string | null {
  if (!value) return null;
  const iso = value instanceof Date ? value.toISOString() : new Date(String(value)).toISOString();
  return iso.slice(0, 10);
}

/**
 * تشخیصِ نقضِ قیدِ یکتا، مستقل از درایور.
 * هر دو درایور (PGlite و pg) کدِ ۲۳۵۰۵ را برمی‌گردانند؛ نامِ خطا فرق می‌کند،
 * پس فقط روی کد تکیه می‌کنیم.
 */
function isUniqueViolation(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  return code === '23505';
}

export async function updateWeightedAverage(
  tx: Queryable,
  warehouseId: string,
  variantId: string,
  quantity: number,
  totalCost: Rial,
): Promise<void> {
  const { rows } = await tx.query<{ quantity: number; avg_cost_rial: string }>(
    `SELECT quantity, avg_cost_rial FROM inventory_valuation WHERE variant_id = $1 AND warehouse_id = $2`,
    [variantId, warehouseId],
  );
  const current = rows[0];

  const oldQty = BigInt(current?.quantity ?? 0);
  const oldAvg = BigInt(current?.avg_cost_rial ?? '0');
  const newQty = oldQty + BigInt(quantity);
  // تقسیم با گردکردنِ نیم‌به‌بالا — همان قاعده‌ی سراسریِ مبالغ
  const newAvg = newQty === 0n ? 0n : (oldAvg * oldQty + totalCost + newQty / 2n) / newQty;

  await tx.query(
    `INSERT INTO inventory_valuation (variant_id, warehouse_id, quantity, avg_cost_rial)
     VALUES ($1,$2,$3,$4)
     ON CONFLICT (variant_id, warehouse_id)
     DO UPDATE SET quantity = EXCLUDED.quantity, avg_cost_rial = EXCLUDED.avg_cost_rial, updated_at = now()`,
    [variantId, warehouseId, newQty.toString(), newAvg.toString()],
  );
}
