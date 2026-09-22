/** نمایشِ پول به تومان با ارقامِ فارسی — مبالغ همیشه ریال در پایگاه‌داده ذخیره می‌شوند. */
export function toman(rial: string | number): string {
  const value = Math.round(Number(rial) / 10);
  return new Intl.NumberFormat('fa-IR').format(value);
}

export function discountPercent(priceRial: string, compareAtRial: string | null): number | null {
  if (!compareAtRial) return null;
  const price = Number(priceRial);
  const compare = Number(compareAtRial);
  if (!compare || compare <= price) return null;
  return Math.round(((compare - price) / compare) * 100);
}

/** برچسبِ فارسی برای وضعیتِ سازگاری (بخشِ ماتریسِ سازگاری) */
export function compatibilityLabel(state: string): { text: string; tone: string } {
  switch (state) {
    case 'exact':
      return { text: 'سازگارِ قطعی', tone: 'success' };
    case 'reported':
      return { text: 'سازگار (گزارشِ کاربر)', tone: 'warning' };
    default:
      return { text: 'سازگاری اعلام نشده', tone: 'soft' };
  }
}

/**
 * رقم‌هایِ فارسی برایِ نمایش در مرورگر.
 *
 * چرا اینجا و نه در هسته‌یِ مشترک؟ چون این پرونده در بسته‌یِ سمتِ کاربر
 * هم می‌رود و هسته برایِ کارهایش `node:crypto` می‌خواهد — که در مرورگر
 * نیست. ابزارِ نمایش باید از وابستگیِ سمتِ کارساز آزاد باشد.
 */
export function faDigits(value: string | number): string {
  return String(value).replace(/\d/g, (digit) => '۰۱۲۳۴۵۶۷۸۹'[Number(digit)]);
}

/** ریال (رشته یا BigInt) → تومان، با محاسبه‌یِ دقیق (بدونِ عددِ اعشاری) */
export function tomanRial(rial: string | bigint | null | undefined): string {
  if (rial == null || rial === '') return '۰';
  const value = typeof rial === 'bigint' ? rial : BigInt(String(rial).trim());
  // ریال ← تومان: تقسیم بر ده با گرد کردن به نفعِ مشتری (به بالا)
  const toman = (value + 9n) / 10n;
  return faDigits(toman.toLocaleString('en-US'));
}
