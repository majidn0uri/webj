/**
 * کارگرِ مالیات — یک دورِ ارسال و استعلام.
 *
 * چرا یک کارگرِ جدا؟ چون ارسال به سامانه‌یِ مؤدیان نباید به درخواستِ یک کاربر
 * گره بخورد:
 *   • اگر هنگامِ ارسال اینترنت برود، نباید صفحه‌یِ مدیر هنگ کند؛
 *   • اگر سازمان کند پاسخ بدهد، نباید کسی منتظر بماند؛
 *   • و اگر نیمه‌شب ارسال انجام شود، صبح صورتحساب‌ها آماده است.
 *
 * این کارگر «یک بار» اجرا می‌شود و تمام می‌شود؛ زمان‌بندی با systemd-timer
 * (‎`deploy/systemd/set-shop-tax.timer`‎) انجام می‌گردد. خروجی‌اش یک خط است تا
 * در لاگِ سیستمی خواندنی باشد و بتوان با `journalctl` وضعیت را دید.
 *
 * اجرا:  DB_URL="postgres://…" npx tsx scripts/tax-worker.ts
 */

import { createDatabase, type Database } from '../packages/db/src/index.js';
import {
  clientForMode,
  inquirePending,
  readTaxSettings,
  retryStuck,
  sendDueBatch,
} from '../packages/tax/src/index.js';

async function main(): Promise<void> {
  const url = process.env.DB_URL;
  if (!url) {
    console.error('DB_URL تنظیم نشده است.');
    process.exit(1);
  }

  const db: Database = createDatabase(url);
  const settings = await readTaxSettings(db);

  if (!settings.enabled) {
    console.log('ارسالِ خودکار خاموش است (moadian_enabled=false)؛ کاری انجام نشد.');
    await db.close();
    return;
  }
  if (!settings.fiscalId) {
    console.log('شناسه‌یِ یکتایِ حافظه‌یِ مالیاتی وارد نشده؛ ارسال ممکن نیست.');
    await db.close();
    return;
  }

  const client = clientForMode(settings.mode);

  // ردیف‌هایی که در «در حالِ ارسال» مانده‌اند (خاموشی یا قطعی میانِ کار)
  const freed = await retryStuck(db, 15);
  const batch = await sendDueBatch(db, client, 50);
  const inquiry = await inquirePending(db, client, 100);

  console.log(
    [
      `حالت: ${settings.mode}`,
      `آزادشده از حالتِ گیرکرده: ${freed}`,
      `ارسال: ${batch.sent} موفق، ${batch.failed} ناموفق`,
      `استعلام: ${inquiry.accepted} تأیید، ${inquiry.rejected} رد`,
    ].join(' | '),
  );

  await db.close();
}

main().catch((e) => {
  console.error('کارگرِ مالیات شکست خورد:', e);
  process.exit(1);
});
