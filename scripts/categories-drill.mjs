import puppeteer from 'puppeteer-core';
import { execSync } from 'node:child_process';

/**
 * تمرینِ درختِ دسته‌بندی — با مرورگرِ واقعی.
 *
 * روند: منو را از درخت می‌خوانیم، واردِ یک دسته می‌شویم، در پنل زیردسته‌ای
 * می‌سازیم و جابه‌جایش می‌کنیم، و در پایان آنچه ساختیم پاک می‌کنیم تا
 * درختِ فروشگاه همان بماند که بود.
 */

const B = 'http://127.0.0.1:3100';
const DB = 'postgres://setshop@/setshop?host=/tmp/setshop-pgrun&port=5433';
const psql = (sql) =>
  execSync(`/usr/lib/postgresql/18/bin/psql "${DB}" -tAc ${JSON.stringify(sql)}`, { encoding: 'utf8' })
    .match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/)?.[0] ?? '';

const ok = (m) => console.log('  ✅', m);
const bad = (m) => { console.log('  ❌', m); process.exitCode = 1; };

const browser = await puppeteer.launch({ headless: 'new', executablePath: '/usr/bin/chromium',
  args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e.message).slice(0, 160)));
await page.setViewport({ width: 1280, height: 900 }); // منویِ آبشاری رویِ موبایل پنهان است

// ── ۱) منو از درخت ──────────────────────────────────────────────────────────
console.log('۱) منویِ آبشاری از درخت');
await page.goto(`${B}/`, { waitUntil: 'networkidle0', timeout: 60000 });
await new Promise((r) => setTimeout(r, 1200));
await page.evaluate(() => document.querySelector('.navlink--cats')?.click());
await new Promise((r) => setTimeout(r, 700));
const menu = await page.evaluate(() => ({
  roots: [...document.querySelectorAll('.mega__link--root')].map((e) => e.textContent.trim()),
  subs: [...document.querySelectorAll('.mega__link--sub')].map((e) => e.textContent.trim()),
}));
menu.roots.length >= 5 ? ok(`منو ${menu.roots.length} دسته‌یِ ریشه دارد`) : bad(`منو تهی است: ${JSON.stringify(menu)}`);
menu.subs.length > 0 ? ok(`زیردسته‌ها هم در منو هستند (${menu.subs.length})`) : bad('زیردسته‌ها در منو نیستند');

// ── ۲) برگه‌یِ دسته ─────────────────────────────────────────────────────────
console.log('۲) برگه‌یِ دسته');
await page.goto(`${B}/c/charger`, { waitUntil: 'networkidle0', timeout: 60000 });
await new Promise((r) => setTimeout(r, 1000));
const page1 = await page.evaluate(() => ({
  title: document.querySelector('.cathead__title')?.textContent.trim(),
  crumbs: document.querySelectorAll('.crumbs__item, .crumbs__current').length,
  subcats: [...document.querySelectorAll('.subcat__name')].map((e) => e.textContent.trim()),
  cards: document.querySelectorAll('.card-p').length,
}));
page1.title?.includes('شارژر') ? ok(`برگه آمد: ${page1.title}`) : bad(`برگه درست نیامد: ${page1.title}`);
page1.crumbs >= 2 ? ok(`نانِ راهنما دارد (${page1.crumbs} بخش)`) : bad('نانِ راهنما نیامد');
page1.subcats.length === 3 ? ok(`زیردسته‌ها: ${page1.subcats.join('، ')}`) : bad(`زیردسته‌ها: ${JSON.stringify(page1.subcats)}`);
// کالاهایِ زیردسته‌ها هم باید بیایند
page1.cards >= 1 ? ok(`کالایِ درونِ زیردسته در برگه‌یِ پدر آمد (${page1.cards} کارت)`) : bad('کالایِ زیردسته در برگه‌یِ پدر نیامد');

// ── ۳) نانِ راهنما در صفحه‌یِ کالا ──────────────────────────────────────────
console.log('۳) نانِ راهنما در صفحه‌یِ کالا');
await page.goto(`${B}/products/charger-20w-typec`, { waitUntil: 'networkidle0', timeout: 60000 });
await new Promise((r) => setTimeout(r, 1000));
const crumb = await page.evaluate(() =>
  [...document.querySelectorAll('.crumbs__item, .crumbs__current')].map((e) => e.textContent.trim()).join(' › '),
);
crumb.includes('شارژر') ? ok(`مسیرِ کالا: ${crumb}`) : bad(`مسیرِ کالا نیامد: ${crumb}`);

