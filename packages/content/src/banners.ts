/**
 * بنرها و پیام‌هایِ ویترین.
 *
 * قاعده‌یِ واحدِ اینجا — همان که بیشترین اشتباه از آن می‌آید — **پنجره‌یِ
 * نمایش** است: یک بنر تنها زمانی دیده می‌شود که هم روشن باشد و هم «اکنون»
 * در بازه‌اش بگنجد. دو سرِ بازه می‌توانند تهی باشند (بی‌مرز)، و این سه حالت
 * با هم فرق دارند:
 *
 *   • هیچ‌کدام ← همیشه
 *   • فقط آغاز  ← از آن لحظه به بعد
 *   • فقط پایان ← تا آن لحظه
 *
 * نکته‌یِ ظریف: پایان را «فراگیر» می‌گیریم (بنری که امروز پایان می‌یابد،
 * امروز هنوز دیده می‌شود)؛ چون فروشنده‌ای که می‌نویسد «تا ۳۱ شهریور»،
 * انتظار دارد ۳۱ شهریور هم دیده شود — وگرنه کمپین یک روز زودتر می‌میرد و
 * دلیلش را هم نمی‌فهمد.
 */

import { AppError } from '@set/shared-kernel';
import type { Database } from '@set/db';

export type BannerKind = 'announcement' | 'hero' | 'middle';

export interface Banner {
  id: string;
  kind: BannerKind;
  title: string;
  body: string;
  linkUrl: string | null;
  imageUrl: string | null;
  placeholder: string | null;
  tone: string | null;
  sortOrder: number;
  startsAt: Date | null;
  endsAt: Date | null;
  isActive: boolean;
  createdAt: Date;
}

export interface BannerInput {
  kind: BannerKind;
  title?: string;
  body?: string;
  linkUrl?: string | null;
  imageUrl?: string | null;
  placeholder?: string | null;
  tone?: string | null;
  sortOrder?: number;
  startsAt?: Date | null;
  endsAt?: Date | null;
  isActive?: boolean;
  createdBy?: string | null;
}

interface BannerRow {
  id: string;
  kind: string;
  title: string;
  body: string;
  link_url: string | null;
  image_url: string | null;
  placeholder: string | null;
  tone: string | null;
  sort_order: number;
  starts_at: Date | null;
  ends_at: Date | null;
  is_active: boolean;
  created_at: Date;
}

const KINDS: BannerKind[] = ['announcement', 'hero', 'middle'];

function toBanner(row: BannerRow): Banner {
  return {
    id: row.id,
    kind: row.kind as BannerKind,
    title: row.title,
    body: row.body,
    linkUrl: row.link_url,
    imageUrl: row.image_url,
    placeholder: row.placeholder,
    tone: row.tone,
    sortOrder: row.sort_order,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    isActive: row.is_active,
    createdAt: row.created_at,
  };
}

const SELECT_COLUMNS = `id, kind, title, body, link_url, image_url, placeholder, tone,
       sort_order, starts_at, ends_at, is_active, created_at`;

export class BannerService {
  constructor(private readonly db: Database) {}

  /** بنرهایِ «اکنون قابلِ نمایش» در یک جایگاه — آنچه سایت نشان می‌دهد */
  async visible(kind: BannerKind, now: Date = new Date()): Promise<Banner[]> {
    const { rows } = await this.db.query<BannerRow>(
      `SELECT ${SELECT_COLUMNS}
         FROM store_banners
        WHERE kind = $1
          AND is_active = true
          AND (starts_at IS NULL OR starts_at <= $2)
          AND (ends_at   IS NULL OR ends_at   >= $2)
        ORDER BY sort_order, created_at DESC`,
      [kind, now],
    );
    return rows.map(toBanner);
  }

  /** همه‌یِ بنرهایِ یک جایگاه — برایِ پنل، بی‌توجه به زمان و روشن‌بودن */
  async listByKind(kind: BannerKind): Promise<Banner[]> {
    const { rows } = await this.db.query<BannerRow>(
      `SELECT ${SELECT_COLUMNS} FROM store_banners WHERE kind = $1 ORDER BY sort_order, created_at DESC`,
      [kind],
    );
    return rows.map(toBanner);
  }

  async listAll(): Promise<Banner[]> {
    const { rows } = await this.db.query<BannerRow>(
      `SELECT ${SELECT_COLUMNS} FROM store_banners
        ORDER BY CASE kind WHEN 'announcement' THEN 0 WHEN 'hero' THEN 1 ELSE 2 END,
                 sort_order, created_at DESC`,
    );
    return rows.map(toBanner);
  }

