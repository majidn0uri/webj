/**
 * نشاندنِ کاتالوگِ نمونه (برندها، دستگاه‌ها، کالاها، انبارها، حساب‌ها).
 *
 * چرا اسکریپتی جدا؟ چون نشاندنِ کاتالوگ کاری است که در استقرارِ تازه یک‌بار
 * انجام می‌شود (تا فروشگاه خالی نباشد)، اما هیچ‌گاه نباید در اجرایِ عادی
 * تکرار شود: فروشگاهِ واقعی کالاهایِ خودش را دارد. جدابودنش باعث می‌شود
 * `install.sh` بتواند آن را صدا بزند و مدیر هم بتواند آن را نادیده بگیرد.
 *
 * اجرا:  DB_URL="postgres://…" npx tsx scripts/seed-catalog.ts
 */

import { createDatabase, seedCatalog } from '../packages/db/src/index.js';

async function main(): Promise<void> {
  const url = process.env.DB_URL ?? 'memory://';
  const db = createDatabase(url);
  const summary = await seedCatalog(db, { openingInventory: true });
  console.log('کاتالوگ نشانده شد:');
  console.log(`  برندها: ${summary.brands ?? '—'}`);
  console.log(`  کالاها: ${summary.products ?? '—'}`);
  console.log(`  تنوع‌ها: ${summary.variants ?? '—'}`);
  console.log(`  پیوندهایِ سازگاری: ${summary.compatibilityRows ?? '—'}`);
  await db.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
