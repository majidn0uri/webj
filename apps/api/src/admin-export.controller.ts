/**
 * خروجی‌هایِ رسمی — اکسل و پی‌دی‌اف.
 * ============================================================================
 *
 * پرسشِ اصلی اینجا این نیست که «چطور فایل بسازیم» (آن را بسته‌ی
 * `@set/exports` می‌داند)؛ پرسش این است که **چه کسی، از چه داده‌ای، با چه
 * دسترسی‌ای** خروجی می‌گیرد. پس این کنترل‌کننده سه کار می‌کند و نه بیشتر:
 *
 *   ۱. **دسترسی.** خروجیِ گزارش‌هایِ مدیریتی با `reports.export` است (حسابدار
 *      و مدیر کل) و چاپِ فاکتورِ یک سفارش با `order.read` (فروشنده هم باید
 *      بتواند فاکتورِ مشتری‌اش را چاپ کند). آمیختنِ این دو یعنی یا فروشنده به
 *      سودِ شرکت دسترسی پیدا می‌کند، یا حسابدار برایِ چاپِ فاکتور گیر می‌کند.
 *
 *   ۲. **صافی‌ها.** تاریخ را کاربر شمسی می‌فرستد (۱۴۰۵/۰۶/۲۰) و SQL میلادی
 *      می‌خواهد؛ تبدیل در یک‌جا انجام می‌شود. هر صافی‌ای که در فهرستِ سفارشِ
 *      پنل هست، اینجا هم هست — وگرنه کاربر باید دو جا را یاد بگیرد.
 *
 *   ۳. **سقف.** خروجیِ بی‌سقف از یک پایگاهِ بزرگ، هم حافظه‌یِ سرور را می‌گیرد
 *      و هم پرونده‌ای می‌سازد که در اکسل باز نمی‌شود. سقف اینجا است و اگر
 *      داده بیشتر باشد، **خودِ پرونده می‌گوید** که بریده شده — تا کسی گمان
 *      نکند همه‌یِ داده را دارد.
 *
 * چرا فایل از اینجا و نه از وب؟ چون توکنِ مدیر در کوکیِ httpOnly است و
 * مرورگر به آن دسترسی ندارد. مسیرِ وب (`/api/admin/exports/...`) تنها توکن
 * را از کوکی می‌خواند و پاسخ را بی‌کم‌وکاست به مرورگر می‌رساند.
 */

import { Controller, Get, Headers, Inject, Param, Query, Res } from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import { z } from 'zod';
import { AppError, formatJalali, parseJalali } from '@set/shared-kernel';
import type { Database } from '@set/db';
import type { AccessControl } from '@set/rbac';
import type { AccessClaims, TokenService } from '@set/auth';
import { grossProfit, type GrossProfitGrouping } from '@set/reports';
import {
  renderInvoicePdf,
  renderReportExcel,
  renderReportPdf,
  reportFileName,
  type InvoiceSpec,
  type ReportMeta,
  type ReportSpec,
} from '@set/exports';
import { DB, TOKEN_SERVICE, ACCESS_CONTROL } from './tokens.js';

/* --------------------------------- صافی‌ها -------------------------------- */

/** بیشینه‌یِ سطرهایی که در یک خروجی می‌نشیند */
const MAX_ROWS = 10_000;

const ExportQuery = z.object({
  from: z.string().max(32).nullish(),
  to: z.string().max(32).nullish(),
  status: z.string().max(32).nullish(),
  channel: z.string().max(16).nullish(),
  groupBy: z.enum(['variant', 'brand', 'product_type', 'day']).nullish(),
  /** فقط کالاهایی که موجودی‌شان از این کمتر است */
  lowOnly: z
    .string()
    .transform((value) => value === 'true' || value === '1')
    .nullish(),
});

/** تاریخ را از ورودیِ کاربر می‌خواند: شمسی (۱۴۰۵/۰۶/۲۰) یا میلادی (ISO) */
function toDate(input: string | undefined, fallback: Date, endOfDay = false): Date {
  if (!input) return fallback;
  const jalali = parseJalali(input);
  if (jalali) {
    if (endOfDay) {
      // انتهایِ روزِ شمسی: فردا، منهایِ یک میلی‌ثانیه (بازه ناشمول است)
      return new Date(jalali.getTime() + 24 * 60 * 60 * 1000 - 1);
    }
    return jalali;
  }
  const iso = new Date(input);
  if (!Number.isNaN(iso.getTime())) return iso;
  throw new AppError('VALIDATION', {
    message: `تاریخ نامعتبر است: «${input}». تاریخ را شمسی وارد کنید، مثلِ ${formatJalali(new Date())}`,
  });
}

