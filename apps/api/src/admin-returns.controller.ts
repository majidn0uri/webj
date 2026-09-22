import { Body, Controller, Get, Headers, HttpCode, Inject, Param, Post, Query, Res } from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import { AppError, formatJalali, formatToman, isUuid, jalaliDateOf, toIsoDate } from '@set/shared-kernel';
import type { Database } from '@set/db';
import { renderInvoicePdf, type InvoiceSpec } from '@set/exports';
import type { AccessControl } from '@set/rbac';
import type { AccessClaims, TokenService } from '@set/auth';
import {
  cancelReturn,
  decideReturn,
  getReturn,
  listReturns,
  markInTransit,
  quoteReturn,
  receiveReturn,
  refundReturn,
  requestReturn,
  returnSummary,
  claimWarranty,
  expiringWarranties,
  listWarranties,
  startWarranty,
  ITEM_CONDITION_LABELS,
  REFUND_METHOD_LABELS,
  RETURN_KINDS,
  RETURN_STATUS_LABELS,
} from '@set/returns';
import type { ItemCondition, RefundMethod, ReturnKind, ReturnStatus } from '@set/returns';
import { DB, TOKEN_SERVICE, ACCESS_CONTROL } from './tokens.js';

/**
 * مرجوعیِ مشتری و گارانتی.
 *
 * سه تصمیم در این مسیرها:
 *
 *  ۱) **وجه فقط پس از بازرسی برمی‌گردد.** هیچ مسیری نیست که بشود از رویِ
 *     درخواستِ مشتری، بی‌آنکه کالا به انبار رسیده و بازرسی شده باشد، پولی را
 *     برگرداند. این نه بی‌اعتمادی به مشتری که احتیاطِ حسابداری است: پولی که
 *     رفت، دیگر پس‌گرفتنی نیست.
 *
 *  ۲) **دو دسترسیِ جدا.** «دیدنِ مرجوعی» از «تغییر دادنِ آن» جداست؛ پشتیبان
 *     می‌تواند وضعیت را به مشتری بگوید اما نمی‌تواند وجهی را برگرداند
 *     (`returns.read` در برابرِ `returns.manage`).
 *
 *  ۳) **هر تغییر، رخداد می‌نویسد.** در اختلاف (گم شدنِ مرسوله، دیر رسیدنِ
 *     وجه) آنچه کار را پیش می‌برد خطِ زمانِ مرجوعی است، نه حافظه‌یِ کارمند.
 */