// ── ۴) پنل: ساخت، جابه‌جایی، حذف ───────────────────────────────────────────
console.log('۴) پنل: ساخت و جابه‌جایی');
await page.goto(`${B}/admin/login`, { waitUntil: 'domcontentloaded' });
await page.type('input[name=mobile]', '09120000000');
await page.type('input[name=password]', 'SetShop-1405!');
await page.click('button[type=submit]');
try { await page.waitForFunction(() => !location.pathname.startsWith('/admin/login'), { timeout: 20000 }); } catch {}
await page.goto(`${B}/admin/categories`, { waitUntil: 'networkidle0', timeout: 60000 });
await new Promise((r) => setTimeout(r, 1500));
const rows = await page.evaluate(() => document.querySelectorAll('.ctree__row').length);
rows >= 18 ? ok(`${rows} دسته در درختِ پنل`) : bad(`تنها ${rows} دسته دیده شد`);

// ساختِ یک دسته‌یِ تازه زیرِ «شارژر و آداپتور»
const chargerId = psql(`SELECT id FROM product_types WHERE key = 'charger'`);
const name = `دسته‌ی آزمون ${Date.now().toString().slice(-5)}`;
await page.type('.card input.field__input', name);
await page.select('.card select.field__input', chargerId);
await page.evaluate(() => {
  [...document.querySelectorAll('.card button')].find((b) => b.textContent.trim() === 'ساختن')?.click();
});
await new Promise((r) => setTimeout(r, 2500));
const created = await page.evaluate((t) => document.body.textContent.includes(t), name);
created ? ok('دسته‌یِ تازه در درخت آمد') : bad('دسته ساخته نشد');

// جابه‌جایی به زیرِ «کابل و مبدل»
const newId = psql(`SELECT id FROM product_types WHERE name = '${name}'`);
const cableId = psql(`SELECT id FROM product_types WHERE key = 'cable'`);
await page.evaluate((t) => {
  const row = [...document.querySelectorAll('.ctree__row')].find((r) => r.textContent.includes(t));
  [...row.querySelectorAll('button')].find((b) => b.textContent.includes('جابه‌جایی'))?.click();
}, name);
await new Promise((r) => setTimeout(r, 800));
await page.select('.field__input[class*="field__input"]:not([type]) , select.field__input', cableId).catch(() => {});
const selects = await page.$$('select.field__input');
if (selects.length > 1) await selects[selects.length - 1].select(cableId);
await new Promise((r) => setTimeout(r, 400));
await page.evaluate((t) => {
  const row = [...document.querySelectorAll('.ctree__row')].find((r) => r.textContent.includes(t));
  [...row.querySelectorAll('button')].find((b) => b.textContent.includes('جابه‌جا کن'))?.click();
}, name);
await new Promise((r) => setTimeout(r, 2500));
const movedPath = psql(`SELECT path FROM product_types WHERE name = '${name}'`);
const movedOk = String(psql(`SELECT parent_id FROM product_types WHERE name = '${name}'`)) === cableId;
movedOk ? ok(`جابه‌جا شد (مسیرِ تازه درست شد)`) : bad(`جابه‌جایی نادرست؛ مسیر: ${movedPath}`);

// ── ۵) حذف با مقصد ─────────────────────────────────────────────────────────
console.log('۵) حذف');
await page.evaluate((t) => {
  const row = [...document.querySelectorAll('.ctree__row')].find((r) => r.textContent.includes(t));
  [...row.querySelectorAll('button')].find((b) => b.textContent.trim() === 'حذف')?.click();
}, name);
await new Promise((r) => setTimeout(r, 900));
await page.evaluate((t) => {
  const card = [...document.querySelectorAll('.card')].find((c) => c.textContent.includes(`حذفِ «${t}»`));
  [...card.querySelectorAll('button')].find((b) => b.textContent.trim() === 'حذف')?.click();
}, name);
await new Promise((r) => setTimeout(r, 2500));
const stillThere = await page.evaluate((t) => document.body.textContent.includes(t), name);
!stillThere ? ok('دسته پاک شد') : bad('دسته پاک نشد');

// ── ۶) پاک‌سازیِ پایگاه ─────────────────────────────────────────────────────
const leftover = psql(`SELECT id FROM product_types WHERE name = '${name}'`);
if (leftover) psql(`DELETE FROM product_types WHERE id = '${leftover}'`);

console.log('۶) خطایِ جاوااسکریپت:', errors.length === 0 ? 'هیچ ✅' : errors.join(' | '));
await browser.close();
console.log(process.exitCode ? '\n💥 تمرین ناقص ماند' : '\n🎉 گام‌به‌گام درست بود');
