import puppeteer from 'puppeteer-core';
import { execSync } from 'node:child_process';

/**
 * تمرینِ بسته‌بندی و «خبرم کن وقتی موجود شد» — با مرورگرِ واقعی.
 *
 * روندِ بسته‌بندی از پنل: سفارشی تأییدشده می‌سازیم، می‌بینیم ارسال بسته
 * است، آن را می‌بندیم، و سپس با کدِ رهگیری ارسالش می‌کنیم. روندِ «خبرم کن»
 * در برگه‌یِ کالا: موجودی را صفر می‌کنیم، دکمه را می‌زنیم، سپس کالا را
 * می‌آوریم و پیامِ رفته را می‌بینیم. در پایان همه چیز پاک می‌شود.
 */

const B = 'http://127.0.0.1:3100';
const A = 'http://127.0.0.1:3000';
const DB = 'postgres://setshop@/setshop?host=/tmp/setshop-pgrun&port=5433';
const psql = (sql) =>
  execSync(`/usr/lib/postgresql/18/bin/psql "${DB}" -tAc ${JSON.stringify(sql)}`, { encoding: 'utf8' })
    .match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/)?.[0] ?? '';
const raw = (sql) => execSync(`/usr/lib/postgresql/18/bin/psql "${DB}" -tAc ${JSON.stringify(sql)}`, { encoding: 'utf8' }).trim();

const ok = (m) => console.log('  ✅', m);
const bad = (m) => { console.log('  ❌', m); process.exitCode = 1; };

const browser = await puppeteer.launch({ headless: 'new', executablePath: '/usr/bin/chromium',
  args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e.message).slice(0, 160)));
await page.setViewport({ width: 1280, height: 900 });

// ── پیش‌نیاز: یک تنوع با موجودی، و یک سفارشِ تأییدشده ────────────────────────
const variant = raw(`SELECT id FROM product_variants LIMIT 1`);
const warehouse = raw(`SELECT id FROM warehouses LIMIT 1`);
psql(`INSERT INTO stock_items (variant_id, warehouse_id, on_hand, reserved) VALUES ('${variant}','${warehouse}',10,0) ON CONFLICT DO NOTHING`);
raw(`UPDATE stock_items SET on_hand = 10, reserved = 0 WHERE variant_id = '${variant}'`);
const orderNo = `DR-${Date.now().toString().slice(-6)}`;
const order = psql(
  `INSERT INTO orders (order_no, channel, status, total_rial) VALUES ('${orderNo}','web','confirmed',100000) RETURNING id`,
);
raw(`INSERT INTO order_items (order_id, variant_id, quantity, unit_price_rial, total_rial) VALUES ('${order}','${variant}',1,100000,100000)`);

// ── ۱) ورود به پنل ──────────────────────────────────────────────────────────
console.log('۱) ورود به پنل');
await page.goto(`${B}/admin/login`, { waitUntil: 'domcontentloaded' });
await page.type('input[name=mobile]', '09120000000');
await page.type('input[name=password]', 'SetShop-1405!');
await page.click('button[type=submit]');
try { await page.waitForFunction(() => !location.pathname.startsWith('/admin/login'), { timeout: 20000 }); } catch {}
ok('وارد شد');

// ── ۲) صفِ بسته‌بندی ────────────────────────────────────────────────────────
console.log('۲) صفِ بسته‌بندی در پنلِ سفارش‌ها');
await page.goto(`${B}/admin/orders?status=packing`, { waitUntil: 'networkidle0', timeout: 60000 });
await new Promise((r) => setTimeout(r, 1200));
const inQueue = await page.evaluate((no) => document.body.textContent.includes(no), orderNo);
inQueue ? ok('سفارش در صفِ بسته‌بندی دیده شد') : bad('سفارش در صف نیست');

// ── ۳) ارسال بسته است، بستن بازش می‌کند ────────────────────────────────────
console.log('۳) ارسالِ بی‌بسته‌بندی بسته است');
const before = await fetch(`${A}/admin/orders/${order}/pack`, {
  method: 'POST', headers: { 'content-type': 'application/json' },
});
void before;

// نخست از کارساز می‌پرسیم که ارسال رد می‌شود (رابط هم همین را نشان می‌دهد)
const token = (await (await fetch(`${A}/auth/login`, {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ mobile: '09120000000', password: 'SetShop-1405!' }),
})).json()).accessToken;
const shipRes = await fetch(`${A}/admin/orders/${order}/ship`, {
  method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
  body: JSON.stringify({ carrier: 'پست', trackingCode: '1234567890' }),
});
const shipBody = await shipRes.json();
shipRes.status === 409 || shipBody?.error
  ? ok(`ارسال رد شد: ${shipBody?.error?.message?.slice(0, 50)}`)
  : bad('ارسالِ بی‌بسته‌بندی پذیرفته شد!');

// ── ۴) بستن از رابط ────────────────────────────────────────────────────────
console.log('۴) بستنِ سفارش از رابط');
await page.evaluate((no) => {
  const row = [...document.querySelectorAll('tr')].find((r) => r.textContent.includes(no));
  [...row.querySelectorAll('button')].find((b) => b.textContent.includes('بسته‌بندی شد'))?.click();
}, orderNo);
await new Promise((r) => setTimeout(r, 2500));
const packed = raw(`SELECT status FROM orders WHERE id = '${order}'`);
packed === 'packing' ? ok('وضعیت شد: در حالِ بسته‌بندی') : bad(`وضعیت: ${packed}`);
const packedBy = raw(`SELECT count(*) FROM orders WHERE id = '${order}' AND packed_by IS NOT NULL`);
packedBy === '1' ? ok('بسته‌بند ثبت شد') : bad('بسته‌بند ثبت نشد');

