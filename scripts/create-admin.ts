/**
 * ساختِ نخستین مدیر (و نقش‌ها/دسترسی‌ها) — بی‌آن‌که API بالا بیاید.
 *
 * چرا این اسکریپت وجود دارد؟
 *   در تولید، ساختنِ نخستین کاربر با «بالا آوردنِ API و بستنش بعد از ۶۰
 *   ثانیه» انجام می‌شد: هم کند بود (مهاجرت + ساختِ وب)، هم اگر کسی فراموش
 *   می‌کرد سرویس را ببندد، سامانه با رمزِ نمونه بالا می‌ماند. اینجا فقط
 *   همان کاری انجام می‌شود که لازم است: مهاجرت + هویت، سپس خروج.
 *
 * اجرا:
 *   set -a; source /etc/setshop/env; set +a
 *   ADMIN_PASSWORD="رمزِ-قوی" tsx scripts/create-admin.ts
 *
 * بی‌خطر برای اجرایِ دوباره: کاربری که هست دوباره ساخته نمی‌شود؛ فقط اگر
 * ADMIN_PASSWORD تازه‌ای بدهید، رمزِ همان کاربر به‌روزرسانی می‌شود
 * (کاربردش: بازیابیِ دسترسی وقتی رمز فراموش شده است).
 */
import { applyMigrations, createDatabase } from '@set/db';
import { hashPassword } from '@set/auth';
import { seedIdentity } from '../apps/api/src/seed-identity.js';

// چرا در یک تابع؟ چون این پرونده با خروجیِ CJS ترجمه می‌شود و در آن قالب
// «انتظار در سطحِ بالا» پشتیبانی نیست؛ بستنِ کار در main() این محدودیت را
// دور می‌زند و خروجیِ برنامه را هم قطعی می‌کند.
async function main(): Promise<void> {
const dbUrl = process.env.DB_URL ?? 'memory://';
const askPassword = process.env.ADMIN_PASSWORD?.trim();

if (dbUrl === 'memory://') {
  console.error('DB_URL تعیین نشده است. نمونه: postgres://setshop@/setshop?host=/run/setshop&port=5433');
  process.exit(2);
}

const db = createDatabase(dbUrl);

try {
  const applied = await applyMigrations(db);
  console.log(
    applied.length
      ? `مهاجرت‌های اعمال‌شده: ${applied.join('، ')}`
      : 'همه‌ی مهاجرت‌ها از پیش اعمال شده‌اند',
  );

  const identity = await seedIdentity(db);
  if (identity.users.length === 0) {
    console.log('کاربران از پیش وجود داشتند (چیزی ساخته نشد).');
  } else {
    console.log('کاربران آماده‌اند:');
    for (const u of identity.users) console.log(`  • ${u.mobile} — ${u.role}`);
  }

  // اگر رمزی خواسته شده، آن را روی مدیرِ کل هم اعمال کن (چه تازه ساخته شده
  // باشد چه از پیش بوده باشد) — این راهِ بازیابیِ دسترسی است.
  if (askPassword) {
    const hash = await hashPassword(askPassword);
    const { affectedRows } = await db.query(
      `UPDATE users SET password_hash = $1, is_active = true
        WHERE id = (SELECT ur.user_id FROM user_roles ur
                     JOIN roles r ON r.id = ur.role_id
                    WHERE r.key = 'super_admin' ORDER BY ur.created_at LIMIT 1)`,
      [hash],
    );
    console.log(
      affectedRows
        ? 'رمزِ مدیرِ کل به‌روزرسانی شد.'
        : 'هشدار: مدیرِ کل پیدا نشد تا رمزش به‌روزرسانی شود.',
    );
  } else {
    console.log('یادآوری: رمزِ کاربرانِ نمونه هنوز مقدارِ پیش‌فرض است؛ آن را تغییر دهید.');
  }
} finally {
  await db.close();
}
}

main().catch((error) => {
  console.error('ساختِ مدیر ناموفق بود:', error);
  process.exit(1);
});