  async get(id: string): Promise<Banner | null> {
    const { rows } = await this.db.query<BannerRow>(
      `SELECT ${SELECT_COLUMNS} FROM store_banners WHERE id = $1`,
      [id],
    );
    return rows[0] ? toBanner(rows[0]) : null;
  }

  async create(input: BannerInput): Promise<Banner> {
    if (!KINDS.includes(input.kind)) {
      throw new AppError('VALIDATION', { message: `گونه‌یِ بنر نامعتبر است: ${String(input.kind)}` });
    }
    // پایگاه همین قید را دارد؛ اینجا پیامش فارسی و روشن می‌شود
    if (input.kind !== 'announcement' && !input.imageUrl) {
      // خطایِ اعتبارسنجی است، نه خطایِ سامانه: پاسخ باید ۴۰۰ باشد تا رابط
      // بتواند همان‌جا، کنارِ فیلد، دلیل را نشان دهد — نه آنکه به‌صورتِ
      // «خطایِ داخلی» پنهان شود.
      throw new AppError('VALIDATION', { message: 'بنرِ اصلی و میانی باید تصویر داشته باشند' });
    }
    const { rows } = await this.db.query<BannerRow>(
      `INSERT INTO store_banners
         (kind, title, body, link_url, image_url, placeholder, tone,
          sort_order, starts_at, ends_at, is_active, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       RETURNING ${SELECT_COLUMNS}`,
      [
        input.kind,
        input.title ?? '',
        input.body ?? '',
        input.linkUrl ?? null,
        input.imageUrl ?? null,
        input.placeholder ?? null,
        input.tone ?? null,
        input.sortOrder ?? 0,
        input.startsAt ?? null,
        input.endsAt ?? null,
        input.isActive ?? true,
        input.createdBy ?? null,
      ],
    );
    return toBanner(rows[0]!);
  }

  async update(id: string, patch: Partial<BannerInput>): Promise<Banner | null> {
    const current = await this.get(id);
    if (!current) return null;

    const next = {
      kind: patch.kind ?? current.kind,
      title: patch.title ?? current.title,
      body: patch.body ?? current.body,
      linkUrl: patch.linkUrl !== undefined ? patch.linkUrl : current.linkUrl,
      imageUrl: patch.imageUrl !== undefined ? patch.imageUrl : current.imageUrl,
      placeholder: patch.placeholder !== undefined ? patch.placeholder : current.placeholder,
      tone: patch.tone !== undefined ? patch.tone : current.tone,
      sortOrder: patch.sortOrder ?? current.sortOrder,
      startsAt: patch.startsAt !== undefined ? patch.startsAt : current.startsAt,
      endsAt: patch.endsAt !== undefined ? patch.endsAt : current.endsAt,
      isActive: patch.isActive ?? current.isActive,
    };

    if (next.kind !== 'announcement' && !next.imageUrl) {
      throw new AppError('VALIDATION', { message: 'بنرِ اصلی و میانی باید تصویر داشته باشند' });
    }

    const { rows } = await this.db.query<BannerRow>(
      `UPDATE store_banners
          SET kind = $2, title = $3, body = $4, link_url = $5, image_url = $6,
              placeholder = $7, tone = $8, sort_order = $9,
              starts_at = $10, ends_at = $11, is_active = $12,
              updated_at = now()
        WHERE id = $1
        RETURNING ${SELECT_COLUMNS}`,
      [
        id,
        next.kind,
        next.title,
        next.body,
        next.linkUrl,
        next.imageUrl,
        next.placeholder,
        next.tone,
        next.sortOrder,
        next.startsAt,
        next.endsAt,
        next.isActive,
      ],
    );
    return rows[0] ? toBanner(rows[0]) : null;
  }

  /**
   * برداشتن.
   *
   * چرا با `RETURNING` و نه با `rowCount`؟ چون لایه‌یِ درون‌حافظه (که
   * آزمون‌ها با آن اجرا می‌شوند) شمارِ ردیف را برنمی‌گرداند؛ تکیه بر آن یعنی
   * کدی که روی پایگاهِ واقعی درست است و در آزمون «حذف نشد» گزارش می‌دهد.
   */
  async remove(id: string): Promise<boolean> {
    const { rows } = await this.db.query<{ id: string }>(
      `DELETE FROM store_banners WHERE id = $1 RETURNING id`,
      [id],
    );
    return rows.length > 0;
  }

  /** جابه‌جاییِ چند بنر با یک درخواست — ترتیبِ ویترین دستِ فروشنده است */
  async reorder(ids: string[]): Promise<void> {
    for (let index = 0; index < ids.length; index += 1) {
      await this.db.query(`UPDATE store_banners SET sort_order = $2, updated_at = now() WHERE id = $1`, [
        ids[index]!,
        index,
      ]);
    }
  }
}