const PERSIAN_STATUS: Record<string, string> = {
  pending_payment: 'در انتظارِ پرداخت',
  paid: 'پرداخت‌شده',
  processing: 'در حالِ آماده‌سازی',
  shipped: 'ارسال‌شده',
  delivered: 'تحویل‌شده',
  cancelled: 'ابطال‌شده',
  refunded: 'مسترد‌شده',
  confirmed: 'تأیید‌شده',
  packing: 'در حالِ بسته‌بندی',
};

const PERSIAN_CHANNEL: Record<string, string> = {
  web: 'اینترنتی',
  pos: 'حضوری (صندوق)',
  phone: 'تلفنی',
};

/* ------------------------------ کنترل‌کننده ------------------------------- */

@Controller('admin/exports')
export class AdminExportController {
  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(TOKEN_SERVICE) private readonly tokens: TokenService,
    @Inject(ACCESS_CONTROL) private readonly access: AccessControl,
  ) {}

  /** توکن را می‌خواند و دسترسی را وارسی می‌کند */
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

  /**
   * فرستادنِ یک پرونده.
   *
   * دو نام در سربرگ فرستاده می‌شود: یکی لاتین (`filename`) برایِ ابزارهایی که
   * یوتی‌اف-۸ را درست نمی‌فهمند، و یکی یوتی‌اف-۸ (`filename*=`) تا نامِ
   * فارسی در مرورگرِ کاربر درست دیده شود. بی‌دومی، نامِ پرونده در ویندوزِ
   * فارسی به صورتِ «???» می‌نشیند — کوچک است، اما هر روز دیده می‌شود.
   */
  private send(reply: FastifyReply, body: Buffer, fileName: string, contentType: string): void {
    const ascii = fileName.replace(/[^\x20-\x7E]/g, '_');
    const encoded = encodeURIComponent(fileName);
    reply.header('content-type', contentType);
    reply.header('content-length', String(body.length));
    reply.header('cache-control', 'no-store');
    reply.header(
      'content-disposition',
      `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`,
    );
    reply.send(body);
  }

  /* ─────────────────── فهرستِ خروجی‌ها (برایِ پنل) ─────────────────── */

  /**
   * کارنامه‌یِ خروجی‌ها.
   *
   * چرا یک مسیرِ جدا برایِ فهرست؟ چون پنل نباید بداند چند خروجی هست؛ باید
   * بپرسد. با این کار، افزودنِ یک خروجیِ تازه در سرور کافی است تا در پنل
   * پیدا شود — بی‌آن‌که کسی دست به کدِ رابط ببرد.
   */
  @Get('manifest')
  async manifest(@Headers('authorization') authorization?: string) {
    await this.requireUser(authorization, 'reports', 'export');

    return {
      items: [
        {
          key: 'orders',
          label: 'گزارشِ سفارش‌ها',
          hint: 'هر سفارش در یک سطر، با مبلغ و وضعیت',
          formats: ['xlsx', 'pdf'] as const,
          filters: ['from', 'to', 'status', 'channel'] as const,
        },
        {
          key: 'products',
          label: 'گزارشِ کالاها',
          hint: 'کالا، تنوع، قیمت و موجودی',
          formats: ['xlsx'] as const,
          filters: [] as const,
        },
        {
          key: 'inventory',
          label: 'گزارشِ موجودیِ انبار',
          hint: 'موجودی، رزرو و قابلِ فروش به تفکیکِ انبار',
          formats: ['xlsx'] as const,
          filters: ['lowOnly'] as const,
        },
        {
          key: 'customers',
          label: 'گزارشِ مشتریان',
          hint: 'تعداد و مبلغِ خرید، و آخرین سفارش',
          formats: ['xlsx'] as const,
          filters: [] as const,
        },
        {
          key: 'gross-profit',
          label: 'گزارشِ سودِ ناخالص',
          hint: 'درآمد، بهایِ تمام‌شده و حاشیه‌ی سود',
          formats: ['xlsx', 'pdf'] as const,
          filters: ['from', 'to', 'groupBy'] as const,
        },
      ],
    };
  }

  /* ─────────────────────────── سفارش‌ها ─────────────────────────── */

  /** داده‌یِ خامِ سفارش‌ها با صافی‌هایِ رایج */
  private async orderRows(query: {
    from?: string | null;
    to?: string | null;
    status?: string | null;
    channel?: string | null;
  }): Promise<{
    rows: Array<Record<string, string | number | null>>;
    meta: ReportMeta[];
    truncated: boolean;
    total: number;
  }> {
    const from = toDate(query.from ?? undefined, new Date(Date.now() - 30 * 24 * 3600 * 1000));
    const to = toDate(query.to ?? undefined, new Date(), true);

    const params: unknown[] = [from.toISOString(), to.toISOString()];
    let where = 'WHERE o.created_at >= $1::timestamptz AND o.created_at <= $2::timestamptz';

    if (query.status) {
      params.push(query.status);
      where += ` AND o.status = $${params.length}`;
    }
    if (query.channel) {
      params.push(query.channel);
      where += ` AND o.channel = $${params.length}`;
    }

    const { rows: counted } = await this.db.query<{ n: string }>(
      `SELECT COUNT(*)::text AS n FROM orders o ${where}`,
      params,
    );
    const total = Number(counted[0]?.n ?? 0);

    params.push(MAX_ROWS + 1);
    const { rows } = await this.db.query<{
      order_no: string;
      status: string;
      channel: string;
      subtotal_rial: string;
      discount_rial: string;
      tax_rial: string;
      shipping_rial: string;
      total_rial: string;
      created_at: string;
      paid_at: string | null;
      customer_name: string | null;
      customer_mobile: string | null;
      items_count: string;
    }>(
      `SELECT o.order_no, o.status, o.channel,
              o.subtotal_rial, o.discount_rial, o.tax_rial, o.shipping_rial, o.total_rial,
              o.created_at, o.paid_at, o.customer_name, o.customer_mobile,
              (SELECT COUNT(*) FROM order_items oi WHERE oi.order_id = o.id)::text AS items_count
         FROM orders o
         ${where}
        ORDER BY o.created_at DESC
        LIMIT $${params.length}`,
      params,
    );

    const truncated = rows.length > MAX_ROWS;
    const visible = truncated ? rows.slice(0, MAX_ROWS) : rows;

    return {
      rows: visible.map((row) => ({
        orderNo: row.order_no,
        createdAt: row.created_at,
        paidAt: row.paid_at,
        customerName: row.customer_name ?? '—',
        customerMobile: row.customer_mobile ?? '—',
        status: PERSIAN_STATUS[row.status] ?? row.status,
        channel: PERSIAN_CHANNEL[row.channel] ?? row.channel,
        itemsCount: Number(row.items_count),
        subtotalRial: Number(row.subtotal_rial),
        discountRial: Number(row.discount_rial),
        taxRial: Number(row.tax_rial),
        shippingRial: Number(row.shipping_rial),
        totalRial: Number(row.total_rial),
      })),
      meta: [
        { label: 'بازه‌یِ گزارش', value: `${formatJalali(from)} تا ${formatJalali(to)}` },
        { label: 'تعدادِ سفارش', value: String(rows.length) },
        { label: 'وضعیت', value: query.status ? (PERSIAN_STATUS[query.status] ?? query.status) : 'همه' },
        { label: 'کانال', value: query.channel ? (PERSIAN_CHANNEL[query.channel] ?? query.channel) : 'همه' },
      ],
      truncated,
      total,
    };
  }

  private ordersSpec(
    data: Awaited<ReturnType<AdminExportController['orderRows']>>,
  ): ReportSpec {
    return {
      title: 'گزارشِ سفارش‌ها',
      subtitle: 'سفارش‌هایِ ثبت‌شده در بازه‌یِ انتخابی، منظم بر پایه‌یِ تاریخ',
      sheetName: 'سفارش‌ها',
      fileBase: 'orders',
      meta: data.meta,
      columns: [
        { key: 'orderNo', title: 'شماره‌یِ سفارش', type: 'text' },
        { key: 'createdAt', title: 'تاریخِ ثبت', type: 'datetime' },
        { key: 'paidAt', title: 'تاریخِ پرداخت', type: 'datetime' },
        { key: 'customerName', title: 'مشتری', type: 'text' },
        { key: 'customerMobile', title: 'تلفن', type: 'text', align: 'left' },
        { key: 'channel', title: 'کانال', type: 'text' },
        { key: 'status', title: 'وضعیت', type: 'text' },
        { key: 'itemsCount', title: 'تعدادِ اقلام', type: 'number', sum: true },
        { key: 'subtotalRial', title: 'جمعِ کالاها (ریال)', type: 'money', sum: true },
        { key: 'discountRial', title: 'تخفیف (ریال)', type: 'money', sum: true },
        { key: 'shippingRial', title: 'ارسال (ریال)', type: 'money', sum: true },
        { key: 'taxRial', title: 'مالیات (ریال)', type: 'money', sum: true },
        { key: 'totalRial', title: 'قابلِ پرداخت (ریال)', type: 'money', sum: true },
      ],
      rows: data.rows,
      landscape: true,
      note: data.truncated
        ? `این خروجی به ${MAX_ROWS.toLocaleString('fa-IR')} سطر بریده شده است (از ${data.total.toLocaleString('fa-IR')} سطر). برایِ گرفتنِ همه‌یِ داده، بازه را کوتاه‌تر کنید.`
        : 'مبالغ به ریال و بر پایه‌یِ سفارش‌هایِ ثبت‌شده است؛ سفارش‌هایِ لغوشده هم با مبلغِ صفر در گزارش نیستند مگر اینکه صافیِ وضعیت را بردارید.',
    };
  }

  @Get('orders.xlsx')
  async ordersExcel(
    @Headers('authorization') authorization: string | undefined,
    @Query() raw: unknown,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    await this.requireUser(authorization, 'reports', 'export');
    const query = ExportQuery.parse(raw ?? {});
    const spec = this.ordersSpec(await this.orderRows(query));
    const buffer = await renderReportExcel(spec);
    this.send(
      reply,
      buffer,
      reportFileName(spec, 'xlsx'),
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
  }

  @Get('orders.pdf')
  async ordersPdf(
    @Headers('authorization') authorization: string | undefined,
    @Query() raw: unknown,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    await this.requireUser(authorization, 'reports', 'export');
    const query = ExportQuery.parse(raw ?? {});
    const spec = this.ordersSpec(await this.orderRows(query));
    const buffer = renderReportPdf(spec);
    this.send(reply, buffer, reportFileName(spec, 'pdf'), 'application/pdf');
  }

  /* ─────────────────────────── فاکتور ─────────────────────────── */

  /** مشخصاتِ فروشنده از تنظیماتِ فروشگاه — همان‌جا که مدیر در پنل پر کرده */
  private async sellerInfo(): Promise<InvoiceSpec['seller']> {
    const { rows } = await this.db.query<{ key: string; value: string }>(
      `SELECT key, value FROM store_settings
        WHERE key IN ('store_name','store_phone','store_address','store_national_id','store_economic_code','store_postal_code')`,
    );
    const map = new Map(rows.map((row) => [row.key, row.value]));
    return {
      name: map.get('store_name') ?? 'ست‌شاپ',
      phone: map.get('store_phone') ?? null,
      address: map.get('store_address') ?? null,
      nationalId: map.get('store_national_id') || map.get('store_economic_code') || null,
      economicCode: map.get('store_economic_code') ?? null,
      postalCode: map.get('store_postal_code') ?? null,
    };
  }

  /**
   * نشانی را از مُشتِری می‌خواند.
   *
   * چرا این تابع؟ چون `shipping_address` در پایگاه یک مُشتِریِ JSON است
   * (‎`{"province":"تهران","city":"تهران","address":"...","postalCode":"..."}`‎).
   * چاپِ همان رشته رویِ فاکتور یعنی مشتری در برگه‌یِ رسمی، نشانه‌هایِ
   * برنامه‌نویسی می‌بیند. نشانی باید به زبانِ آدمیزاد نوشته شود.
   */
  private humanAddress(raw: string | null): string | null {
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      const parts: string[] = [];
      const province = typeof parsed.province === 'string' ? parsed.province : '';
      const city = typeof parsed.city === 'string' ? parsed.city : '';
      const street = typeof parsed.address === 'string' ? parsed.address : '';
      const postal = typeof parsed.postalCode === 'string' ? parsed.postalCode : '';
      const receiver = typeof parsed.receiverName === 'string' ? parsed.receiverName : '';

      if (province) parts.push(province);
      if (city && city !== province) parts.push(city);
      if (street) parts.push(street);
      if (postal) parts.push(`کدِ پستی: ${postal}`);
      if (receiver) parts.push(`گیرنده: ${receiver}`);
      return parts.length > 0 ? parts.join('، ') : null;
    } catch {
      // اگر مُشتِری خراب یا یک رشته‌یِ ساده بود، همان را می‌نویسیم
      return raw;
    }
  }

  /**
   * فاکتورِ یک سفارش.
   *
   * چرا با `order.read` و نه `reports.export`؟ چون چاپِ فاکتور کارِ روزِ
   * فروشنده است؛ او به سودِ شرکت دسترسی ندارد اما باید بتواند برایِ مشتری‌ای
   * که روبه‌رویش ایستاده فاکتور بکشد.
   */
  @Get('orders/:id/invoice.pdf')
  async orderInvoice(
    @Param('id') id: string,
    @Headers('authorization') authorization: string | undefined,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    await this.requireUser(authorization, 'order', 'read');

    const { rows: orderRows } = await this.db.query<{
      id: string;
      order_no: string;
      status: string;
      channel: string;
      subtotal_rial: string;
      discount_rial: string;
      tax_rial: string;
      shipping_rial: string;
      total_rial: string;
      created_at: string;
      paid_at: string | null;
      customer_name: string | null;
      customer_mobile: string | null;
      shipping_address: string | null;
      branch_id: string | null;
    }>(
      `SELECT id, order_no, status, channel, subtotal_rial, discount_rial, tax_rial,
              shipping_rial, total_rial, created_at, paid_at, customer_name, customer_mobile,
              shipping_address::text, branch_id
         FROM orders WHERE id = $1`,
      [id],
    );
    const order = orderRows[0];
    if (!order) throw new AppError('NOT_FOUND', { message: 'سفارشی با این شناسه پیدا نشد.' });

    const { rows: itemRows } = await this.db.query<{
      title: string;
      sku: string;
      quantity: number;
      unit_price_rial: string;
      discount_rial: string;
      tax_rial: string;
      total_rial: string;
    }>(
      `SELECT p.title, v.sku, oi.quantity, oi.unit_price_rial, oi.discount_rial, oi.tax_rial, oi.total_rial
         FROM order_items oi
         JOIN product_variants v ON v.id = oi.variant_id
         JOIN products p ON p.id = v.product_id
        WHERE oi.order_id = $1
        ORDER BY p.title`,
      [id],
    );

    // مشتری: اگر در سامانه ثبت شده، شناسه و نشانی‌اش از جدولِ مشتریان می‌آید
    let buyer: InvoiceSpec['buyer'] = null;
    if (order.customer_mobile) {
      const { rows: customerRows } = await this.db.query<{
        full_name: string;
        phone: string;
        national_id: string | null;
      }>(`SELECT full_name, phone, national_id FROM customers WHERE phone = $1`, [order.customer_mobile]);
      const customer = customerRows[0];
      if (customer) {
        buyer = {
          name: customer.full_name,
          phone: customer.phone,
          nationalId: customer.national_id,
          address: this.humanAddress(order.shipping_address),
        };
      } else {
        buyer = {
          name: order.customer_name ?? 'مشتری',
          phone: order.customer_mobile,
          address: this.humanAddress(order.shipping_address),
        };
      }
    }

    const { rows: vatRows } = await this.db.query<{ value: string }>(
      `SELECT value FROM store_settings WHERE key = 'vat_rate_percent'`,
    );
    const vatRate = Number(vatRows[0]?.value ?? 0) || undefined;

    const spec: InvoiceSpec = {
      number: order.order_no,
      issuedAt: order.created_at,
      status: order.status,
      seller: await this.sellerInfo(),
      buyer,
      lines: itemRows.map((item) => ({
        title: item.title,
        sku: item.sku,
        unit: 'عدد',
        quantity: item.quantity,
        unitPriceRial: Number(item.unit_price_rial),
        discountRial: Number(item.discount_rial),
        taxRial: Number(item.tax_rial),
        totalRial: Number(item.total_rial),
      })),
      discountRial: Number(order.discount_rial),
      shippingRial: Number(order.shipping_rial),
      taxRial: Number(order.tax_rial),
      taxRatePercent: vatRate,
      paymentMethod:
        order.channel === 'pos' ? 'پرداخت در محل (صندوق)' : order.paid_at ? 'پرداختِ آنلاین' : 'در انتظارِ پرداخت',
      note: 'این صورتحساب به صورتِ رایانامه‌ای صادر شده و نیازی به مهر و امضا ندارد.',
    };

    const buffer = renderInvoicePdf(spec);
    this.send(
      reply,
      buffer,
      `فاکتور-${order.order_no}.pdf`,
      'application/pdf',
    );
  }

  /* ─────────────────────────── کالاها ─────────────────────────── */

  @Get('products.xlsx')
  async productsExcel(
    @Headers('authorization') authorization: string | undefined,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    await this.requireUser(authorization, 'reports', 'export');

    const { rows } = await this.db.query<{
      title: string;
      slug: string;
      status: string;
      brand: string | null;
      product_type: string | null;
      sku: string;
      price_rial: string;
      is_active: boolean;
      on_hand: string | null;
      reserved: string | null;
    }>(
      `SELECT p.title, p.slug, p.status, b.name AS brand, pt.name AS product_type,
              v.sku, v.price_rial, v.is_active,
              COALESCE(s.on_hand, 0)::text AS on_hand, COALESCE(s.reserved, 0)::text AS reserved
         FROM product_variants v
         JOIN products p ON p.id = v.product_id
         LEFT JOIN brands b ON b.id = p.brand_id
         LEFT JOIN product_types pt ON pt.id = p.type_id
         LEFT JOIN (SELECT variant_id, SUM(on_hand) AS on_hand, SUM(reserved) AS reserved
                      FROM stock_items GROUP BY variant_id) s ON s.variant_id = v.id
        ORDER BY p.title, v.sku
        LIMIT $1`,
      [MAX_ROWS],
    );

    const spec: ReportSpec = {
      title: 'گزارشِ کالاها',
      subtitle: 'کالاها و تنوع‌هایشان با قیمت و موجودیِ کل',
      sheetName: 'کالاها',
      fileBase: 'products',
      meta: [
        { label: 'تعدادِ تنوع', value: String(rows.length) },
        { label: 'تاریخِ گرفتنِ خروجی', value: formatJalali(new Date()) },
      ],
      columns: [
        { key: 'title', title: 'کالا', type: 'text' },
        { key: 'brand', title: 'برند', type: 'text' },
        { key: 'productType', title: 'نوع', type: 'text' },
        { key: 'sku', title: 'کد (SKU)', type: 'text', align: 'left' },
        { key: 'priceRial', title: 'قیمت (ریال)', type: 'money', sum: true },
        { key: 'onHand', title: 'موجودی', type: 'number', sum: true },
        { key: 'reserved', title: 'رزرو‌شده', type: 'number', sum: true },
        { key: 'available', title: 'قابلِ فروش', type: 'number', sum: true },
        { key: 'status', title: 'وضعیتِ کالا', type: 'text' },
        { key: 'variantActive', title: 'تنوع فعال؟', type: 'boolean' },
      ],
      rows: rows.map((row) => {
        const onHand = Number(row.on_hand ?? 0);
        const reserved = Number(row.reserved ?? 0);
        return {
          title: row.title,
          brand: row.brand ?? '—',
          productType: row.product_type ?? '—',
          sku: row.sku,
          priceRial: Number(row.price_rial),
          onHand,
          reserved,
          available: onHand - reserved,
          status: row.status === 'active' ? 'فعال' : row.status === 'draft' ? 'پیش‌نویس' : 'بایگانی',
          variantActive: row.is_active,
        };
      }),
      note: 'موجودیِ هر تنوع، جمعِ همه‌یِ انبارهاست. مبالغ به ریال است.',
    };

    const buffer = await renderReportExcel(spec);
    this.send(
      reply,
      buffer,
      reportFileName(spec, 'xlsx'),
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
  }

  /* ───────────────────────── موجودیِ انبار ─────────────────────── */

  @Get('inventory.xlsx')
  async inventoryExcel(
    @Headers('authorization') authorization: string | undefined,
    @Query() raw: unknown,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    await this.requireUser(authorization, 'reports', 'export');
    const query = ExportQuery.parse(raw ?? {});

    const { rows } = await this.db.query<{
      sku: string;
      title: string;
      warehouse: string;
      on_hand: number;
      reserved: number;
    }>(
      `SELECT v.sku, p.title, w.name AS warehouse, s.on_hand, s.reserved
         FROM stock_items s
         JOIN product_variants v ON v.id = s.variant_id
         JOIN products p ON p.id = v.product_id
         JOIN warehouses w ON w.id = s.warehouse_id
        ORDER BY (s.on_hand - s.reserved) ASC, p.title
        LIMIT $1`,
      [MAX_ROWS],
    );

    const spec: ReportSpec = {
      title: 'گزارشِ موجودیِ انبار',
      subtitle: 'مرتب بر پایه‌یِ کمترین مقدارِ قابلِ فروش — آنچه زودتر تمام می‌شود، بالاتر است',
      sheetName: 'موجودی',
      fileBase: 'inventory',
      meta: [
        { label: 'تعدادِ ردیف', value: String(rows.length) },
        { label: 'صافی', value: query.lowOnly ? 'فقط کالاهایِ کم‌موجود' : 'همه‌یِ کالاها' },
        { label: 'تاریخِ گرفتنِ خروجی', value: formatJalali(new Date()) },
      ],
      columns: [
        { key: 'title', title: 'کالا', type: 'text' },
        { key: 'sku', title: 'کد (SKU)', type: 'text', align: 'left' },
        { key: 'warehouse', title: 'انبار', type: 'text' },
        { key: 'onHand', title: 'موجودی', type: 'number', sum: true },
        { key: 'reserved', title: 'رزرو‌شده', type: 'number', sum: true },
        { key: 'available', title: 'قابلِ فروش', type: 'number', sum: true },
      ],
      rows: rows.map((row) => ({
        title: row.title,
        sku: row.sku,
        warehouse: row.warehouse,
        onHand: row.on_hand,
        reserved: row.reserved,
        available: row.on_hand - row.reserved,
      })),
      note: '«قابلِ فروش» یعنی موجودی منهایِ رزرو‌شده؛ همان عددی که مشتری در سایت می‌بیند.',
    };

    const buffer = await renderReportExcel(spec);
    this.send(
      reply,
      buffer,
      reportFileName(spec, 'xlsx'),
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
  }

  /* ─────────────────────────── مشتریان ────────────────────────── */

  @Get('customers.xlsx')
  async customersExcel(
    @Headers('authorization') authorization: string | undefined,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    await this.requireUser(authorization, 'reports', 'export');

    const { rows } = await this.db.query<{
      full_name: string;
      phone: string;
      national_id: string | null;
      kind: string;
      is_partner: boolean;
      credit_rial: string;
      created_at: string;
      orders_count: string;
      total_rial: string | null;
      last_order_at: string | null;
    }>(
      `SELECT c.full_name, c.phone, c.national_id, c.kind, c.is_partner, c.credit_rial, c.created_at,
              COUNT(o.id)::text AS orders_count,
              COALESCE(SUM(o.total_rial) FILTER (WHERE o.status <> 'cancelled'), 0)::text AS total_rial,
              MAX(o.created_at) AS last_order_at
         FROM customers c
         LEFT JOIN orders o ON o.customer_mobile = c.phone
        GROUP BY c.id
        ORDER BY SUM(o.total_rial) DESC NULLS LAST, c.full_name
        LIMIT $1`,
      [MAX_ROWS],
    );

    const spec: ReportSpec = {
      title: 'گزارشِ مشتریان',
      subtitle: 'بر پایه‌یِ مجموعِ خرید — آنکه بیشتر خریده، بالاتر است',
      sheetName: 'مشتریان',
      fileBase: 'customers',
      meta: [
        { label: 'تعدادِ مشتری', value: String(rows.length) },
        { label: 'تاریخِ گرفتنِ خروجی', value: formatJalali(new Date()) },
      ],
      columns: [
        { key: 'fullName', title: 'نام', type: 'text' },
        { key: 'phone', title: 'تلفن', type: 'text', align: 'left' },
        { key: 'nationalId', title: 'کدِ ملی', type: 'text', align: 'left' },
        { key: 'kind', title: 'نوع', type: 'text' },
        { key: 'partner', title: 'همکار؟', type: 'boolean' },
        { key: 'ordersCount', title: 'تعدادِ سفارش', type: 'number', sum: true },
        { key: 'totalRial', title: 'مجموعِ خرید (ریال)', type: 'money', sum: true },
        { key: 'creditRial', title: 'اعتبار (ریال)', type: 'money', sum: true },
        { key: 'lastOrderAt', title: 'آخرین خرید', type: 'datetime' },
        { key: 'createdAt', title: 'تاریخِ عضویت', type: 'date' },
      ],
      rows: rows.map((row) => ({
        fullName: row.full_name,
        phone: row.phone,
        nationalId: row.national_id ?? '—',
        kind: row.kind === 'partner' ? 'همکار' : row.kind === 'in_person' ? 'حضوری' : 'اینترنتی',
        partner: row.is_partner,
        ordersCount: Number(row.orders_count),
        totalRial: Number(row.total_rial ?? 0),
        creditRial: Number(row.credit_rial),
        lastOrderAt: row.last_order_at,
        createdAt: row.created_at,
      })),
      note: 'سفارش‌هایِ لغوشده در مجموعِ خرید نیامده‌اند. اعتبار، بستانکاریِ حاصل از مرجوعی است.',
    };

    const buffer = await renderReportExcel(spec);
    this.send(
      reply,
      buffer,
      reportFileName(spec, 'xlsx'),
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
  }

  /* ─────────────────────── سودِ ناخالص ─────────────────────── */

  private async profitSpec(
    query: { from?: string | null; to?: string | null; groupBy?: GrossProfitGrouping | null },
  ): Promise<ReportSpec> {
    const from = toDate(query.from ?? undefined, new Date(Date.now() - 30 * 24 * 3600 * 1000));
    const to = toDate(query.to ?? undefined, new Date(), true);
    const groupBy: GrossProfitGrouping = query.groupBy ?? 'variant';

    const report = await grossProfit(this.db, { from, to, groupBy });

    return {
      title: 'گزارشِ سودِ ناخالص',
      subtitle: `گروه‌بندی بر پایه‌یِ ${
        groupBy === 'variant' ? 'کالا' : groupBy === 'brand' ? 'برند' : groupBy === 'product_type' ? 'نوعِ کالا' : 'روز'
      }`,
      sheetName: 'سودِ ناخالص',
      fileBase: 'gross-profit',
      meta: [
        { label: 'بازه‌یِ گزارش', value: `${formatJalali(from)} تا ${formatJalali(to)}` },
        { label: 'تعدادِ ردیف', value: String(report.rows.length) },
        { label: 'فروشِ کل', value: `${Number(report.totals.revenueRial).toLocaleString('fa-IR')} ریال` },
      ],
      columns: [
        { key: 'label', title: groupBy === 'day' ? 'روز' : 'عنوان', type: 'text' },
        { key: 'quantity', title: 'تعدادِ فروخته‌شده', type: 'number', sum: true },
        { key: 'revenueRial', title: 'درآمد (ریال)', type: 'money', sum: true },
        { key: 'cogsRial', title: 'بهایِ تمام‌شده (ریال)', type: 'money', sum: true },
        { key: 'grossProfitRial', title: 'سودِ ناخالص (ریال)', type: 'money', sum: true },
        { key: 'marginPercent', title: 'حاشیه‌یِ سود', type: 'percent' },
      ],
      rows: report.rows.slice(0, MAX_ROWS).map((row) => ({
        label: row.label,
        quantity: row.quantity,
        revenueRial: Number(row.revenueRial),
        cogsRial: Number(row.cogsRial),
        grossProfitRial: Number(row.grossProfitRial),
        marginPercent: Math.round(row.marginPercent * 10) / 10,
      })),
      landscape: true,
      note: 'بهایِ تمام‌شده از «تکانه‌یِ بهایِ تمام‌شده» (COGS snapshot) در لحظه‌یِ فروش است؛ پس با تغییرِ قیمتِ خرید، عددِ گذشته عوض نمی‌شود.',
    };
  }

  @Get('gross-profit.xlsx')
  async grossProfitExcel(
    @Headers('authorization') authorization: string | undefined,
    @Query() raw: unknown,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    await this.requireUser(authorization, 'reports', 'export');
    const query = ExportQuery.parse(raw ?? {});
    const spec = await this.profitSpec(query);
    const buffer = await renderReportExcel(spec);
    this.send(
      reply,
      buffer,
      reportFileName(spec, 'xlsx'),
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
  }

  @Get('gross-profit.pdf')
  async grossProfitPdf(
    @Headers('authorization') authorization: string | undefined,
    @Query() raw: unknown,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    await this.requireUser(authorization, 'reports', 'export');
    const query = ExportQuery.parse(raw ?? {});
    const spec = await this.profitSpec(query);
    const buffer = renderReportPdf(spec);
    this.send(reply, buffer, reportFileName(spec, 'pdf'), 'application/pdf');
  }
}
