/**
 * سنجشِ «بهداشتِ رسانه» رویِ PostgreSQLِ واقعی + دیسکِ واقعی.
 *
 * چرا لازم است؟ چون این مسیر دو چیز را با هم می‌خواهد: `LIKE '/media/%'` رویِ
 * شش ستون از چهار جدول، و `stat`/`unlink` رویِ فایل‌هایِ واقعی. PGlite رفتارِ
 * SQL را می‌سنجد و آزمونِ واحد، منطقِ پوشه را — اما «آیا پاک‌سازی، بنرِ امروزِ
 * صفحهٔ نخست را می‌بَرَد؟» فقط رویِ سرورِ واقعی جواب می‌گیرد، همان‌جا که این
 * باگ اصلاً زندگی می‌کرد.
 *
 * اجرا:  DB_URL="postgres://…" npx tsx scripts/pg-media-drill.mts
 * (پوشهٔ رسانهٔ آزمون در /tmp ساخته و در پایان پاک می‌شود؛ `MEDIA_DIRِ` واقعی دست نمی‌خورد)
 */
import { mkdtemp, mkdir, readdir, rm, stat, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { applyMigrations, createDatabase, type Database } from '@set/db';
import {
  MEDIA_POLICY_KEYS,
  formatMediaBytes,
  mediaHygiene,
  readMediaPolicy,
} from '../packages/commerce/src/media-hygiene.js';
import { getSetting } from '../packages/commerce/src/settings.js';
import { publicUrl } from '../packages/media/src/store.js';

const URL = process.env.DB_URL;
if (!URL) throw new Error('DB_URL لازم است');

const mediaDir = await mkdtemp(path.join(tmpdir(), 'set-media-pg-'));
process.env.MEDIA_DIR = mediaDir;

const db: Database = createDatabase(URL);
await applyMigrations(db);

let fails = 0;
const ok = (name: string, cond: boolean, extra = ''): void => {
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`);
  if (!cond) fails++;
};

const DAY = 86_400_000;
const MARK = 'media-drill';

/** فایلِ رسانه‌ایِ ساختگی با نامِ استانداردِ خودِ سامانه */
async function putFile(index: number, ageDays: number): Promise<string> {
  const hash = index.toString(16).padStart(64, '0');
  const dir = path.join(mediaDir, hash.slice(0, 2));
  await mkdir(dir, { recursive: true });
  const file = path.join(dir, `${hash}-full.jpg`);
  await writeFile(file, Buffer.alloc(1024, 5));
  if (ageDays > 0) {
    const when = new Date(Date.now() - ageDays * DAY);
    await utimes(file, when, when);
  }
  return publicUrl(path.join(hash.slice(0, 2), `${hash}-full.jpg`));
}

async function exists(url: string): Promise<boolean> {
  try {
    await stat(path.join(mediaDir, url.replace(/^\/media\//, '')));
    return true;
  } catch {
    return false;
  }
}

async function setRaw(key: string, value: string): Promise<void> {
  await db.query(
    `INSERT INTO store_settings (key, value, updated_at) VALUES ($1,$2,now())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    [key, value],
  );
}

async function clean(): Promise<void> {
  await db.query(`DELETE FROM store_banners WHERE title LIKE $1`, [`${MARK}%`]);
  await db.query(`UPDATE product_types SET image_url = NULL WHERE image_url LIKE '/media/%' AND slug = $1`, [
    'media-drill-type',
  ]);
  await db.query(`DELETE FROM product_images WHERE alt = $1`, [MARK]);
  await db.query(`DELETE FROM products WHERE slug = $1`, ['media-drill-case']);
  await db.query(`DELETE FROM product_types WHERE slug = $1 OR key = $2`, ['media-drill-type', 'media-drill']);
  await db.query(`DELETE FROM audit_logs WHERE action = 'media.cleanup_ran'`);
  for (const key of Object.values(MEDIA_POLICY_KEYS)) {
    await db.query(`DELETE FROM store_settings WHERE key = $1`, [key]);
  }
  // بازگرداندنِ سه کلیدِ کاشته‌شده در مهاجرتِ ۰۳۸ (پیش‌فرضِ خودِ مهاجرت)
  await db.query(
    `INSERT INTO store_settings (key, value, description) VALUES
       ('media_grace_days','14','تصویری که هیچ ردیفی در پایگاه نمی‌خواهد، چند روز بماند تا قطعی شود بی‌صاحب است؟ ۰ یعنی هرگز پاک نشود (و پویش هم نشود).'),
       ('media_autopurge','false','کارگرِ پس از فروش خودش فایل‌هایِ بی‌صاحب را بردارد؟ خاموش یعنی فقط گزارش.'),
       ('media_scan_minutes','360','هر چند دقیقه یک بار پوشهٔ رسانه از نو پویش شود؟')
     ON CONFLICT (key) DO NOTHING`,
  );
  for (const entry of await readdir(mediaDir)) await rm(path.join(mediaDir, entry), { recursive: true, force: true });
}
await clean();

