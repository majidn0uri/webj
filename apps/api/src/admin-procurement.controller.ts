import type { FastifyReply } from 'fastify';
import { renderInvoicePdf, type InvoiceSpec } from '@set/exports';
import {
  Body,
  Controller,
  Get,
  Headers,
  Inject,
  Param,
  Patch,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import { z } from 'zod';
import { AppError } from '@set/shared-kernel';
import type { Database } from '@set/db';
import type { AccessControl } from '@set/rbac';
import type { AccessClaims, TokenService } from '@set/auth';
import {
  createSupplier,
  listSuppliers,
  createPurchaseRequest,
  decidePurchaseRequest,
  listPurchaseRequests,
  createInvoiceFromRequest,
  receiveGoods,
  listGoodsReceipts,
  createSupplierReturn,
  paySupplierInvoice,
  clearSupplierCheck,
  listInvoicePayments,
  PAYMENT_METHOD_LABEL,
  type PaymentMethod,
} from '@set/procurement';
import { DB, TOKEN_SERVICE, ACCESS_CONTROL } from './tokens.js';

/**
 * مسیرهایِ تأمین و خرید — پشتِ همان دو بررسیِ همیشگی: توکن معتبر + اجازه‌ی دانه‌ریز.
 *
 * چرا «درخواستِ خرید» و «رسیدِ انبار» مسیرِ جدا دارند و نه یک فرمِ بزرگ؟
 * چون دو نفرِ متفاوت در دو زمانِ متفاوت آن‌ها را پر می‌کنند: انباردار کمبود
 * را ثبت می‌کند (و نیاز به دیدنِ قیمت ندارد)، مدیر قیمت و تأمین‌کننده را تأیید
 * می‌کند (و نیازی به شمارشِ قفسه ندارد). یکی کردنِ این دو یعنی فرمی که برای
 * هیچ‌کدام مناسب نیست.
 */

const SupplierDto = z.object({
  name: z.string().min(2).max(120),
  storeName: z.string().max(120).nullish(),
  kind: z.enum(['company', 'person']).default('company'),
  nationalId: z.string().max(16).nullish(),
  economicCode: z.string().max(16).nullish(),
  registrationNo: z.string().max(32).nullish(),
  contactName: z.string().max(80).nullish(),
  phone: z.string().max(20).nullish(),
  mobile: z.string().max(16).nullish(),
  province: z.string().max(60).nullish(),
  city: z.string().max(60).nullish(),
  address: z.string().max(400).nullish(),
  postalCode: z.string().max(12).nullish(),
  bankName: z.string().max(60).nullish(),
  sheba: z.string().max(32).nullish(),
  accountNo: z.string().max(32).nullish(),
  settlementTerms: z.enum(['cash', 'credit_15', 'credit_30', 'cheque']).default('cash'),
  creditLimitToman: z.number().int().min(0).default(0),
  leadTimeDays: z.number().int().min(0).max(365).default(3),
  note: z.string().max(500).nullish(),
});

const RequestDto = z.object({
  items: z
    .array(
      z.object({
        variantId: z.string().uuid(),
        quantity: z.number().int().positive(),
        note: z.string().max(200).nullish(),
      }),
    )
    .min(1, 'درخواست باید دست‌کم یک قلم داشته باشد'),
  supplierId: z.string().uuid().nullish(),
  branchId: z.string().uuid().nullish(),
  priority: z.enum(['low', 'normal', 'high', 'urgent']).default('normal'),
  source: z.enum(['manual', 'reorder_alert', 'customer_order']).default('manual'),
  expectedAt: z.coerce.date().nullish(),
  reason: z.string().max(500).nullish(),
});

const DecideDto = z.object({
  approve: z.boolean(),
  note: z.string().max(500).default(''),
  supplierId: z.string().uuid().nullish(),
});

const InvoiceDto = z.object({
  supplierId: z.string().uuid().nullish(),
  warehouseId: z.string().uuid(),
  /** variantId → قیمتِ واحد به تومان (ورودیِ کاربر همیشه تومان است) */
  pricesToman: z.record(z.number().int().min(0)),
  extraCostToman: z.number().int().min(0).default(0),
  vatToman: z.number().int().min(0).default(0),
  supplierInvoiceNo: z.string().max(50).nullish(),
  issuedAt: z.coerce.date().nullish(),
  dueAt: z.coerce.date().nullish(),
});

const ReceiptDto = z.object({
  purchaseInvoiceId: z.string().uuid().nullish(),
  purchaseRequestId: z.string().uuid().nullish(),
  supplierId: z.string().uuid().nullish(),
  warehouseId: z.string().uuid(),
  branchId: z.string().uuid().nullish(),
  supplierInvoiceNo: z.string().max(50).nullish(),
  carrier: z.string().max(60).nullish(),
  trackingNo: z.string().max(60).nullish(),
  discrepancyNote: z.string().max(500).nullish(),
  items: z
    .array(
      z.object({
        variantId: z.string().uuid(),
        expectedQuantity: z.number().int().min(0).default(0),
        receivedQuantity: z.number().int().min(0),
        damagedQuantity: z.number().int().min(0).default(0),
        unitCostToman: z.number().int().min(0).default(0),
        note: z.string().max(200).nullish(),
      }),
    )
    .min(1, 'رسید باید دست‌کم یک قلم داشته باشد'),
});

/** ثبتِ پرداخت به تأمین‌کننده؛ مبلغ به ریال است (تومان در پنل نمایش داده می‌شود) */
const PaymentDto = z.object({
  amountRial: z.union([z.string(), z.number()]).transform((v) => BigInt(String(v))),
  method: z.enum(['cash', 'bank', 'card', 'check']),
  paidAt: z.coerce.date().nullish(),
  referenceNo: z.string().max(60).nullish(),
  checkId: z.string().uuid().nullish(),
  note: z.string().max(500).nullish(),
});

const SupplierReturnDto = z.object({
  supplierId: z.string().uuid(),
  goodsReceiptId: z.string().uuid().nullish(),
  warehouseId: z.string().uuid().nullish(),
  reason: z.string().min(3).max(500),
  items: z
    .array(
      z.object({
        variantId: z.string().uuid(),
        quantity: z.number().int().positive(),
        unitCostToman: z.number().int().min(0).default(0),
        reason: z.string().max(200).nullish(),
      }),
    )
    .min(1),
});

@Controller('admin/procurement')
export class AdminProcurementController {
  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(TOKEN_SERVICE) private readonly tokens: TokenService,
    @Inject(ACCESS_CONTROL) private readonly access: AccessControl,
  ) {}

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

  // -------------------------------------------------------------------------
  // تأمین‌کنندگان
  // -------------------------------------------------------------------------

  @Get('suppliers')
  async getSuppliers(
    @Headers('authorization') auth: string | undefined,
    @Query('q') q?: string,
  ) {
    await this.requireUser(auth, 'procurement.supplier', 'read');
    return { items: await listSuppliers(this.db, { q }) };
  }

  @Post('suppliers')
  async addSupplier(
    @Headers('authorization') auth: string | undefined,
    @Body() body: unknown,
  ) {
    const claims = await this.requireUser(auth, 'procurement.supplier', 'create');
    const input = SupplierDto.parse(body);
    const supplier = await createSupplier(this.db, {
      ...input,
      creditLimitRial: BigInt(input.creditLimitToman) * 10n,
      actorId: claims.sub,
    });
    return { supplier };
  }

  // -------------------------------------------------------------------------
  // درخواست‌های خرید
  // -------------------------------------------------------------------------

  @Get('requests')
  async getRequests(
    @Headers('authorization') auth: string | undefined,
    @Query('status') status?: string,
  ) {
    await this.requireUser(auth, 'procurement.request', 'read');
    return { items: await listPurchaseRequests(this.db, { status }) };
  }

  @Post('requests')
  async addRequest(
    @Headers('authorization') auth: string | undefined,
    @Body() body: unknown,
  ) {
    const claims = await this.requireUser(auth, 'procurement.request', 'create');
    const input = RequestDto.parse(body);
    const request = await createPurchaseRequest(this.db, {
      ...input,
      requestedBy: claims.sub,
    });
    return { request };
  }

  @Patch('requests/:id/decision')
  async decideRequest(
    @Headers('authorization') auth: string | undefined,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    const claims = await this.requireUser(auth, 'procurement.request', 'approve');
    const input = DecideDto.parse(body);
    const request = await decidePurchaseRequest(this.db, {
      requestId: id,
      approve: input.approve,
      note: input.note,
      supplierId: input.supplierId,
      actorId: claims.sub,
    });
    return { request };
  }

  /* ── PDF درخواست خرید (برای ارسال به تأمین‌کننده) ──────────────────────── */

  @Get('requests/:id/pdf')
  async requestPdf(
    @Param('id') id: string,
    @Headers('authorization') auth: string | undefined,
    @Res() res: FastifyReply,
  ) {
    await this.requireUser(auth, 'procurement.request', 'read');

    const { rows: reqRows } = await this.db.query(
      `SELECT pr.*, s.name AS supplier_name, s.phone AS supplier_phone, s.address AS supplier_address
       FROM purchase_requests pr LEFT JOIN suppliers s ON s.id = pr.supplier_id WHERE pr.id = $1`,
      [id],
    );
    const pr = reqRows[0] as Record<string, unknown> | undefined;
    if (!pr) throw new AppError('NOT_FOUND');

    const { rows: items } = await this.db.query(
      `SELECT pri.quantity, pri.note, v.sku, p.title, pri.last_cost_rial::text
       FROM purchase_request_items pri
       JOIN product_variants v ON v.id = pri.variant_id
       JOIN products p ON p.id = v.product_id
       WHERE pri.request_id = $1`,
      [id],
    );

    const spec: InvoiceSpec = {
      title: 'درخواست خرید',
      seller: { name: 'ست‌شاپ' },
      buyer: {
        name: (pr.supplier_name as string) ?? 'تأمین‌کننده',
        phone: (pr.supplier_phone as string) ?? '',
        address: (pr.supplier_address as string) ?? '',
      },
      lines: items.map((it: Record<string, unknown>) => ({
        title: it.title as string,
        sku: it.sku as string,
        quantity: it.quantity as number,
        unitPriceRial: Number(it.last_cost_rial ?? 0),
      })),
      number: pr.request_no as string,
      issuedAt: new Date(pr.created_at as string),
      watermark: pr.status as string,
    };
    const pdf = renderInvoicePdf(spec);

    res.header('content-type', 'application/pdf');
    res.header('content-disposition', `attachment; filename="purchase-request-${pr.request_no}.pdf"`);
    res.send(pdf);
  }

  @Post('requests/:id/invoice')
  async invoiceFromRequest(
    @Headers('authorization') auth: string | undefined,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    const claims = await this.requireUser(auth, 'procurement.invoice', 'create');
    const input = InvoiceDto.parse(body);

    const prices: Record<string, bigint> = {};
    for (const [variantId, toman] of Object.entries(input.pricesToman)) {
      prices[variantId] = BigInt(toman) * 10n;
    }

    const result = await createInvoiceFromRequest(this.db, {
      requestId: id,
      supplierId: input.supplierId ?? null,
      warehouseId: input.warehouseId,
      prices,
      extraCostRial: BigInt(input.extraCostToman) * 10n,
      vatRial: BigInt(input.vatToman) * 10n,
      supplierInvoiceNo: input.supplierInvoiceNo ?? null,
      issuedAt: input.issuedAt ?? null,
      dueAt: input.dueAt ?? null,
      actorId: claims.sub,
    });
    return result;
  }

  // -------------------------------------------------------------------------
  // رسیدِ انبار
  // -------------------------------------------------------------------------

  @Get('receipts')
  async getReceipts(
    @Headers('authorization') auth: string | undefined,
    @Query('status') status?: string,
    @Query('warehouseId') warehouseId?: string,
  ) {
    await this.requireUser(auth, 'procurement.receipt', 'read');
    return { items: await listGoodsReceipts(this.db, { status, warehouseId }) };
  }

  @Post('receipts')
  async addReceipt(
    @Headers('authorization') auth: string | undefined,
    @Body() body: unknown,
  ) {
    const claims = await this.requireUser(auth, 'procurement.receipt', 'create');
    const input = ReceiptDto.parse(body);

    const result = await receiveGoods(this.db, {
      purchaseInvoiceId: input.purchaseInvoiceId ?? null,
      purchaseRequestId: input.purchaseRequestId ?? null,
      supplierId: input.supplierId ?? null,
      warehouseId: input.warehouseId,
      branchId: input.branchId ?? null,
      supplierInvoiceNo: input.supplierInvoiceNo ?? null,
      carrier: input.carrier ?? null,
      trackingNo: input.trackingNo ?? null,
      discrepancyNote: input.discrepancyNote ?? null,
      receivedBy: claims.sub,
      items: input.items.map((i) => ({
        variantId: i.variantId,
        expectedQuantity: i.expectedQuantity,
        receivedQuantity: i.receivedQuantity,
        damagedQuantity: i.damagedQuantity,
        unitCostRial: BigInt(i.unitCostToman) * 10n,
        note: i.note ?? null,
      })),
    });

    // مغایرت‌ها در پاسخ برمی‌گردند تا پنل همان لحظه به انباردار نشانشان بدهد
    return {
      ...result,
      discrepancies: result.discrepancies.map((d) => ({
        ...d,
        priceDiffToman: d.priceDiffRial != null ? Number(d.priceDiffRial / 10n) : null,
      })),
    };
  }

  // -------------------------------------------------------------------------
  // برگشت به تأمین‌کننده
  // -------------------------------------------------------------------------

  @Post('supplier-returns')
  async addSupplierReturn(
    @Headers('authorization') auth: string | undefined,
    @Body() body: unknown,
  ) {
    const claims = await this.requireUser(auth, 'procurement.return', 'create');
    const input = SupplierReturnDto.parse(body);
    const result = await createSupplierReturn(this.db, {
      supplierId: input.supplierId,
      goodsReceiptId: input.goodsReceiptId ?? null,
      warehouseId: input.warehouseId ?? null,
      reason: input.reason,
      actorId: claims.sub,
      items: input.items.map((i) => ({
        variantId: i.variantId,
        quantity: i.quantity,
        unitCostRial: BigInt(i.unitCostToman) * 10n,
        reason: i.reason ?? null,
      })),
    });
    // چرا تبدیل به رشته؟ چون مبلغ در پایگاه BIGINT (ریال) است و JSON نمی‌تواند
    // BigInt را سریال کند: پاسخ با «خطایِ داخلی» شکست می‌خورد در حالی که کار
    // انجام شده — بدترین حالت برایِ کاربر، چون دوباره تلاش می‌کند و برگشت
    // دو بار ثبت می‌شود. مبالغ همیشه به‌صورتِ رشته رد و بدل می‌شوند تا در
    // جاوااسکریپت هم دقتِ ۶۴بیتی از دست نرود.
    return {
      returnNo: result.returnNo,
      returnId: result.returnId,
      totalRial: result.totalRial.toString(),
      totalToman: Number(result.totalRial / 10n),
    };
  }

  /**
   * پرداخت‌هایِ یک فاکتورِ خرید.
   *
   * چرا لازم است؟ چون «چه پرداخت کردیم» بدونِ «چه مانده» بی‌معناست، و برعکس.
   * اینجا هر دو کنارِ هم برمی‌گردند تا مدیر در یک نگاه ببیند فاکتور در چه
   * وضعی است و هر پرداخت کدام سندِ حسابداری را دارد — اگر سندی نباشد، یعنی
   * پولی جابه‌جا شده که در دفتر نیست.
   */
  @Get('invoices/:id/payments')
  async invoicePayments(
    @Headers('authorization') auth: string | undefined,
    @Param('id') invoiceId: string,
  ) {
    await this.requireUser(auth, 'procurement.payment', 'read');

    const { rows } = await this.db.query<{
      id: string;
      invoice_no: string;
      supplier_name: string;
      total_rial: string;
      payable_rial: string;
    }>(
      `SELECT id, invoice_no, supplier_name, total_rial::text, payable_rial::text
         FROM purchase_invoices WHERE id = $1`,
      [invoiceId],
    );
    const invoice = rows[0];
    if (!invoice) throw new AppError('NOT_FOUND', { message: 'فاکتور یافت نشد' });

    const payments = await listInvoicePayments(this.db, invoiceId);

    return {
      invoice: {
        id: invoice.id,
        invoiceNo: invoice.invoice_no,
        supplierName: invoice.supplier_name,
        totalRial: invoice.total_rial,
        payableRial: invoice.payable_rial,
        paidRial: (BigInt(invoice.total_rial) - BigInt(invoice.payable_rial)).toString(),
      },
      payments: payments.map((p) => ({
        ...p,
        methodLabel: PAYMENT_METHOD_LABEL[p.method as PaymentMethod] ?? p.method,
      })),
    };
  }

  /**
   * ثبتِ پرداخت به تأمین‌کننده.
   *
   * مبلغ را «ریال» می‌گیرد چون پایگاه ریال است و تومان یک قراردادِ نمایش
   * است؛ تبدیل در پنل انجام می‌شود تا در مسیرِ API هیچ گردکردنی رخ ندهد.
   */
  @Post('invoices/:id/payments')
  async payInvoice(
    @Headers('authorization') auth: string | undefined,
    @Param('id') invoiceId: string,
    @Body() body: unknown,
  ) {
    const claims = await this.requireUser(auth, 'procurement.payment', 'create');

    const parsed = PaymentDto.safeParse(body);
    if (!parsed.success) {
      throw new AppError('VALIDATION', {
        message: parsed.error.issues[0]?.message ?? 'ورودیِ پرداخت نامعتبر است',
      });
    }

    const result = await paySupplierInvoice(this.db, {
      invoiceId,
      amountRial: parsed.data.amountRial,
      method: parsed.data.method,
      paidAt: parsed.data.paidAt ?? undefined,
      referenceNo: parsed.data.referenceNo ?? null,
      checkId: parsed.data.checkId ?? null,
      note: parsed.data.note ?? null,
      actorUserId: claims.sub,
    });

    return {
      ...result,
      message: result.settled
        ? `فاکتورِ ${result.invoiceNo} تسویه شد.`
        : `پرداخت ثبت شد؛ مانده: ${(BigInt(result.remainingRial) / 10n).toLocaleString('fa-IR')} تومان`,
    };
  }

  /** وصولِ چکِ پرداختی: بدهی از «اسنادِ پرداختنی» به «بانک» منتقل می‌شود */
  @Post('payments/:id/clear')
  async clearCheck(
    @Headers('authorization') auth: string | undefined,
    @Param('id') paymentId: string,
    @Body() body: unknown,
  ) {
    const claims = await this.requireUser(auth, 'procurement.payment', 'create');
    const parsed = z.object({ clearedAt: z.coerce.date().nullish() }).safeParse(body ?? {});
    if (!parsed.success) throw new AppError('VALIDATION');

    const result = await clearSupplierCheck(this.db, {
      paymentId,
      clearedAt: parsed.data.clearedAt ?? undefined,
      actorUserId: claims.sub,
    });

    return {
      ...result,
      message: result.checkNo
        ? `چکِ ${result.checkNo} وصول شد و از حسابِ بانک رفت.`
        : 'چک وصول شد و از حسابِ بانک رفت.',
    };
  }

  /* ── مقایسه قیمت تأمین‌کنندگان ──────────────────────────────────────────── */

  @Get('suppliers/price-compare')
  async priceCompare(
    @Query('variantId') variantId: string,
    @Headers('authorization') auth?: string,
  ) {
    await this.requireUser(auth, 'procurement.request', 'read');
    if (!variantId) throw new AppError('VALIDATION', { message: 'variantId الزامی است.' });

    // قیمت از تاریخچه دستی
    const { rows } = await this.db.query(
      `SELECT DISTINCT ON (s.id)
         s.id AS supplier_id, s.name AS supplier_name,
         sph.unit_cost_rial::text, sph.recorded_at, sph.source
       FROM supplier_price_history sph
       JOIN suppliers s ON s.id = sph.supplier_id
       WHERE sph.variant_id = $1
       ORDER BY s.id, sph.recorded_at DESC`,
      [variantId],
    );

    // قیمت از رسیدهای خرید
    const { rows: receiptPrices } = await this.db.query(
      `SELECT DISTINCT ON (gr.supplier_id)
         gr.supplier_id, s.name AS supplier_name,
         gri.unit_cost_rial::text, gr.created_at
       FROM goods_receipt_items gri
       JOIN goods_receipts gr ON gr.id = gri.receipt_id
       JOIN suppliers s ON s.id = gr.supplier_id
       WHERE gri.variant_id = $1 AND gr.supplier_id IS NOT NULL
       ORDER BY gr.supplier_id, gr.created_at DESC`,
      [variantId],
    );

    const all = new Map<string, { supplierId: string; supplierName: string; unitCostRial: string; date: string; source: string }>();
    for (const r of rows) {
      all.set(r.supplier_id as string, {
        supplierId: r.supplier_id as string, supplierName: r.supplier_name as string,
        unitCostRial: r.unit_cost_rial as string, date: r.recorded_at as string, source: r.source as string,
      });
    }
    for (const r of receiptPrices) {
      if (!all.has(r.supplier_id as string)) {
        all.set(r.supplier_id as string, {
          supplierId: r.supplier_id as string, supplierName: r.supplier_name as string,
          unitCostRial: r.unit_cost_rial as string, date: r.created_at as string, source: 'receipt',
        });
      }
    }

    const items = [...all.values()].sort((a, b) => Number(BigInt(a.unitCostRial) - BigInt(b.unitCostRial)));
    return { items, cheapest: items[0] ?? null };
  }

  @Post('suppliers/:id/price')
  async recordSupplierPrice(
    @Param('id') supplierId: string,
    @Body() body: unknown,
    @Headers('authorization') auth?: string,
  ) {
    await this.requireUser(auth, 'procurement.request', 'create');
    const input = z.object({
      variantId: z.string().uuid(),
      unitCostRial: z.string(),
    }).parse(body);

    await this.db.query(
      `INSERT INTO supplier_price_history (supplier_id, variant_id, unit_cost_rial, source)
       VALUES ($1, $2, $3, 'manual')`,
      [supplierId, input.variantId, input.unitCostRial],
    );
    return { message: 'قیمت تأمین‌کننده ثبت شد.' };
  }
}
