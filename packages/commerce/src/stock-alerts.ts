/**
 * «خبرم کن وقتی موجود شد».
 *
 * چرا جدولِ جدا، با وجودِ `reorder_alerts`؟ چون آن جدول برایِ **درونِ
 * انبار** است: به کالا پیوند می‌خورد (نه به تنوع)، برایِ هر کالا یکی است،
 * و می‌گوید «وقتِ سفارشِ دوباره رسیده». اینجا برعکس: به **تنوع** پیوند
 * می‌خورد (ممکن است مشتری رنگِ مشکی بخواهد، نه هر رنگی)، برایِ هر مشتری
 * یکی است، و می‌گوید «کالایِ تو آمد». قاطی کردنشان یعنی بیست مشتری که
 * منتظرند، به یک هشدارِ تکی تقلیل یابند.
 *
 * سه خطر که اینجا بسته شده:
 *
 *   ۱. **درخواستِ تکراری**: یک نفر نباید ده‌بار در صف بنشیند و ده پیام
 *      بگیرد. مهار در پایگاه است (یکتا برایِ تنوع+مشتری و تنوع+تلفن).
 *   ۲. **انباشتِ بی‌پایان**: اگر کالایی ماه‌ها نیاید، صف می‌تواند هزاران
 *      ردیف شود. سقف می‌گذاریم و پس از آن با پیامِ روشن بازمی‌گردیم.
 *   ۳. **پیام به کالایِ موجود**: اگر همین حالا موجود است، ثبتِ درخواست
 *      بی‌معناست — به جایش می‌گوییم «موجود است، همین حالا بخر».
 */

import { AppError } from '@set/shared-kernel';
import type { Database, Queryable } from '@set/db';

import { enqueueSms } from './sms.js';

export type StockNotifyStatus = 'waiting' | 'notified' | 'cancelled';

export interface StockNotification {
  id: string;
  variantId: string;
  productId: string;
  customerId: string | null;
  phone: string | null;
  email: string | null;
  channel: 'sms' | 'email';
  status: StockNotifyStatus;
  source: string;
  createdAt: Date;
  notifiedAt: Date | null;
  /** نامِ کالا و تنوع، برایِ نمایش در پنل */
  productTitle?: string;
  variantLabel?: string | null;
}

interface Row {
  id: string;
  variant_id: string;
  product_id: string;
  customer_id: string | null;
  phone: string | null;
  email: string | null;
  channel: string;
  status: string;
  source: string;
  created_at: Date | string;
  notified_at: Date | string | null;
  product_title?: string;
  variant_label?: string | null;
}

function toNotification(row: Row): StockNotification {
  return {
    id: row.id,
    variantId: row.variant_id,
    productId: row.product_id,
    customerId: row.customer_id,
    phone: row.phone,
    email: row.email,
    channel: row.channel === 'email' ? 'email' : 'sms',
    status: row.status as StockNotifyStatus,
    source: row.source,
    createdAt: new Date(row.created_at),
    notifiedAt: row.notified_at ? new Date(row.notified_at) : null,
    productTitle: row.product_title,
    variantLabel: row.variant_label,
  };
}

export class StockAlertService {
  constructor(private readonly db: Database | Queryable) {}

  private async setting(key: string): Promise<string | null> {
    try {
      const res = await this.db.query<{ value: string }>(`SELECT value FROM store_settings WHERE key = $1`, [key]);
      return res.rows[0]?.value ?? null;
    } catch {
      return null;
    }
  }

  /** موجودیِ قابلِ فروشِ یک تنوع */
  private async availableOf(variantId: string): Promise<number> {
    const res = await this.db.query<{ n: string }>(
      `SELECT COALESCE(SUM(on_hand - reserved), 0)::text AS n FROM stock_items WHERE variant_id = $1`,
      [variantId],
    );
    return Number(res.rows[0]?.n ?? 0);
  }