// ── ۱) مهاجرتِ ۰۳۸ رویِ PostgreSQLِ واقعی ─────────────────────────────────────
const seeded = await Promise.all([
  getSetting(db, MEDIA_POLICY_KEYS.graceDays),
  getSetting(db, MEDIA_POLICY_KEYS.autopurge),
  getSetting(db, MEDIA_POLICY_KEYS.scanIntervalMinutes),
]);
ok(
  'مهاجرتِ ۰۳۸ سه کلید را کاشته است',
  seeded[0] === '14' && seeded[1] === 'false' && seeded[2] === '360',
  JSON.stringify(seeded),
);
const policy = await readMediaPolicy(db);
ok('سیاست از پنل خوانده می‌شود', policy.graceDays === 14 && policy.autopurge === false, JSON.stringify(policy));

// ── ۲) بی‌صاحبِ کهنه می‌رود، تازه می‌ماند ───────────────────────────────────
const stale = await putFile(0x11, 90);
const young = await putFile(0x12, 0);
let report = await mediaHygiene(db, { mode: 'report', fresh: true });
ok('پیش‌نمایش بی‌صاحب را می‌بیند و چیزی پاک نمی‌کند', report.orphans === 1 && (await exists(stale)), `orphans=${report.orphans}`);
ok('حجم به قلمِ فارسی در یادداشت می‌آید', /مگابایت|کیلوبایت|بایت/.test(report.notes.join(' ')) && !/[0-9]/.test(report.notes.join(' ')), report.notes[0] ?? '');

report = await mediaHygiene(db, { mode: 'run', fresh: true });
ok('اجرا: فایلِ کهنه رفت', report.removed === 1 && !(await exists(stale)) && (await exists(young)));
ok('اجرا: کش نوشته شد', (await getSetting(db, MEDIA_POLICY_KEYS.lastScan)).includes('"scannedAt"'));
ok('یادداشتِ اجرا رقمِ فارسی دارد', !/[0-9]/.test(report.notes.join(' ')), report.notes.join(' / ').slice(0, 90));

// ── ۳) ارجاع‌هایِ بیرونِ product_images (همان باگِ اصلی) ────────────────────
const bannerFile = await putFile(0x21, 500);
const categoryFile = await putFile(0x22, 500);
await db.query(`INSERT INTO store_banners (kind, title, image_url) VALUES ('hero',$1,$2)`, [`${MARK} banner`, bannerFile]);
const typeId = (
  await db.query<{ id: string }>(
    `INSERT INTO product_types (key, name, slug) VALUES ('media-drill','تستِ رسانه','media-drill-type') RETURNING id`,
  )
).rows[0]!.id;
await db.query(`UPDATE product_types SET image_url = $1 WHERE id = $2`, [categoryFile, typeId]);

report = await mediaHygiene(db, { mode: 'run', fresh: true });
ok('بنرِ ویترین: فایلِ ۵۰۰روزه هم ماند', await exists(bannerFile), `removed=${report.removed}`);
ok('تصویرِ دسته: فایلِ ۵۰۰روزه هم ماند', await exists(categoryFile));
ok(
  'مهلتِ ۱۴روزه، فایلِ تازه را هم نگه داشت',
  report.removed === 0 && (await exists(young)),
  `removed=${report.removed} young=${await exists(young)}`,
);

// ── ۴) مهلتِ صفر = پویش هم نه ──────────────────────────────────────────────
await setRaw(MEDIA_POLICY_KEYS.graceDays, '۰');
await db.query(`DELETE FROM store_settings WHERE key = $1`, [MEDIA_POLICY_KEYS.lastScan]);
const orphan = await putFile(0x31, 900);
const zero = await mediaHygiene(db, { mode: 'run', fresh: true });
ok('مهلتِ صفر: چیزی پاک نشد', zero.removed === 0 && (await exists(orphan)));
ok('مهلتِ صفر: پوشه پویش هم نشد (بی‌کش، بی‌عدد)', zero.files === 0 && zero.cached === false);
ok('مهلتِ صفر: توضیح می‌دهد چرا', zero.notes.join(' ').includes('هرگز پاک نشود'), zero.notes[0] ?? '');
await setRaw(MEDIA_POLICY_KEYS.graceDays, '14');

// ── ۵) فایلِ ناشناس و فایلِ میانیِ نیمه ────────────────────────────────────
const unmanagedDir = path.join(mediaDir, 'ab');
await mkdir(unmanagedDir, { recursive: true });
await writeFile(path.join(unmanagedDir, 'پشتیبانِ-دستی.tar'), Buffer.alloc(2048));
await writeFile(path.join(unmanagedDir, `${'4'.repeat(64)}-full.jpg.777.tmp`), Buffer.alloc(64));
const staleTmp = path.join(unmanagedDir, `${'5'.repeat(64)}-full.jpg.888.tmp`);
await writeFile(staleTmp, Buffer.alloc(64));
const when = new Date(Date.now() - 3 * 3600_000);
await utimes(staleTmp, when, when);

