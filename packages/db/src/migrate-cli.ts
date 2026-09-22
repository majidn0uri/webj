import { createDatabase } from './client.js';
import { applyMigrations } from './migrate.js';

/** اجرای مهاجرت‌ها از خط فرمان: npm run migrate */
const dbUrl = process.env.DB_URL ?? 'memory://';
const db = createDatabase(dbUrl);

const applied = await applyMigrations(db);
console.log(
  applied.length
    ? `مهاجرت‌های اعمال‌شده روی ${dbUrl}: ${applied.join(', ')}`
    : `همه‌ی مهاجرت‌ها از قبل اعمال شده‌اند (${dbUrl})`,
);

await db.close();
