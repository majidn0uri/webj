import {
  Body,
  Controller,
  Get,
  Headers,
  Inject,
  Param,
  Patch,
  Query,
} from '@nestjs/common';
import { z } from 'zod';
import { AppError, formatToman, formatJalaliLong } from '@set/shared-kernel';
import type { Database } from '@set/db';
import type { AccessControl } from '@set/rbac';
import type { AccessClaims, TokenService } from '@set/auth';
import { DB, TOKEN_SERVICE, ACCESS_CONTROL } from './tokens.js';

/**
 * مسیرهایِ مدیریتِ مشتریان.
 *
 * چرا اینجا یک «فهرست با جستجو» کافی نیست و «پرونده» هم لازم است؟ چون کاربردِ
 * واقعیِ این صفحه پاسخ به تلفن است: مشتری زنگ می‌زند و می‌گوید «سفارشم را
 * نمی‌بینم». اپراتور با شماره‌ی تلفن جستجو می‌کند و باید در یک نگاه ببیند:
 * آیا حساب دارد؟ آخرین خرید چه بوده؟ آدرسش کجاست؟ چقدر خرج کرده؟ اگر برایِ هر
 * کدام صفحه‌ای جدا باشد، مشتری پشتِ خط معطل می‌ماند.
 *
 * یک قاعده‌ی امنیتیِ ساده در همه‌ی مسیرها: هیچ مسیری «شناسه‌ی مشتریِ درخواست‌کننده»
 * را نمی‌پذیرد؛ احرازِ هویت از نشانه‌ی مدیر است و دسترسی با RBAC سنجیده می‌شود.
 */

const UpdateDto = z.object({
  fullName: z.string().min(2).max(120).optional(),
  email: z.string().email().max(120).nullish(),
  note: z.string().max(1000).nullish(),
  /** سقفِ اعتبار به تومان (ورودیِ کاربر همیشه تومان؛ ذخیره ریال) */
  creditLimitToman: z.number().int().min(0).max(1_000_000_000).optional(),
  /** سقفِ چک به تومان — برایِ فروشِ عمده/شرکتی */
  checkCeilingToman: z.number().int().min(0).max(1_000_000_000).optional(),
  isPartner: z.boolean().optional(),
});

const DeactivateDto = z.object({
  block: z.boolean(),
  reason: z.string().max(500).nullish(),
});