report = await mediaHygiene(db, { mode: 'run', fresh: true });
ok('فایلِ ناشناس شمرده شد و پاک نشد', report.unmanaged === 1 && (await stat(path.join(unmanagedDir, 'پشتیبانِ-دستی.tar'))).size > 0, `unmanaged=${report.unmanaged}`);
ok(
  '`.tmp`ِ کهنه رفت و `.tmp`ِ جوان ماند',
  (await stat(staleTmp).catch(() => null)) === null &&
    (await stat(path.join(unmanagedDir, `${'4'.repeat(64)}-full.jpg.777.tmp`))).size === 64,
  `tempStale=${report.tempStale} tempSkipped=${report.tempSkipped}`,
);
ok('بی‌صاحبِ کهنه در همین دور هم رفت', !(await exists(orphan)));
ok('یک دور = دو فایل (بی‌صاحب + میانیِ نیمه)', report.removed === 2 && report.removedBytes > 0, `removed=${report.removed}`);

// ── ۶) کشِ تازه، پویشِ دوباره نمی‌کند ──────────────────────────────────────
const hidden = await putFile(0x41, 90);
const cached1 = await mediaHygiene(db, { mode: 'report' });
ok('گزارشِ دوم از کش می‌آید و بی‌پویش است', cached1.cached === true && cached1.orphans === 0, `cached=${cached1.cached} orphans=${cached1.orphans}`);
ok('کش، فایلِ تازه‌ای را که بعد ازِ پویشِ اخیر ریخته‌اند نمی‌بیند', await exists(hidden) && cached1.orphans === 0);
const freshAgain = await mediaHygiene(db, { mode: 'report', fresh: true });
ok('«از نو بررسی کن» کش را رد می‌کند و همان فایل را می‌شمارد', freshAgain.cached === false && freshAgain.orphans === 1, `orphans=${freshAgain.orphans}`);

// ── ۷) تصویرِ شکسته گزارش می‌شود، ردیف دست نمی‌خورد ───────────────────────
const productId = (
  await db.query<{ id: string }>(
    `INSERT INTO products (type_id, title, slug, status) VALUES ($1,'قابِ آزمون','media-drill-case','active') RETURNING id`,
    [typeId],
  )
).rows[0]!.id;
const ghost = `/media/ff/${'9'.repeat(64)}-full.jpg`;
await db.query(`INSERT INTO product_images (product_id, url, role, alt) VALUES ($1,$2,'main',$3)`, [
  productId,
  ghost,
  MARK,
]);
const broken = await mediaHygiene(db, { mode: 'report', fresh: true });
ok('ردیفِ بی‌فایل، «تصویرِ شکسته» می‌شود', broken.missingTotal >= 1, `missing=${broken.missingTotal}`);
ok(
  'هیچ ردیفی در پایگاه پاک نشد',
  (await db.query(`SELECT count(*)::text n FROM product_images WHERE alt = $1`, [MARK])).rows[0]!.n === '1',
);
ok(
  'و پاک‌سازیِ خودکار بی‌ردِّ عملیات، ممیزی نمی‌نویسد',
  (await db.query(`SELECT count(*)::text n FROM audit_logs WHERE action = 'media.cleanup_ran'`)).rows[0]!.n === '0',
);

// ── ۸) اندازه‌ها و تمیزی ───────────────────────────────────────────────────
ok('قلمِ حجم درست است', formatMediaBytes(0) === '۰ بایت' && formatMediaBytes(3 * 1024 * 1024) === '۳٫۰ مگابایت', formatMediaBytes(3 * 1024 * 1024));

await clean();
const leftovers = await Promise.all([
  db.query(`SELECT count(*)::text n FROM store_banners WHERE title LIKE $1`, [`${MARK}%`]),
  db.query(`SELECT count(*)::text n FROM product_images WHERE alt = $1`, [MARK]),
  db.query(`SELECT count(*)::text n FROM store_settings WHERE key = $1`, [MEDIA_POLICY_KEYS.lastScan]),
  readdir(mediaDir),
]);
ok(
  'سنجه هیچ چیزی جا نگذاشت',
  leftovers[0].rows[0]!.n === '0' && leftovers[1].rows[0]!.n === '0' && (leftovers[2].rows[0]?.n ?? '0') === '0' && leftovers[3].length === 0,
  `بنر=${leftovers[0].rows[0]!.n} تصویر=${leftovers[1].rows[0]!.n} کش=${leftovers[2].rows[0]?.n ?? '-'} دیسک=${leftovers[3].length}`,
);
await rm(mediaDir, { recursive: true, force: true });
await db.close();

console.log(fails === 0 ? '\nهمهٔ سنجه‌هایِ رسانه رویِ PostgreSQLِ واقعی پاس شد.' : `\n${fails} سنجه شکست خورد.`);
if (fails > 0) process.exitCode = 1;
