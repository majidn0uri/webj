import { Controller, Get, Inject, Param, Headers, Res } from '@nestjs/common';

import { AppError } from '@set/shared-kernel';
import type { Database } from '@set/db';
import type { AccessControl } from '@set/rbac';
import type { AccessClaims, TokenService } from '@set/auth';

import { DB, TOKEN_SERVICE, ACCESS_CONTROL } from './tokens.js';

/**
 * برگهٔ ارسال / Shipping Label
 *
 * فروشنده پس از بسته‌بندی، برگه‌ای قابل چاپ می‌گیرد که روی بسته الصاق شود.
 * اطلاعات: شماره سفارش، آدرس گیرنده، کد رهگیری، فهرست کالاها.
 */

@Controller('admin/orders')
export class ShippingLabelController {
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
    await this.access.assert({ userId: claims.sub, branchId: null }, 'orders', 'read');
    return claims;
  }

  /**
   * GET /admin/orders/:id/label
   *
   * JSON خام — شامل آدرس، اقلام، و اطلاعات مرسوله.
   * صفحهٔ وب از این داده برای رندرِ HTML قابل چاپ استفاده می‌کند.
   */
  @Get(':id/label')
  async getLabel(
    @Param('id') id: string,
    @Headers('authorization') authorization: string | undefined,
  ) {
    await this.require(authorization);

    // سفارش + آدرس + مشتری
    const orderRes = await this.db.query<{
      order_no: string;
      status: string;
      total_rial: string;
      created_at: string;
      customer_name: string | null;
      customer_mobile: string | null;
    }>(
      `SELECT o.order_no, o.status, o.total_rial, o.created_at,
              c.name AS customer_name, c.mobile AS customer_mobile
       FROM orders o
       LEFT JOIN users u ON u.id = o.user_id
       LEFT JOIN customers c ON c.id = u.customer_id
       WHERE o.id = $1`,
      [id],
    );
    const order = orderRes.rows[0];
    if (!order) throw new AppError('NOT_FOUND', { message: 'سفارش یافت نشد.' });

    // آدرس تحویل
    const addrRes = await this.db.query<{
      receiver_name: string;
      phone: string;
      province: string;
      city: string;
      address: string;
      postal_code: string;
    }>(
      `SELECT a.receiver_name, a.phone, a.province, a.city, a.address, a.postal_code
       FROM order_addresses a
       WHERE a.order_id = $1 AND a.kind = 'shipping'
       LIMIT 1`,
      [id],
    ).catch(() => ({ rows: [] as Array<{
      receiver_name: string;
      phone: string;
      province: string;
      city: string;
      address: string;
      postal_code: string;
    }> }));

    // اگر آدرس جداگانه نبود، از customer_addresses استفاده کن
    let addr = addrRes.rows[0] ?? null;
    if (!addr) {
      const caRes = await this.db.query<{
        receiver_name: string;
        phone: string;
        province: string;
        city: string;
        address: string;
        postal_code: string;
      }>(
        `SELECT ca.receiver_name, ca.phone, ca.province, ca.city, ca.address, ca.postal_code
         FROM orders o
         JOIN users u ON u.id = o.user_id
         JOIN customer_addresses ca ON ca.customer_id = u.customer_id AND ca.is_default = true
         WHERE o.id = $1
         LIMIT 1`,
        [id],
      ).catch(() => ({ rows: [] }));
      addr = caRes.rows[0] ?? null;
    }

    // اقلام سفارش
    const itemsRes = await this.db.query<{
      name: string;
      sku: string;
      quantity: number;
    }>(
      `SELECT p.title AS name, v.sku, oi.quantity
       FROM order_items oi
       JOIN product_variants v ON v.id = oi.variant_id
       JOIN products p ON p.id = v.product_id
       WHERE oi.order_id = $1
       ORDER BY oi.created_at`,
      [id],
    );

    // مرسوله‌ها
    const shipmentsRes = await this.db.query<{
      shipment_no: string;
      carrier: string;
      tracking_code: string;
      shipped_at: string;
    }>(
      `SELECT shipment_no, carrier, tracking_code, shipped_at
       FROM shipments
       WHERE order_id = $1
       ORDER BY shipped_at DESC`,
      [id],
    );

    return {
      order: {
        orderNo: order.order_no,
        status: order.status,
        total: Number(order.total_rial),
        createdAt: order.created_at,
        customerName: order.customer_name,
        customerMobile: order.customer_mobile,
      },
      address: addr ? {
        receiverName: addr.receiver_name,
        phone: addr.phone,
        province: addr.province,
        city: addr.city,
        address: addr.address,
        postalCode: addr.postal_code,
      } : null,
      items: itemsRes.rows.map((r) => ({
        name: r.name,
        sku: r.sku,
        quantity: r.quantity,
      })),
      shipments: shipmentsRes.rows.map((s) => ({
        shipmentNo: s.shipment_no,
        carrier: s.carrier,
        trackingCode: s.tracking_code,
        shippedAt: s.shipped_at,
      })),
    };
  }

  /**
   * GET /admin/orders/:id/label/html
   *
   * HTML قابل چاپ — مستقیماً در مرورگر باز شود و Ctrl+P بزنند.
   */
  @Get(':id/label/html')
  async getLabelHtml(
    @Param('id') id: string,
    @Headers('authorization') authorization: string | undefined,
    @Res() res: { setHeader(name: string, value: string): void; send(body: string): void },
  ) {
    const data = await this.getLabel(id, authorization);

    const itemsHtml = data.items.map((item, i) =>
      `<tr>
        <td>${i + 1}</td>
        <td>${escapeHtml(item.name)}</td>
        <td class="num">${escapeHtml(item.sku)}</td>
        <td class="num">${item.quantity}</td>
      </tr>`
    ).join('\n');

    const shipmentInfo = data.shipments[0]
      ? `<div class="ship-info">
           <div><strong>مرسوله:</strong> ${escapeHtml(data.shipments[0].shipmentNo)}</div>
           <div><strong> carrier:</strong> ${escapeHtml(data.shipments[0].carrier)}</div>
           <div><strong>کد رهگیری:</strong> <span class="tracking">${escapeHtml(data.shipments[0].trackingCode)}</span></div>
         </div>`
      : '';

    const addrHtml = data.address
      ? `<div class="addr">
           <div class="addr__name">${escapeHtml(data.address.receiverName)}</div>
           <div>${escapeHtml(data.address.phone)}</div>
           <div>${escapeHtml(data.address.province)}، ${escapeHtml(data.address.city)}</div>
           <div>${escapeHtml(data.address.address)}</div>
           <div class="num">کدپستی: ${escapeHtml(data.address.postalCode)}</div>
         </div>`
      : '<div class="addr"><em>آدرس ثبت نشده</em></div>';

    const html = `<!DOCTYPE html>
<html lang="fa" dir="rtl">
<head>
<meta charset="utf-8">
<title>برگه ارسال — ${escapeHtml(data.order.orderNo)}</title>
<style>
  * { margin:0; padding:0; box-sizing:border-box; }
  body { font-family: system-ui, -apple-system, sans-serif; font-size: 14px; color: #111; padding: 20px; }
  .label { border: 2px solid #000; border-radius: 8px; padding: 20px; max-width: 600px; margin: 0 auto; }
  .label__header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 16px; border-bottom: 1px solid #ddd; padding-bottom: 12px; }
  .label__order { font-size: 18px; font-weight: 700; }
  .label__date { font-size: 12px; color: #666; direction: ltr; text-align: left; }
  .section { margin-bottom: 16px; }
  .section__title { font-size: 12px; color: #666; text-transform: uppercase; margin-bottom: 6px; letter-spacing: 1px; }
  .addr { line-height: 1.8; }
  .addr__name { font-weight: 700; font-size: 16px; }
  .ship-info { background: #f5f5f5; padding: 10px; border-radius: 6px; margin-bottom: 16px; }
  .ship-info div { margin: 4px 0; }
  .tracking { font-family: monospace; font-size: 18px; font-weight: 700; letter-spacing: 2px; background: #fff; padding: 2px 8px; border: 1px dashed #333; }
  table { width: 100%; border-collapse: collapse; margin-top: 8px; }
  th, td { border: 1px solid #ddd; padding: 6px 10px; text-align: right; }
  th { background: #f5f5f5; font-size: 12px; }
  .num { font-family: monospace; direction: ltr; text-align: center; }
  .footer { margin-top: 16px; padding-top: 12px; border-top: 1px dashed #ccc; font-size: 11px; color: #999; text-align: center; }
  @media print {
    body { padding: 0; }
    .label { border: 2px solid #000; }
    .no-print { display: none; }
  }
</style>
</head>
<body>
<div class="no-print" style="text-align:center;margin-bottom:16px;">
  <button onclick="window.print()" style="padding:8px 24px;font-size:16px;cursor:pointer;">🖨️ چاپ</button>
</div>
<div class="label">
  <div class="label__header">
    <div class="label__order">سفارش ${escapeHtml(data.order.orderNo)}</div>
    <div class="label__date">${new Date(data.order.createdAt).toLocaleDateString('fa-IR')}</div>
  </div>

  ${shipmentInfo}

  <div class="section">
    <div class="section__title">گیرنده</div>
    ${addrHtml}
  </div>

  <div class="section">
    <div class="section__title">اقلام</div>
    <table>
      <thead><tr><th>#</th><th>کالا</th><th>SKU</th><th>تعداد</th></tr></thead>
      <tbody>${itemsHtml}</tbody>
    </table>
  </div>

  <div class="footer">
    ${data.order.total.toLocaleString('fa-IR')} تومان — ${escapeHtml(data.order.customerName ?? 'مشتری')}
  </div>
</div>
</body>
</html>`;

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(html);
  }
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}