@Controller('admin/returns')
export class AdminReturnsController {
  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(TOKEN_SERVICE) private readonly tokens: TokenService,
    @Inject(ACCESS_CONTROL) private readonly access: AccessControl,
  ) {}

  private async require(
    authorization: string | undefined,
    permission: 'returns.read' | 'returns.manage' | 'warranty.read',
  ): Promise<AccessClaims> {
    const token = authorization?.startsWith('Bearer ') ? authorization.slice(7) : undefined;
    if (!token) throw new AppError('UNAUTHENTICATED');
    const claims = await this.tokens.verifyAccess(token);
    if (!claims) throw new AppError('UNAUTHENTICATED');
    const [resource, action] = permission.split('.');
    await this.access.assert({ userId: claims.sub, branchId: null }, resource!, action!);
    return claims;
  }

  /** خلاصه‌ی کارتابل + فهرست‌ها برایِ ساختنِ رابط (بی‌نیاز از کدنویسیِ فرم) */
  @Get('reference')
  async reference(@Headers('authorization') authorization: string | undefined) {
    await this.require(authorization, 'returns.read');
    const [summary, expiring] = await Promise.all([
      returnSummary(this.db),
      expiringWarranties(this.db, 30),
    ]);
    return {
      summary: {
        ...summary,
        refundedToman: formatToman(BigInt(summary.refundedRial)),
        averageDaysToRefund: summary.averageDaysToRefund,
      },
      kinds: RETURN_KINDS,
      statuses: Object.entries(RETURN_STATUS_LABELS).map(([value, label]) => ({ value, label })),
      conditions: Object.entries(ITEM_CONDITION_LABELS).map(([value, label]) => ({ value, label })),
      refundMethods: Object.entries(REFUND_METHOD_LABELS).map(([value, label]) => ({ value, label })),
      warrantiesExpiring: {
        count: expiring.length,
        // گارانتی‌هایی که به‌زودی تمام می‌شوند: یادآوری به مشتری هم اخلاقی است
        // و هم فروشِ بعدی می‌سازد
        samples: expiring.slice(0, 5).map((w) => ({
          title: w.title,
          endsAt: toIsoDate(w.ends_at),
          customer: w.customer_name,
        })),
      },
    };
  }

  @Get()
  async list(
    @Headers('authorization') authorization: string | undefined,
    @Query('status') status?: string,
    @Query('kind') kind?: string,
    @Query('q') q?: string,
    @Query('limit') limit?: string,
  ) {
    await this.require(authorization, 'returns.read');
    const parsedLimit = limit ? Number(limit) : 50;
    const rows = await listReturns(this.db, {
      status: (status as ReturnStatus | 'open' | undefined) ?? undefined,
      kind: (kind as ReturnKind | undefined) ?? undefined,
      q,
      limit: Number.isFinite(parsedLimit) ? parsedLimit : 50,
    });
    return {
      items: rows.map((r) => ({
        id: r.id,
        returnNo: r.return_no,
        orderNo: r.order_no,
        customerName: r.customer_name,
        kind: r.kind,
        kindLabel: RETURN_KINDS.find((k) => k.value === r.kind)?.label ?? r.kind,
        status: r.status,
        statusLabel: RETURN_STATUS_LABELS[r.status] ?? r.status,
        itemCount: r.item_count,
        refundRial: r.refund_rial,
        refundToman: formatToman(BigInt(r.refund_rial)),
        requestedAt: r.requested_at,
        requestedAtJalali: formatJalali(new Date(r.requested_at)),
        refundedAt: r.refunded_at,
      })),
    };
  }

  @Get('warranties')
  async warranties(
    @Headers('authorization') authorization: string | undefined,
    @Query('status') status?: string,
    @Query('expiringInDays') expiringInDays?: string,
    @Query('q') q?: string,
  ) {
    await this.require(authorization, 'warranty.read');
    const days = expiringInDays ? Number(expiringInDays) : undefined;
    const rows = await listWarranties(this.db, {
      status: status as 'active' | 'expired' | 'claimed' | 'void' | 'all' | undefined,
      expiringInDays: Number.isFinite(days) ? days : undefined,
      q,
    });
    return {
      items: rows.map((w) => ({
        id: w.id,
        orderNo: w.order_no,
        customerName: w.customer_name,
        title: w.title,
        sku: w.sku,
        serialNo: w.serial_no,
        provider: w.provider,
        startsAt: toIsoDate(w.starts_at),
        endsAt: toIsoDate(w.ends_at),
        endsAtJalali: jalaliDateOf(w.ends_at),
        months: w.months,
        status: w.status,
      })),
    };
  }

  @Get(':id')
  async detail(@Headers('authorization') authorization: string | undefined, @Param('id') id: string) {
    await this.require(authorization, 'returns.read');
    // شناسه‌یِ نادرست (مثلاً برخوردِ ناخواسته‌یِ یک زیرمسیر) باید ۴۰۴ بدهد،
    // نه اینکه تا پایگاه برود و خطایِ داخلی بسازد
    if (!isUuid(id)) {
      throw new AppError('NOT_FOUND', { message: 'مرجوعی یافت نشد.' });
    }
    const { ret, items, events, order } = await getReturn(this.db, id);
    return {
      return: {
        id: ret.id,
        returnNo: ret.return_no,
        orderId: ret.order_id,
        orderNo: order.order_no,
        orderTotalToman: formatToman(BigInt(order.total_rial)),
        kind: ret.kind,
        kindLabel: RETURN_KINDS.find((k) => k.value === ret.kind)?.label ?? ret.kind,
        status: ret.status,
        statusLabel: RETURN_STATUS_LABELS[ret.status] ?? ret.status,
        reason: ret.reason,
        customerNote: ret.customer_note,
        decisionNote: ret.decision_note,
        trackingCode: ret.tracking_code,
        pickupMethod: ret.pickup_method,
        refundMethod: ret.refund_method,
        refundRial: ret.refund_rial,
        refundToman: formatToman(BigInt(ret.refund_rial)),
        restockFeeToman: formatToman(BigInt(ret.restock_fee_rial)),
        requestedAt: ret.requested_at,
        requestedAtJalali: formatJalali(new Date(ret.requested_at)),
        decidedAt: ret.decided_at,
        receivedAt: ret.received_at,
        refundedAt: ret.refunded_at,
      },
      items: items.map((i) => ({
        id: i.id,
        title: i.title,
        sku: i.sku,
        quantity: i.quantity,
        condition: i.condition,
        conditionLabel: ITEM_CONDITION_LABELS[i.condition] ?? i.condition,
        restock: i.restock,
        refundRial: i.refund_rial,
        refundToman: formatToman(BigInt(i.refund_rial)),
        note: i.note,
      })),
      timeline: (events as Array<Record<string, unknown>>).map((e) => ({
        eventType: e.event_type,
        fromStatus: e.from_status,
        toStatus: e.to_status,
        note: e.note,
        createdAt: e.created_at,
        createdAtJalali: e.created_at ? formatJalali(new Date(String(e.created_at))) : null,
      })),
    };
  }

  /**
   * برآوردِ پیش از تعهد: «اگر این‌ها را برگردانیم چقدر می‌شود؟»
   * هم پشتیبانِ تلفنی به آن نیاز دارد و هم رابطِ مشتری.
   */
  @Post('quote')
  async quote(
    @Headers('authorization') authorization: string | undefined,
    @Body() body: { orderId?: string; items?: Array<{ orderItemId: string; quantity: number }>; kind?: ReturnKind },
  ) {
    await this.require(authorization, 'returns.read');
    if (!body?.orderId) throw new AppError('VALIDATION', { message: 'شناسه‌یِ سفارش لازم است.' });
    if (!body.items?.length) throw new AppError('VALIDATION', { message: 'دست‌کم یک کالا انتخاب کنید.' });
    const quote = await quoteReturn(this.db, {
      orderId: body.orderId,
      items: body.items,
      kind: body.kind,
    });
    return {
      items: quote.items.map((i) => ({
        ...i,
        netToman: formatToman(i.netRial),
        taxToman: formatToman(i.taxRial),
        grossToman: formatToman(i.grossRial),
      })),
      netRial: quote.netRial.toString(),
      taxRial: quote.taxRial.toString(),
      grossRial: quote.grossRial.toString(),
      netToman: formatToman(quote.netRial),
      taxToman: formatToman(quote.taxRial),
      grossToman: formatToman(quote.grossRial),
      estimatedFeeToman: formatToman(quote.estimatedFeeRial),
    };
  }

  @Post()
  async create(
    @Headers('authorization') authorization: string | undefined,
    @Body()
    body: {
      orderId?: string;
      userId?: string;
      kind?: ReturnKind;
      items?: Array<{ orderItemId: string; quantity: number }>;
      reason?: string;
      customerNote?: string;
      pickupMethod?: 'courier' | 'in_person';
    },
  ) {
    const claims = await this.require(authorization, 'returns.manage');
    if (!body?.orderId) throw new AppError('VALIDATION', { message: 'شناسه‌یِ سفارش لازم است.' });
    if (!body.items?.length) throw new AppError('VALIDATION', { message: 'دست‌کم یک کالا انتخاب کنید.' });
    const created = await requestReturn(this.db, {
      orderId: body.orderId,
      userId: body.userId ?? null,
      kind: body.kind ?? 'withdrawal',
      items: body.items,
      reason: body.reason,
      customerNote: body.customerNote,
      pickupMethod: body.pickupMethod,
      actorId: claims.sub,
    });
    return {
      id: created.id,
      returnNo: created.returnNo,
      status: created.status,
      statusLabel: RETURN_STATUS_LABELS[created.status],
      amountToman: formatToman(created.quote.grossRial),
    };
  }

  @Post(':id/decision')
  async decision(
    @Headers('authorization') authorization: string | undefined,
    @Param('id') id: string,
    @Body() body: { decision?: 'approved' | 'rejected'; note?: string },
  ) {
    const claims = await this.require(authorization, 'returns.manage');
    if (body?.decision !== 'approved' && body?.decision !== 'rejected') {
      throw new AppError('VALIDATION', { message: 'تصمیم باید «approved» یا «rejected» باشد.' });
    }
    const result = await decideReturn(this.db, {
      returnId: id,
      decision: body.decision,
      actorId: claims.sub,
      note: body.note,
    });
    return { id: result.id, status: result.status, statusLabel: RETURN_STATUS_LABELS[result.status] };
  }

  @Post(':id/transit')
  async transit(
    @Headers('authorization') authorization: string | undefined,
    @Param('id') id: string,
    @Body() body: { trackingCode?: string },
  ) {
    const claims = await this.require(authorization, 'returns.manage');
    const result = await markInTransit(this.db, {
      returnId: id,
      trackingCode: body?.trackingCode,
      actorId: claims.sub,
    });
    return { id: result.id, status: result.status, statusLabel: RETURN_STATUS_LABELS[result.status] };
  }

  /** دریافت + بازرسی: جایی که کالا به انبار برمی‌گردد و سند می‌خورد */
  @Post(':id/receive')
  async receive(
    @Headers('authorization') authorization: string | undefined,
    @Param('id') id: string,
    @Body()
    body: {
      items?: Array<{ itemId: string; condition: ItemCondition; restock?: boolean; note?: string }>;
      warehouseId?: string;
      note?: string;
    },
  ) {
    const claims = await this.require(authorization, 'returns.manage');
    if (!body?.items?.length) {
      throw new AppError('VALIDATION', { message: 'دست‌کم وضعیتِ یک کالا را پس از بازرسی ثبت کنید.' });
    }
    const result = await receiveReturn(this.db, {
      returnId: id,
      items: body.items,
      warehouseId: body.warehouseId ?? null,
      actorId: claims.sub,
      note: body.note,
    });
    return {
      id: result.id,
      status: result.status,
      statusLabel: RETURN_STATUS_LABELS[result.status],
      refundToman: formatToman(result.refundRial),
      restockFeeToman: formatToman(result.restockFeeRial),
      restocked: result.restocked,
    };
  }

  @Post(':id/refund')
  async refund(
    @Headers('authorization') authorization: string | undefined,
    @Param('id') id: string,
    @Body() body: { method?: RefundMethod; amountRial?: string; note?: string },
  ) {
    const claims = await this.require(authorization, 'returns.manage');
    if (!body?.method) throw new AppError('VALIDATION', { message: 'راهِ بازگشتِ وجه را انتخاب کنید.' });
    const result = await refundReturn(this.db, {
      returnId: id,
      method: body.method,
      actorId: claims.sub,
      amountRial: body.amountRial !== undefined ? BigInt(body.amountRial) : undefined,
      note: body.note,
    });
    return {
      id: result.id,
      status: result.status,
      statusLabel: RETURN_STATUS_LABELS[result.status],
      refundToman: formatToman(result.refundRial),
    };
  }

  @Post(':id/cancel')
  async cancel(
    @Headers('authorization') authorization: string | undefined,
    @Param('id') id: string,
    @Body() body: { note?: string },
  ) {
    const claims = await this.require(authorization, 'returns.manage');
    const result = await cancelReturn(this.db, { returnId: id, actorId: claims.sub, note: body?.note });
    return { id: result.id, status: result.status, statusLabel: RETURN_STATUS_LABELS[result.status] };
  }

  // ── گارانتی ──────────────────────────────────────────────────────────────

  @Post('warranties')
  async createWarranty(
    @Headers('authorization') authorization: string | undefined,
    @Body()
    body: {
      orderItemId?: string;
      months?: number;
      provider?: 'manufacturer' | 'store' | 'seller';
      serialNo?: string;
      notes?: string;
    },
  ) {
    await this.require(authorization, 'returns.manage');
    if (!body?.orderItemId) throw new AppError('VALIDATION', { message: 'ردیفِ سفارش لازم است.' });
    const w = await startWarranty(this.db, {
      orderItemId: body.orderItemId,
      months: body.months,
      provider: body.provider,
      serialNo: body.serialNo,
      notes: body.notes,
    });
    return { id: w.id, endsAt: w.endsAt, months: w.months };
  }

  @Post('warranties/:id/claim')
  async claim(
    @Headers('authorization') authorization: string | undefined,
    @Param('id') id: string,
    @Body() body: { note?: string; serialNo?: string },
  ) {
    await this.require(authorization, 'returns.manage');
    return claimWarranty(this.db, { warrantyId: id, note: body?.note, serialNo: body?.serialNo });
  }

  /** PDF فاکتور مرجوعی — سند بازپرداخت */
  @Get(':id/pdf')
  async returnPdf(
    @Param('id') id: string,
    @Headers('authorization') authorization: string | undefined,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    await this.require(authorization, 'returns.manage');
    const record = await getReturn(this.db, id);
    if (!record) throw new AppError('NOT_FOUND', { message: 'مرجوعی یافت نشد.' });

    // اطلاعات سفارش اصلی
    const { rows: orderRows } = await this.db.query<{
      order_no: string; customer_name: string | null; customer_mobile: string | null;
    }>(
      `SELECT order_no, customer_name, customer_mobile FROM orders WHERE id = $1`,
      [record.ret.order_id],
    );
    const order = orderRows[0];

    const items = record.items;

    // فروشگاه
    const { rows: settings } = await this.db.query<{ key: string; value: string }>(
      `SELECT key, value FROM store_settings WHERE key IN ('store_name','store_address','store_phone','national_id','economic_code')`,
    );
    const sMap = Object.fromEntries(settings.map((s) => [s.key, s.value]));

    const spec: InvoiceSpec = {
      number: record.ret.return_no,
      issuedAt: record.ret.requested_at,
      status: record.ret.status,
      watermark: RETURN_STATUS_LABELS[record.ret.status],
      title: 'سند مرجوعی — بازپرداخت',
      seller: {
        name: sMap['store_name'] ?? 'فروشگاه',
        nationalId: sMap['national_id'] ?? undefined,
        economicCode: sMap['economic_code'] ?? undefined,
        address: sMap['store_address'] ?? undefined,
        phone: sMap['store_phone'] ?? undefined,
      },
      buyer: {
        name: order?.customer_name ?? 'مشتری',
        phone: order?.customer_mobile ?? undefined,
      },
      lines: items.map((it) => ({
        title: it.title,
        sku: it.sku,
        quantity: it.quantity,
        unitPriceRial: Number(it.refund_rial) / it.quantity,
        totalRial: Number(it.refund_rial),
      })),
      note: `مرجوعی سفارش ${order?.order_no ?? ''} — روش بازپرداخت: ${record.ret.refund_method ?? 'نامشخص'}`,
    };

    const buffer = renderInvoicePdf(spec);
    reply
      .header('Content-Type', 'application/pdf')
      .header('Content-Disposition', `attachment; filename="return-${id.slice(0, 8)}.pdf"`)
      .send(buffer);
  }
}