@Controller('admin/customers')
export class AdminCustomersController {
  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(TOKEN_SERVICE) private readonly tokens: TokenService,
    @Inject(ACCESS_CONTROL) private readonly access: AccessControl,
  ) {}

  private async requireUser(
    authorization: string | undefined,
    action: 'read' | 'write' | 'deactivate',
  ): Promise<AccessClaims> {
    const token = authorization?.startsWith('Bearer ') ? authorization.slice(7) : undefined;
    if (!token) throw new AppError('UNAUTHENTICATED');

    const claims = await this.tokens.verifyAccess(token);
    if (!claims) throw new AppError('UNAUTHENTICATED');

    await this.access.assert({ userId: claims.sub, branchId: null }, 'customer', action);
    return claims;
  }

  /**
   * فهرستِ مشتریان با جستجو.
   *
   * چرا جستجو روی «شماره» عادی‌سازی می‌شود؟ چون شماره را ممکن است با صفرِ
   * چپ، با فاصله، با خطِ تیره یا با ارقامِ فارسی بنویسند؛ اگر همان‌طور که
   * تایپ شده جستجو کنیم، مشتری هست اما پیدا نمی‌شود — بدترین تجربه برای
   * اپراتورِ پشتِ خط. پس فقط رقم‌ها نگه داشته می‌شوند (و صفرِ چپ حذف می‌شود).
   */
  @Get()
  async list(
    @Headers('authorization') authorization: string | undefined,
    @Query('q') q?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    await this.requireUser(authorization, 'read');

    const take = Math.min(Math.max(Number(limit ?? 40) || 40, 1), 100);
    const skip = Math.max(Number(offset ?? 0) || 0, 0);
    const term = (q ?? '').replace(/\D/g, ''); // فقط رقم‌ها
    const termName = (q ?? '').trim();

    const where: string[] = [];
    const params: unknown[] = [];

    if (term) {
      params.push(`%${term}`);
      // شماره‌ها در پایگاه ممکن است با ۰۹۱۲ یا ۹۱۲ ذخیره شده باشند
      where.push(`(regexp_replace(c.phone, '\\D', '', 'g') LIKE '%' || $1 OR
                   regexp_replace(COALESCE(c.phone,''), '\\D', '', 'g') LIKE $1)`);
    }
    if (termName) {
      params.push(`%${termName}%`);
      where.push(`c.full_name ILIKE $${params.length}`);
    }

    const clause = where.length ? `WHERE ${where.join(' OR ')}` : '';

    const { rows } = await this.db.query<{
      id: string;
      full_name: string;
      phone: string | null;
      email: string | null;
      kind: string;
      is_active: boolean;
      is_partner: boolean;
      credit_rial: string | null;
      check_ceiling_rial: string | null;
      order_count: string;
      paid_rial: string | null;
      last_order_at: Date | null;
      wishlist_count: string;
      created_at: Date;
      last_login_at: Date | null;
    }>(
      `SELECT c.id, c.full_name, c.phone, c.email, c.kind, c.is_active, c.is_partner,
              c.credit_rial, c.check_ceiling_rial, c.created_at, c.last_login_at,
              (SELECT COUNT(*) FROM orders o WHERE o.customer_id = c.id) AS order_count,
              (SELECT COALESCE(SUM(o.total_rial), 0) FROM orders o
                WHERE o.customer_id = c.id AND o.status NOT IN ('cancelled')) AS paid_rial,
              (SELECT MAX(o.created_at) FROM orders o WHERE o.customer_id = c.id) AS last_order_at,
              (SELECT COUNT(*) FROM customer_wishlists w WHERE w.customer_id = c.id) AS wishlist_count
         FROM customers c
         ${clause}
        ORDER BY c.created_at DESC
        LIMIT ${take} OFFSET ${skip}`,
      params,
    );

    const { rows: counted } = await this.db.query<{ total: string }>(
      `SELECT COUNT(*) AS total FROM customers c ${clause}`,
      params,
    );

    return {
      items: rows.map((r) => {
        const spent = BigInt(r.paid_rial ?? '0');
        return {
          id: r.id,
          fullName: r.full_name,
          phone: r.phone,
          email: r.email,
          kind: r.kind,
          isActive: r.is_active,
          isPartner: r.is_partner,
          creditLimitToman: r.credit_rial === null ? null : Number(BigInt(r.credit_rial) / 10n),
          checkCeilingToman:
            r.check_ceiling_rial === null ? null : Number(BigInt(r.check_ceiling_rial) / 10n),
          orderCount: Number(r.order_count),
          wishlistCount: Number(r.wishlist_count),
          spentToman: Number(spent / 10n),
          spentDisplay: formatToman(spent),
          lastOrderAt: r.last_order_at ? formatJalaliLong(new Date(r.last_order_at)) : null,
          lastLoginAt: r.last_login_at ? formatJalaliLong(new Date(r.last_login_at)) : null,
          registeredAt: formatJalaliLong(new Date(r.created_at)),
        };
      }),
      total: Number(counted[0]?.total ?? 0),
      limit: take,
      offset: skip,
    };
  }

  /** پرونده‌ی یک مشتری: پروفایل، آدرس‌ها، سفارش‌ها، علاقه‌مندی‌ها */
  @Get(':id')
  async detail(@Headers('authorization') authorization: string | undefined, @Param('id') id: string) {
    await this.requireUser(authorization, 'read');

    const { rows } = await this.db.query<{
      id: string;
      full_name: string;
      phone: string | null;
      email: string | null;
      kind: string;
      is_active: boolean;
      deactivated_reason: string | null;
      note: string | null;
      is_partner: boolean;
      national_id: string | null;
      credit_rial: string | null;
      check_ceiling_rial: string | null;
      mobile_verified_at: Date | null;
      last_login_at: Date | null;
      created_at: Date;
    }>(
      `SELECT id, full_name, phone, email, kind, is_active, deactivated_reason, note,
              is_partner, national_id, credit_rial, check_ceiling_rial,
              mobile_verified_at, last_login_at, created_at
         FROM customers WHERE id = $1`,
      [id],
    );

    const c = rows[0];
    if (!c) throw new AppError('NOT_FOUND');

    const [orders, addresses, wishlist] = await Promise.all([
      this.db.query<{
        id: string;
        order_no: string;
        status: string;
        total_rial: string;
        created_at: Date;
      }>(
        `SELECT id, order_no, status, total_rial, created_at
           FROM orders WHERE customer_id = $1
          ORDER BY created_at DESC LIMIT 20`,
        [id],
      ),
      this.db.query<{
        id: string;
        receiver_name: string | null;
        phone: string | null;
        province: string | null;
        city: string | null;
        address: string | null;
        postal_code: string | null;
        is_default: boolean;
      }>(
        `SELECT id, receiver_name, phone, province, city, address, postal_code, is_default
           FROM customer_addresses WHERE customer_id = $1
          ORDER BY is_default DESC, created_at DESC`,
        [id],
      ),
      this.db.query<{
        variant_id: string;
        title: string;
        sku: string | null;
        created_at: Date;
      }>(
        `SELECT w.variant_id, p.title, v.sku, w.created_at
           FROM customer_wishlists w
           JOIN product_variants v ON v.id = w.variant_id
           JOIN products p ON p.id = v.product_id
          WHERE w.customer_id = $1
          ORDER BY w.created_at DESC LIMIT 12`,
        [id],
      ),
    ]);

    const spent = orders.rows.reduce((sum, o) => sum + BigInt(o.total_rial), 0n);

    return {
      customer: {
        id: c.id,
        fullName: c.full_name,
        phone: c.phone,
        email: c.email,
        kind: c.kind,
        isActive: c.is_active,
        deactivatedReason: c.deactivated_reason,
        note: c.note,
        isPartner: c.is_partner,
        nationalId: c.national_id,
        creditLimitToman: c.credit_rial === null ? null : Number(BigInt(c.credit_rial) / 10n),
        checkCeilingToman:
          c.check_ceiling_rial === null ? null : Number(BigInt(c.check_ceiling_rial) / 10n),
        mobileVerifiedAt: c.mobile_verified_at ? formatJalaliLong(new Date(c.mobile_verified_at)) : null,
        lastLoginAt: c.last_login_at ? formatJalaliLong(new Date(c.last_login_at)) : null,
        registeredAt: formatJalaliLong(new Date(c.created_at)),
      },
      stats: {
        orderCount: orders.rows.length,
        spentToman: Number(spent / 10n),
        spentDisplay: formatToman(spent),
        addressCount: addresses.rows.length,
        wishlistCount: wishlist.rows.length,
      },
      orders: orders.rows.map((o) => ({
        id: o.id,
        orderNo: o.order_no,
        status: o.status,
        totalToman: Number(BigInt(o.total_rial) / 10n),
        totalDisplay: formatToman(BigInt(o.total_rial)),
        at: formatJalaliLong(new Date(o.created_at)),
      })),
      addresses: addresses.rows,
      wishlist: wishlist.rows,
    };
  }

  /** ویرایشِ پرونده: نام، یادداشت، اعتبار، سقفِ چک، وضعیتِ همکار */
  @Patch(':id')
  async update(
    @Headers('authorization') authorization: string | undefined,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    const claims = await this.requireUser(authorization, 'write');
    const input = UpdateDto.parse(body);

    const sets: string[] = [];
    const params: unknown[] = [id];

    if (input.fullName !== undefined) {
      params.push(input.fullName);
      sets.push(`full_name = $${params.length}`);
    }
    if (input.email !== undefined) {
      params.push(input.email);
      sets.push(`email = $${params.length}`);
    }
    if (input.note !== undefined) {
      params.push(input.note);
      sets.push(`note = $${params.length}`);
    }
    if (input.creditLimitToman !== undefined) {
      params.push((BigInt(input.creditLimitToman) * 10n).toString());
      sets.push(`credit_rial = $${params.length}`);
    }
    if (input.checkCeilingToman !== undefined) {
      params.push((BigInt(input.checkCeilingToman) * 10n).toString());
      sets.push(`check_ceiling_rial = $${params.length}`);
    }
    if (input.isPartner !== undefined) {
      params.push(input.isPartner);
      sets.push(`is_partner = $${params.length}`);
    }

    if (sets.length === 0) throw new AppError('VALIDATION');

    sets.push(`updated_at = now()`);

    const { affectedRows } = await this.db.query(
      `UPDATE customers SET ${sets.join(', ')} WHERE id = $1`,
      params,
    );
    if (affectedRows === 0) throw new AppError('NOT_FOUND');

    return { id, updatedBy: claims.sub, fields: sets.length - 1 };
  }

  /**
   * مسدود یا فعال کردنِ حساب.
   *
   * چرا «مسدود» و نه «حذف»؟ چون مشتری سفارش و سندِ مالی دارد؛ حذفِ او یعنی
   * پاره کردنِ تاریخچه‌ی فروش و دفتر. مسدود کردن، دسترسی را می‌گیرد و ردی را
   * نگه می‌دارد — و با یک دلیل ثبت می‌شود تا اگر بعداً کسی پرسید «چرا این
   * مشتری نمی‌تواند وارد شود؟» پاسخ در سامانه باشد، نه در حافظه‌ی اپراتور.
   */
  @Patch(':id/status')
  async setStatus(
    @Headers('authorization') authorization: string | undefined,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    const claims = await this.requireUser(authorization, 'deactivate');
    const input = DeactivateDto.parse(body);

    const reason = input.block ? (input.reason ?? 'دلیلی ثبت نشده') : null;

    const { affectedRows } = await this.db.query(
      `UPDATE customers
          SET is_active = $2, deactivated_reason = $3, updated_at = now()
        WHERE id = $1`,
      [id, !input.block, reason],
    );
    if (affectedRows === 0) throw new AppError('NOT_FOUND');

    // نشست‌هایِ باز باطل می‌شوند: مسدود کردنِ حساب فقط وقتی معنا دارد که
    // مشتریِ نشسته هم بیرون بیفتد، نه فقط در ورودِ بعدی.
    const { affectedRows: sessions } = await this.db.query(
      `UPDATE customer_sessions
          SET revoked_at = now(), revoke_reason = 'account_deactivated'
        WHERE customer_id = $1 AND revoked_at IS NULL`,
      [id],
    );

    return {
      id,
      isActive: !input.block,
      reason,
      revokedSessions: sessions,
      by: claims.sub,
    };
  }
}
