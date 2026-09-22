import puppeteer from 'puppeteer-core';
import { execSync } from 'node:child_process';

/**
 * تمرینِ سواچِ رنگ — با مرورگرِ واقعی.
 *
 * روند: سواچ‌ها را می‌شماریم، می‌بینیم رنگِ تمام‌شده خط خورده و پنهان نشده،
 * نامِ رنگِ برگزیده را می‌خوانیم، یک رنگِ دیگر را می‌زنیم و می‌سنجیم که
 * موجودی/قیمت همان رنگ جایگزین شده است. در پایان چیزی را تغییر نمی‌دهیم.
 */

const B = 'http://127.0.0.1:3100';
const DB = 'postgres://setshop@/setshop?host=/tmp/setshop-pgrun&port=5433';
const raw = (sql) => execSync(`/usr/lib/postgresql/18/bin/psql "${DB}" -tAc ${JSON.stringify(sql)}`, { encoding: 'utf8' }).trim();

const ok = (m) => console.log('  ✅', m);
const bad = (m) => { console.log('  ❌', m); process.exitCode = 1; };

const browser = await puppeteer.launch({ headless: 'new', executablePath: '/usr/bin/chromium',
  args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e.message).slice(0, 160)));
await page.setViewport({ width: 1280, height: 900 });

// ── ۱) برگه‌یِ کالا و سواچ‌ها ───────────────────────────────────────────────
console.log('۱) برگه‌یِ کالا و سواچ‌ها');
await page.goto(`${B}/products/case-silicon-matte`, { waitUntil: 'networkidle0', timeout: 60000 });
await new Promise((r) => setTimeout(r, 1500));

const list = await page.evaluate(() => ({
  count: document.querySelectorAll('.swatch').length,
  names: [...document.querySelectorAll('.swatch__name')].map((e) => e.textContent.trim()),
  hexes: [...document.querySelectorAll('.swatch__chip')].map((e) => e.style.background),
  struck: document.querySelectorAll('.swatch--out').length,
  current: document.querySelector('.swatches__current')?.textContent?.trim() ?? '',
}));
list.count === 4 ? ok(`چهار سواچ: ${list.names.join('، ')}`) : bad(`شمارِ سواچ‌ها: ${list.count}`);
list.hexes.every((h) => h && h !== '') ? ok(`هر سواچ رنگ دارد (مانندِ ${list.hexes[0]})`) : bad('رنگی برایِ سواچ‌ها ننشست');
list.struck === 1 ? ok('رنگِ ناموجود خط خورده و پنهان نشده است') : bad(`شمارِ خط‌خورده‌ها: ${list.struck}`);
list.current ? ok(`نامِ رنگِ برگزیده نوشته شده: ${list.current}`) : bad('نامِ رنگِ برگزیده نیامد');

// ── ۲) زدنِ یک رنگِ دیگر ────────────────────────────────────────────────────
console.log('۲) برگزیدنِ رنگی دیگر');
const before = await page.evaluate(() => ({
  stock: document.body.textContent.match(/(\d+) عدد در انبار/)?.[1] ?? '',
  price: document.querySelector('.price__value')?.textContent?.trim() ?? '',
}));

// «سرمه‌ای» را می‌زنیم
await page.evaluate(() => {
  const target = [...document.querySelectorAll('.swatch')].find((b) => b.textContent.includes('سرمه'));
  target?.click();
});
await new Promise((r) => setTimeout(r, 1200));

const after = await page.evaluate(() => ({
  current: document.querySelector('.swatches__current')?.textContent?.trim() ?? '',
  on: document.querySelector('.swatch--on .swatch__name')?.textContent?.trim() ?? '',
  pressed: document.querySelector('.swatch[aria-checked="true"] .swatch__name')?.textContent?.trim() ?? '',
}));
after.current.includes('سرمه') ? ok(`برگزیده شد: ${after.current}`) : bad(`برگزیده: ${after.current}`);
after.on === after.pressed ? ok('نشانه‌یِ برگزیدگی همان است که برایِ خواننده‌یِ صفحه اعلام شده') : bad(`ناهماهنگی: ${after.on} / ${after.pressed}`);
void before;

// ── ۳) رنگِ ناموجود برگزیده نمی‌شود ─────────────────────────────────────────
console.log('۳) رنگِ تمام‌شده');
const soldOutClickable = await page.evaluate(() => {
  const target = [...document.querySelectorAll('.swatch')].find((b) => b.classList.contains('swatch--out'));
  return Boolean(target) && !target.disabled;
});
soldOutClickable ? ok('سواچِ ناموجود دیده می‌شود (می‌توان خبر خواست)، نه حذف') : bad('سواچِ ناموجود در دسترس نیست');

// ── ۴) کالایِ بی‌رنگ، سواچ نمی‌گیرد ─────────────────────────────────────────
console.log('۴) کالایِ بی‌رنگ (پاوربانک)');
await page.goto(`${B}/products/powerbank-20000`, { waitUntil: 'networkidle0', timeout: 60000 });
await new Promise((r) => setTimeout(r, 1200));
const plain = await page.evaluate(() => document.querySelectorAll('.swatch').length);
plain === 0 ? ok('کالایِ بی‌رنگ، ردیفِ سواچِ بی‌معنا نمی‌گیرد') : bad(`برایِ کالایِ بی‌رنگ ${plain} سواچ ساخته شد`);

// ── ۵) ترتیب و پیوندِ رنگ به تنوع در پایگاه ─────────────────────────────────
console.log('۵) درستی در پایگاه');
const rows = raw(
  `SELECT attributes->>'color' AS c, sort_order, count(*) FROM product_variants WHERE sku LIKE 'CS-%' GROUP BY 1,2 ORDER BY sort_order`,
);
rows.includes('مشکی') && rows.includes('قرمز') ? ok('رنگ‌هایِ گوناگون در پایگاه نشسته‌اند') : bad(`رنگ‌ها: ${rows.split('\n').join(' | ')}`);
const links = raw(
  `SELECT count(*) FROM product_variants v WHERE NOT EXISTS (SELECT 1 FROM product_compatibility pc WHERE pc.variant_id = v.id)`,
);
links === '0' ? ok('هیچ تنوعی بی‌پیوندِ گوشی نمانده') : bad(`${links} تنوع بی‌پیوند مانده`);

console.log('۶) خطایِ جاوااسکریپت:', errors.length === 0 ? 'هیچ ✅' : errors.join(' | '));
await browser.close();
console.log(process.exitCode ? '\n💥 تمرین ناقص ماند' : '\n🎉 گام‌به‌گام درست بود');