  /**
   * درخواستِ «خبرم کن».
   *
   * اگر مشتری پیش از این در صف باشد، همان درخواست برمی‌گردد — نه خطا، و نه
   * درخواستِ دوم. زدنِ دوبارهٔ دکمه نباید آدم را جریمه کند.
   */
  async request(input: {
    variantId: string;
    customerId?: string | null;
    phone?: string | null;
    email?: string | null;
    source?: 'web' | 'panel' | 'pos';
  }): Promise<{ notification: StockNotification; alreadyWaiting: boolean; available: boolean }> {
    const enabled = (await this.setting('stock_notify_enabled')) !== 'false';
    if (!enabled) {
      throw new AppError('VALIDATION', { message: 'دریافتِ آگاه‌سازیِ موجودی اکنون غیرفعال است.' });
    }

    const variant = await this.db.query<{ id: string; product_id: string }>(
      `SELECT id, product_id FROM product_variants WHERE id = $1`,
      [input.variantId],
    );
    const row = variant.rows[0];
    if (!row) throw new AppError('NOT_FOUND', { message: 'این کالا یافت نشد.' });

    const available = await this.availableOf(input.variantId);
    if (available > 0) {
      // کالا هست؛ پس اصلاً نباید در صف نشست
      const existing = await this.findMine(input);
      if (existing) {
        const cancelled = await this.cancel(existing.id);
        void cancelled;
      }
      return { notification: null as never, alreadyWaiting: false, available: true };
    }

    const existing = await this.findMine(input);
    if (existing) return { notification: existing, alreadyWaiting: true, available: false };

    // سقفِ انباشت: جلویِ صفِ بی‌پایان برایِ کالایی که نمی‌آید
    const max = Number((await this.setting('stock_notify_max_per_variant')) ?? 200);
    if (Number.isFinite(max) && max > 0) {
      const count = await this.db.query<{ n: string }>(
        `SELECT COUNT(*)::text AS n FROM stock_notifications WHERE variant_id = $1 AND status = 'waiting'`,
        [input.variantId],
      );
      if (Number(count.rows[0]?.n ?? 0) >= max) {
        throw new AppError('CONFLICT', {
          message: 'شماری زیادی پیش از این برایِ این کالا درخواست داده‌اند؛ اندکی بعد دوباره تلاش کنید.',
        });
      }
    }

    const res = await this.db.query<Row>(
      `INSERT INTO stock_notifications (variant_id, product_id, customer_id, phone, email, channel, source)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [
        input.variantId,
        row.product_id,
        input.customerId ?? null,
        input.phone ?? null,
        input.email ?? null,
        input.email && !input.phone ? 'email' : 'sms',
        input.source ?? 'web',
      ],
    );
    const created = res.rows[0];
    if (!created) throw new AppError('INTERNAL', { message: 'درخواست ثبت نشد؛ دوباره تلاش کنید.' });
    return { notification: toNotification(created), alreadyWaiting: false, available: false };
  }

  private async findMine(input: {
    variantId: string;
    customerId?: string | null;
    phone?: string | null;
    email?: string | null;
  }): Promise<StockNotification | null> {
    const params: unknown[] = [input.variantId];
    const clauses: string[] = [];
    if (input.customerId) {
      params.push(input.customerId);
      clauses.push(`customer_id = $${params.length}`);
    }
    if (input.phone) {
      params.push(input.phone);
      clauses.push(`phone = $${params.length}`);
    }
    if (clauses.length === 0) return null;
    const res = await this.db.query<Row>(
      `SELECT * FROM stock_notifications
        WHERE variant_id = $1 AND status = 'waiting' AND (${clauses.join(' OR ')})
        LIMIT 1`,
      params,
    );
    return res.rows[0] ? toNotification(res.rows[0]) : null;
  }

  async cancel(id: string): Promise<boolean> {
    const res = await this.db.query<{ id: string }>(
      `UPDATE stock_notifications
          SET status = 'cancelled', cancelled_at = now()
        WHERE id = $1 AND status = 'waiting'
        RETURNING id`,
      [id],
    );
    return res.rows.length > 0;
  }

  /** آنچه یک مشتری در انتظارش است */
  async listForCustomer(customerId: string): Promise<StockNotification[]> {
    const res = await this.db.query<Row>(
      `SELECT n.*, p.title AS product_title, pv.sku AS variant_label
         FROM stock_notifications n
         JOIN products p ON p.id = n.product_id
         JOIN product_variants pv ON pv.id = n.variant_id
        WHERE n.customer_id = $1 AND n.status = 'waiting'
        ORDER BY n.created_at DESC`,
      [customerId],
    );
    return res.rows.map(toNotification);
  }

  /** صفِ یک تنوع — برایِ پنل ("چند نفر منتظرند") */
  async waitingFor(variantIds: string[]): Promise<Map<string, number>> {
    const map = new Map<string, number>();
    if (variantIds.length === 0) return map;
    const res = await this.db.query<{ variant_id: string; n: string }>(
      `SELECT variant_id, COUNT(*)::text AS n
         FROM stock_notifications
        WHERE variant_id = ANY($1::uuid[]) AND status = 'waiting'
        GROUP BY variant_id`,
      [variantIds],
    );
    for (const row of res.rows) map.set(row.variant_id, Number(row.n));
    return map;
  }

  async listForProduct(productId: string, status: StockNotifyStatus | 'all' = 'waiting'): Promise<StockNotification[]> {
    const params: unknown[] = [productId];
    let clause = '';
    if (status !== 'all') {
      params.push(status);
      clause = ` AND n.status = $2`;
    }
    const res = await this.db.query<Row>(
      `SELECT n.*, p.title AS product_title, pv.sku AS variant_label
         FROM stock_notifications n
         JOIN products p ON p.id = n.product_id
         JOIN product_variants pv ON pv.id = n.variant_id
        WHERE n.product_id = $1${clause}
        ORDER BY n.created_at DESC`,
      params,
    );
    return res.rows.map(toNotification);
  }

  /**
   * آگاه‌سازیِ منتظران — وقتی کالا موجود می‌شود.
   *
   * چرا «اگر موجود است» را خودمان می‌سنجیم؟ چون این تابع هم از تعدیلِ
   * موجودی صدا زده می‌شود و هم از رسیدِ خرید؛ در هر دو، ممکن است کالا
   * هنوز قابلِ فروش نباشد (مثلاً همه‌اش رزرو شده). پیامِ «موجود شد» به
   * کسی که می‌رود و نمی‌تواند بخرد، از نفرستادن بدتر است.
   */
  async notifyWaiters(variantId: string, options: { limit?: number } = {}): Promise<{ notified: number; available: number }> {
    const available = await this.availableOf(variantId);
    if (available <= 0) return { notified: 0, available };

    const limit = Math.min(Math.max(options.limit ?? 200, 1), 500);
    const res = await this.db.query<Row & { product_title: string }>(
      `SELECT n.*, p.title AS product_title
         FROM stock_notifications n
         JOIN products p ON p.id = n.product_id
        WHERE n.variant_id = $1 AND n.status = 'waiting'
        ORDER BY n.created_at ASC
        LIMIT $2`,
      [variantId, limit],
    );

    let notified = 0;
    for (const row of res.rows) {
      const phone = row.phone ?? (row.customer_id ? await this.phoneOf(row.customer_id) : null);
      if (!phone) continue; // کسی که شماره ندارد، پیامکی هم نمی‌گیرد

      await enqueueSms(this.db, {
        phone,
        templateKey: 'product_back',
        // {store} را خودِ قالب از تنظیمات می‌آورد؛ اینجا فقط نامِ کالا
        vars: { product: row.product_title },
      });
      await this.db.query(
        `UPDATE stock_notifications SET status = 'notified', notified_at = now() WHERE id = $1 AND status = 'waiting'`,
        [row.id],
      );
      notified += 1;
    }
    return { notified, available };
  }

  /** آگاه‌سازی برایِ همه‌یِ تنوع‌هایِ یک کالا (پس از یک رسیدِ خرید) */
  async notifyForProduct(productId: string): Promise<{ notified: number }> {
    const variants = await this.db.query<{ id: string }>(
      `SELECT id FROM product_variants WHERE product_id = $1`,
      [productId],
    );
    let notified = 0;
    for (const variant of variants.rows) {
      notified += (await this.notifyWaiters(variant.id)).notified;
    }
    return { notified };
  }

  private async phoneOf(customerId: string): Promise<string | null> {
    const res = await this.db.query<{ phone: string }>(`SELECT phone FROM customers WHERE id = $1`, [customerId]);
    return res.rows[0]?.phone ?? null;
  }
}