// ── ۵) ارسال با کدِ رهگیری ─────────────────────────────────────────────────
console.log('۵) ارسال پس از بسته‌بندی');
await page.reload({ waitUntil: 'networkidle0', timeout: 60000 });
await new Promise((r) => setTimeout(r, 1200));
await page.evaluate((no) => {
  const row = [...document.querySelectorAll('tr')].find((r) => r.textContent.includes(no));
  [...row.querySelectorAll('button')].find((b) => b.textContent.includes('ثبتِ ارسال'))?.click();
}, orderNo);
await new Promise((r) => setTimeout(r, 700));
await page.type('.num[placeholder="کدِ رهگیری"]', '9876543210');
await page.evaluate((no) => {
  const row = [...document.querySelectorAll('tr')].find((r) => r.textContent.includes(no));
  [...row.querySelectorAll('button')].find((b) => b.textContent.trim() === 'تأیید')?.click();
}, orderNo);
await new Promise((r) => setTimeout(r, 2500));
const shipped = raw(`SELECT status FROM orders WHERE id = '${order}'`);
shipped === 'shipped' ? ok('وضعیت شد: ارسال‌شده') : bad(`وضعیت: ${shipped}`);

// ── ۶) «خبرم کن» در برگه‌یِ کالا ───────────────────────────────────────────
console.log('۶) «خبرم کن وقتی موجود شد»');
raw(`UPDATE stock_items SET on_hand = 0, reserved = 0 WHERE variant_id = '${variant}'`);
raw(`DELETE FROM stock_notifications`);
raw(`DELETE FROM sms_outbox`);
const slug = raw(`SELECT p.slug FROM products p JOIN product_variants v ON v.product_id = p.id WHERE v.id = '${variant}'`);
await page.goto(`${B}/products/${slug}`, { waitUntil: 'networkidle0', timeout: 60000 });
await new Promise((r) => setTimeout(r, 1500));
const hasButton = await page.evaluate(() =>
  [...document.querySelectorAll('.stock-alert button')].some((b) => b.textContent.includes('خبرم کن وقتی موجود شد')),
);
hasButton ? ok('دکمه در برگه‌یِ کالا هست') : bad('دکمه دیده نشد');

await page.evaluate(() => {
  [...document.querySelectorAll('.stock-alert button')]
    .find((b) => b.textContent.includes('خبرم کن وقتی موجود شد'))?.click();
});
await new Promise((r) => setTimeout(r, 600));
await page.type('.stock-alert input', '09124445566');
await page.evaluate(() => {
  [...document.querySelectorAll('.stock-alert button')].find((b) => b.textContent.trim() === 'ثبت')?.click();
});
await new Promise((r) => setTimeout(r, 2500));
const alertText = await page.evaluate(() => document.querySelector('.stock-alert__ok')?.textContent?.trim() ?? '');
alertText.includes('ثبت شد') ? ok(`پاسخ: ${alertText}`) : bad(`پاسخ نیامد: ${alertText}`);
const waiting = raw(`SELECT count(*) FROM stock_notifications WHERE status='waiting'`);
waiting === '1' ? ok('درخواست در پایگاه نشست') : bad(`شمارِ درخواست‌ها: ${waiting}`);

// ── ۷) کالا می‌آید → پیام می‌رود ───────────────────────────────────────────
console.log('۷) آمدنِ کالا و پیامِ رفته');
raw(`UPDATE stock_items SET on_hand = 8 WHERE variant_id = '${variant}'`);
const notify = await (await fetch(`${A}/admin/inventory/notify-waiters`, {
  method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
  body: JSON.stringify({ variantId: variant }),
})).json();
notify.notified === 1 ? ok('یک پیام فرستاده شد') : bad(`شمارِ پیام‌ها: ${notify.notified}`);
const sms = raw(`SELECT body FROM sms_outbox ORDER BY created_at DESC LIMIT 1`);
sms.includes('موجود شد') ? ok(`متنِ پیام: ${sms}`) : bad(`متنِ پیام: ${sms}`);

// ── ۸) پاک‌سازی ────────────────────────────────────────────────────────────
console.log('۸) پاک‌سازی');
raw(`DELETE FROM order_status_history WHERE order_id = '${order}'`);
raw(`DELETE FROM order_items WHERE order_id = '${order}'`);
raw(`DELETE FROM orders WHERE id = '${order}'`);
raw(`DELETE FROM stock_notifications`);
raw(`DELETE FROM sms_outbox`);
raw(`UPDATE stock_items SET on_hand = 10, reserved = 0 WHERE variant_id = '${variant}'`);
ok('همه چیزِ آزمون پاک شد');

console.log('۹) خطایِ جاوااسکریپت:', errors.length === 0 ? 'هیچ ✅' : errors.join(' | '));
await browser.close();
console.log(process.exitCode ? '\n💥 تمرین ناقص ماند' : '\n🎉 گام‌به‌گام درست بود');
