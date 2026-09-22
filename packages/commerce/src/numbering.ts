import type { Queryable } from '@set/db';
import { getYear } from '@set/shared-kernel';

/**
 * شماره‌گذاری اسناد — پیشوند + سالِ شمسی + شماره‌ی پیوسته.
 *
 *   KH  رسیدِ انبار (خرید) FS  فاکتور فروش حضوری
 *   SO  سفارش آنلاین       MS  مرسوله
 *   CH  چک دریافتی         MR  مرجوعی مشتری
 *   BS  برگشت به تأمین‌کننده   PR  درخواستِ خرید
 *
 * چرا جدولِ جدا (document_counters) و نه MAX+1؟
 *   چون MAX+1 در ترافیکِ همزمان دو سندِ هم‌شماره می‌سازد و پرس‌وجو روی
 *   جدولِ بزرگِ اسناد سنگین است. اینجا یک INSERT ... ON CONFLICT با
 *   RETURNING است: اتمیک، یک ردیف، بدون قفل روی جدولِ اسناد.
 *
 * سالِ شمسی با تقویمِ رسمیِ ایران هماهنگ است (سندِ KH-1405-0001 در سال ۱۴۰۵).
 */
export type DocumentPrefix = 'KH' | 'FS' | 'SO' | 'MS' | 'CH' | 'MR' | 'BS' | 'PR';

export interface DocumentNumber {
  prefix: DocumentPrefix;
  year: number;
  number: number;
  /** نمونه: MR-1405-0004 */
  code: string;
}

export async function nextDocumentNumber(
  db: Queryable,
  prefix: DocumentPrefix,
  at: Date = new Date(),
): Promise<DocumentNumber> {
  const year = getYear(at); // سالِ شمسی

  const { rows } = await db.query<{ last_number: number }>(
    `INSERT INTO document_counters (prefix, year, last_number)
     VALUES ($1, $2, 1)
     ON CONFLICT (prefix, year)
     DO UPDATE SET last_number = document_counters.last_number + 1, updated_at = now()
     RETURNING last_number`,
    [prefix, year],
  );

  const number = Number(rows[0]?.last_number ?? 0);
  if (!Number.isFinite(number) || number < 1) {
    throw new Error('صدور شماره‌ی سند ناموفق بود');
  }

  return {
    prefix,
    year,
    number,
    code: `${prefix}-${year}-${String(number).padStart(4, '0')}`,
  };
}
