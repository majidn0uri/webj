import { Body, Controller, Get, Headers, Inject, Param, Patch, Post, Query } from '@nestjs/common';

import { AppError } from '@set/shared-kernel';
import type { Database } from '@set/db';
import type { AccessControl } from '@set/rbac';
import type { AccessClaims, TokenService } from '@set/auth';
import { sessionFromToken } from '@set/shopper';

import { DB, TOKEN_SERVICE, ACCESS_CONTROL } from './tokens.js';

/**
 * پرسش و پاسخ محصول
 *
 * خریداران سؤال می‌پرسند، فروشنده/مدیر پاسخ می‌دهد.
 * پاسخ‌های تأییدشده عمومی و قابل مشاهده برای همه هستند.
 */

@Controller()
export class QaController {
  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(TOKEN_SERVICE) private readonly tokens: TokenService,
    @Inject(ACCESS_CONTROL) private readonly access: AccessControl,
  ) {}

  private async shopper(headers: Record<string, string | undefined>) {
    const cookie = headers?.cookie ?? '';
    const fromCookie = /(?:^|;\s*)set_customer_token=([^;]+)/.exec(cookie);
    const token = fromCookie?.[1]
      ? decodeURIComponent(fromCookie[1])
      : (headers?.['x-shopper-token'] ?? '').replace(/^Bearer\s+/, '') || null;
    return sessionFromToken(this.db, token);
  }

  private async requireAdmin(authorization: string | undefined, perm = 'catalog.write'): Promise<AccessClaims> {
    const token = authorization?.startsWith('Bearer ') ? authorization.slice(7) : undefined;
    if (!token) throw new AppError('UNAUTHENTICATED');
    const claims = await this.tokens.verifyAccess(token);
    if (!claims) throw new AppError('UNAUTHENTICATED');
    const [resource, action] = perm.split('.');
    await this.access.assert({ userId: claims.sub, branchId: null }, resource!, action!);
    return claims;
  }

  // ── مسیرهای عمومی (سایت) ─────────────────────────────────────────

  /**
   * GET /shop/products/:productId/questions
   * پرسش‌های عمومی یک محصول
   */
  @Get('shop/products/:productId/questions')
  async list(@Param('productId') productId: string, @Query('limit') limit?: string) {
    const lim = Math.min(Number(limit ?? '20'), 50);
    const { rows } = await this.db.query<{
      id: string;
      question: string;
      answer: string | null;
      answered_at: string | null;
      customer_name: string | null;
      created_at: string;
    }>(
      `SELECT pq.id, pq.question, pq.answer, pq.answered_at,
              c.name AS customer_name, pq.created_at
       FROM product_questions pq
       LEFT JOIN customers c ON c.id = pq.customer_id
       WHERE pq.product_id = $1 AND pq.is_public = true AND pq.answer IS NOT NULL
       ORDER BY pq.answered_at DESC
       LIMIT $2`,
      [productId, lim],
    );

    return {
      items: rows.map((r) => ({
        id: r.id,
        question: r.question,
        answer: r.answer,
        answeredAt: r.answered_at,
        customerName: r.customer_name ?? 'ناشناس',
        createdAt: r.created_at,
      })),
    };
  }

  /**
   * POST /shop/products/:productId/questions
   * ثبت پرسش جدید (خریدار وارد شده یا مهمان)
   */
  @Post('shop/products/:productId/questions')
  async ask(
    @Param('productId') productId: string,
    @Body() body: Record<string, unknown>,
    @Headers() headers: Record<string, string | undefined>,
  ) {
    const question = String(body.question ?? '').trim();
    if (question.length < 10) throw new AppError('VALIDATION', { message: 'پرسش باید حداقل ۱۰ حرف باشد.' });
    if (question.length > 1000) throw new AppError('VALIDATION', { message: 'پرسش خیلی بلند است.' });

    const session = await this.shopper(headers);
    const customerId = session?.customerId ?? null;
    const guestName = !customerId ? String(body.name ?? '').trim().slice(0, 80) || null : null;
    const guestEmail = !customerId ? String(body.email ?? '').trim().slice(0, 200) || null : null;

    if (!customerId && !guestName) {
      throw new AppError('VALIDATION', { message: 'نام خود را بنویسید یا وارد شوید.' });
    }

    // بررسی وجود محصول
    const prod = await this.db.query<{ id: string }>(
      `SELECT id FROM products WHERE id = $1`,
      [productId],
    );
    if (!prod.rows[0]) throw new AppError('NOT_FOUND', { message: 'محصول یافت نشد.' });

    // محدودیت: هر مشتری روزی ۵ پرسش
    if (customerId) {
      const today = await this.db.query<{ n: string }>(
        `SELECT COUNT(*)::text AS n FROM product_questions
         WHERE customer_id = $1 AND created_at > now() - interval '1 day'`,
        [customerId],
      );
      if (Number(today.rows[0]?.n ?? 0) >= 5) {
        throw new AppError('RATE_LIMITED', { message: 'تعداد پرسش‌های امروز شما تکمیل شده.' });
      }
    }

    const { rows } = await this.db.query<{ id: string }>(
      `INSERT INTO product_questions (product_id, customer_id, question, is_public)
       VALUES ($1, $2, $3, false)
       RETURNING id`,
      [productId, customerId, question],
    );

    return {
      id: rows[0]?.id ?? '',
      message: 'پرسش شما ثبت شد و پس از بررسی منتشر خواهد شد.',
    };
  }

  // ── مسیرهای مدیر (پنل) ───────────────────────────────────────────

  /**
   * GET /admin/questions
   * فهرست پرسش‌ها (با فیلتر پاسخ‌داده‌نشده)
   */
  @Get('admin/questions')
  async adminList(
    @Headers('authorization') authorization: string | undefined,
    @Query('status') status?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    await this.requireAdmin(authorization, 'catalog.read');

    const lim = Math.min(Number(limit ?? '30'), 100);
    const off = Math.max(0, Number(offset ?? '0'));

    let where = '1=1';
    if (status === 'unanswered') where = 'pq.answer IS NULL';
    if (status === 'answered') where = 'pq.answer IS NOT NULL';

    const countRes = await this.db.query<{ total: string }>(
      `SELECT COUNT(*)::text AS total FROM product_questions pq WHERE ${where}`,
    );

    const { rows } = await this.db.query<{
      id: string;
      product_id: string;
      product_title: string;
      question: string;
      answer: string | null;
      customer_name: string | null;
      is_public: boolean;
      created_at: string;
    }>(
      `SELECT pq.id, pq.product_id, p.title AS product_title,
              pq.question, pq.answer, c.name AS customer_name,
              pq.is_public, pq.created_at
       FROM product_questions pq
       JOIN products p ON p.id = pq.product_id
       LEFT JOIN customers c ON c.id = pq.customer_id
       WHERE ${where}
       ORDER BY pq.created_at DESC
       LIMIT $1 OFFSET $2`,
      [lim, off],
    );

    return {
      total: Number(countRes.rows[0]?.total ?? 0),
      items: rows,
    };
  }

  /**
   * PATCH /admin/questions/:id/answer
   * ثبت پاسخ و انتشار
   */
  @Patch('admin/questions/:id/answer')
  async answer(
    @Param('id') id: string,
    @Body() body: Record<string, unknown>,
    @Headers('authorization') authorization: string | undefined,
  ) {
    const claims = await this.requireAdmin(authorization, 'catalog.write');
    const answerText = String(body.answer ?? '').trim();
    if (answerText.length < 2) throw new AppError('VALIDATION', { message: 'پاسخ را بنویسید.' });
    if (answerText.length > 2000) throw new AppError('VALIDATION', { message: 'پاسخ خیلی بلند است.' });

    const { rows } = await this.db.query(
      `UPDATE product_questions
       SET answer = $1, answered_by = $2, answered_at = now(), is_public = true
       WHERE id = $3
       RETURNING id`,
      [answerText, claims.sub, id],
    );

    if (!rows[0]) throw new AppError('NOT_FOUND', { message: 'پرسش یافت نشد.' });
    return { message: 'پاسخ ثبت و منتشر شد.' };
  }

  /**
   * DELETE /admin/questions/:id
   * حذف پرسش
   */
  @Patch('admin/questions/:id/toggle')
  async toggleVisibility(
    @Param('id') id: string,
    @Headers('authorization') authorization: string | undefined,
  ) {
    await this.requireAdmin(authorization, 'catalog.write');

    const { rows } = await this.db.query(
      `UPDATE product_questions
       SET is_public = NOT is_public
       WHERE id = $1
       RETURNING id, is_public`,
      [id],
    );

    if (!rows[0]) throw new AppError('NOT_FOUND', { message: 'پرسش یافت نشد.' });
    return { id: rows[0].id, isPublic: rows[0].is_public };
  }
}