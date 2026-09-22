/**
 * یادآوری سررسید چک‌ها — هر روز ساعت ۸ صبح
 *
 * این اسکریپت توسط systemd timer اجرا می‌شود.
 * چک‌هایی که سررسیدشان فردا است و هنوز تسویه نشده‌اند.
 */

import { createDatabase } from '@set/db';
import { sendCheckDueReminders } from '@set/commerce';

async function main() {
  const url = process.env.DB_URL ?? process.env.DATABASE_URL;
  if (!url) throw new Error('DB_URL is required');
  const db = createDatabase(url);

  try {
    const result = await sendCheckDueReminders(db);
    console.log(`✅ ${result.sent} یادآوری سررسید چک ارسال شد.`);
  } catch (err) {
    console.error('❌ خطا در ارسال یادآوری چک:', err);
    process.exitCode = 1;
  } finally {
    await db.close();
  }
}

main();