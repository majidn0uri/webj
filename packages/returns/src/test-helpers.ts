import type { Database } from '@set/db';

/**
 * ترازِ دفترکل — ابزارِ آزمون.
 *
 * چرا اینجا و نه در یک بسته‌یِ مشترک؟ چون آزمونِ مرجوعی باید بتواند در هر
 * گام بپرسد «دفتر هنوز تراز است؟». اگر این پرسش فقط در پایانِ کلِ مجموعه
 * پرسیده می‌شد، معلوم نبود کدام گام تراز را به هم زده.
 */
export async function trialBalanceOf(db: Database): Promise<boolean> {
  const { rows } = await db.query<{ balanced: boolean }>(
    `SELECT (COALESCE(SUM(debit_rial),0) = COALESCE(SUM(credit_rial),0)) AS balanced
       FROM journal_lines`,
  );
  return rows[0]?.balanced ?? false;
}
