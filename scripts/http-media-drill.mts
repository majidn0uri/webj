/**
 * سنجشِ HTTPِ «بهداشتِ رسانه» — از ورودِ مدیر تا فایلی که رویِ دیسک می‌ماند.
 *
 * چرا لایهٔ HTTP لازم است؟ چون آزمونِ واحد و سنجشِ پایانه، `mediaHygiene` را
 * مستقیم صدا می‌زنند. آنچه در سرویسِ واقعی می‌چرخد چیزهایِ دیگری‌اند:
 * multipartِ بارگذاری، `media.upload` در برابرِ `media.read`، کلمپِ `limit` در
 * zod، و این‌که ممیزیِ اجرایِ پاک‌سازی نباید نامِ فایل‌ها را نگه دارد. یک
 * بارگذاریِ واقعی هم تنها راهی است که ثابت کند «فایلِ بنر، همان فایلی است که
 * پاک‌سازی دید و برنداشت».
 *
 * اجرا:  API=https://… DB_URL=… MEDIA_DIR=… npx tsx scripts/http-media-drill.mts
 * (API باید بالا باشد. فایل‌هایِ آزمون با نشانه‌یِ alt=HTTPDRILL ساخته و در پایان
 * پاک می‌شوند؛ ردیف‌هایِ پایگاه هم همین‌طور.)
 */
import { execFileSync } from 'node:child_process';
import { mkdir, readdir, rm, stat, utimes } from 'node:fs/promises';
import path from 'node:path';

import sharp from 'sharp';

const API = process.env.API ?? 'http://127.0.0.1:3000';
const MEDIA = path.resolve(process.env.MEDIA_DIR ?? 'var/media');
const PSQL = process.env.PSQL ?? 'psql';
const DB = process.env.DB_URL!;
const MARK = 'HTTPDRILL';
const DAY = 86_400_000;
const ADMIN = { mobile: '09120000000', password: 'SetShop@1404' };
const SELLER = { mobile: '09120000001', password: 'SetShop@1404' };
const ACCOUNTANT = { mobile: '09120000003', password: 'SetShop@1404' };

let fails = 0;
const ok = (name: string, cond: boolean, extra = ''): void => {
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`);
  if (!cond) fails++;
};

function sql(q: string): string {
  return execFileSync(PSQL, [DB, '-Atc', q], { encoding: 'utf8' }).trim();
}

async function call(
  method: string,
  route: string,
  token?: string,
  body?: unknown,
  form?: FormData,
): Promise<{ status: number; json: any; text: string }> {
  const headers: Record<string, string> = {};
  if (token) headers.authorization = `Bearer ${token}`;
  if (body !== undefined) headers['content-type'] = 'application/json';
  const res = await fetch(`${API}${route}`, {
    method,
    headers,
    body: form ?? (body === undefined ? undefined : JSON.stringify(body)),
  });
  const text = await res.text();
  let json: any = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* بدنهٔ غیر JSON */
  }
  return { status: res.status, json, text };
}

/**
 * یک تصویرِ واقعیِ کوچک — بارگذاریِ «تصویرِ ساختگیِ نصفه» مسیرِ پردازش را
 * نمی‌گذراند.
 *
 * `tone` عمداً متفاوت است: نامِ فایل از **درنگِ محتوا** ساخته می‌شود و اگر دو
 * بارگذاری یک بایت یکسان بفرستند، هر دو به یک فایل می‌چسبند — و آن‌وقت
 * آزمونِ «این یکی رفت، آن یکی ماند» بی‌معنا می‌شود (همین‌طور است که در
 * فروشگاهِ واقعی دو کالایِ هم‌عکس، یک فایل را سه‌کاره‌اند).
 */
function tinyPng(tone: number): Promise<Buffer> {
  return sharp({
    create: { width: 24, height: 18, channels: 3, background: { r: 30 + tone * 9, g: 90, b: 200 - tone * 7 } },
  })
    .png()
    .toBuffer();
}

async function age(absolute: string, days: number): Promise<void> {
  const when = new Date(Date.now() - days * DAY);
  await utimes(absolute, when, when);
}

async function existsFile(url: string): Promise<boolean> {
  try {
    await stat(path.join(MEDIA, url.replace(/^\/media\//, '')));
    return true;
  } catch {
    return false;
  }
}

// ── ورودها ───────────────────────────────────────────────────────────────────
const admin = await call('POST', '/auth/login', undefined, ADMIN);
const token = String(admin.json?.accessToken ?? '');
ok('ورودِ مدیر', token.length > 20, `status=${admin.status}`);
const seller = await call('POST', '/auth/login', undefined, SELLER);
const sellerToken = String(seller.json?.accessToken ?? '');
ok('ورودِ فروشنده', sellerToken.length > 20, `status=${seller.status}`);
const acct = await call('POST', '/auth/login', undefined, ACCOUNTANT);
const acctToken = String(acct.json?.accessToken ?? '');
ok('ورودِ حسابدار (رسانه می‌خواند، پاک نمی‌کند)', acctToken.length > 20, `status=${acct.status}`);

// ── ۱) پیش‌نمایش و کش ────────────────────────────────────────────────────────
let preview = await call('GET', '/admin/media/cleanup?fresh=1', token);
ok('GET media/cleanup → ۲۰۰', preview.status === 200, `status=${preview.status} ${preview.text.slice(0, 90)}`);
ok('پاسخ سیاستِ پنل را می‌گوید', preview.json?.policy?.graceDays === 14, JSON.stringify(preview.json?.policy));
ok('پاسخ حالتِ گزارش است و چیزی پاک نکرده', preview.json?.mode === 'report' && preview.json?.removed === 0);
ok('بی‌توکن ۴۰۱', (await call('GET', '/admin/media/cleanup')).status === 401);
const cached = await call('GET', '/admin/media/cleanup', token);
ok('درخواستِ دوم از کش می‌آید (بی‌پویشِ دوبارهٔ دیسک)', cached.json?.cached === true, `cached=${cached.json?.cached}`);

// ── ۲) دو بارگذاریِ واقعی: یکی برایِ کالا، یکی برایِ بنر ────────────────────
const productId = sql(`SELECT id FROM products ORDER BY created_at LIMIT 1`);
ok('یک کالایِ واقعی برایِ آزمون هست', /^[0-9a-f-]{36}$/.test(productId), productId);
await mkdir(MEDIA, { recursive: true });

let tone = 0;
async function upload(kind: string): Promise<{ url: string; thumb: string; card: string }> {
  const form = new FormData();
  form.append('file', new Blob([await tinyPng(tone++)], { type: 'image/png' }), `${kind}-${MARK.toLowerCase()}.png`);
  const res = await call(
    'POST',
    `/admin/products/${productId}/images?alt=${MARK}`,
    token,
    undefined,
    form,
  );
  if (res.status >= 300) throw new Error(`upload ${res.status}: ${res.text.slice(0, 160)}`);
  return {
    url: String(res.json?.item?.url),
    thumb: String(res.json?.item?.urlThumb ?? ''),
    card: String(res.json?.item?.urlCard ?? ''),
  };
}

const productImage = await upload('case');
const bannerImage = await upload('banner');
ok('دو تصویر بارگذاری شد و فایلشان رویِ دیسک است', await existsFile(productImage.url), productImage.url);
sql(`UPDATE product_images SET created_at = now() - interval '60 days' WHERE alt = '${MARK}'`);

// فایل‌ها را کهنه می‌کنیم تا از پنجرهٔ اعتمادِ ۱۴روزه بگذرند (سناریویِ واقعی:
// چند ماه پس ازِ بارگذاری، حالا مدیر می‌خواهد بداند چه چیزی ول شده است)
const ourFiles = [productImage, bannerImage].flatMap((i) => [i.url, i.card, i.thumb]).filter(Boolean);
for (const rel of ourFiles) {
  await age(path.join(MEDIA, rel.replace('/media/', '')), 40);
}

// تصویرِ کالا از پایگاه جدا می‌شود → بی‌صاحب؛ تصویرِ بنر به store_banners می‌چسبد
// جداکردنِ یکی از دو تصویر: نقشش «main» نیست (کالا از کاتالوگِ نمونه
// تصویرِ اصلی دارد)، پس با alt پیدا می‌شود — و نتیجه را هم بررسی می‌کنیم،
// وگرنه «DELETE با نشانیِ خالی» ۴۰۴ می‌دهد و آزمون بی‌آن‌که چیزی جدا شده باشد
// «همه‌چیز درست است» می‌گوید.
const imageId = sql(`SELECT id FROM product_images WHERE alt='${MARK}' ORDER BY created_at LIMIT 1`);
ok('تصویرِ آزمون در پایگاه پیدا شد', /^[0-9a-f-]{36}$/.test(imageId), imageId);
const detached = await call('DELETE', `/admin/products/${productId}/images/${imageId}`, token);
ok('تصویر از کالا جدا شد', detached.status < 300, `status=${detached.status} ${detached.text.slice(0, 80)}`);
const banner = await call('POST', '/admin/banners', token, {
  kind: 'hero',
  title: `${MARK} banner`,
  imageUrl: bannerImage.url,
});
ok('بنرِ تازه با همان تصویر ساخته شد', banner.status < 300, `status=${banner.status} ${banner.text.slice(0, 90)}`);

// ── ۳) اجرایِ پاک‌سازی از پنل: جدا می‌رود، بنر می‌ماند ──────────────────────
const run = await call('POST', '/admin/media/cleanup', token, { limit: 500 });
ok('POST media/cleanup → ۲۰۰/۲۰۱', run.status < 300, `status=${run.status} ${run.text.slice(0, 120)}`);
ok('اجرا حالتِ run است', run.json?.mode === 'run', `mode=${run.json?.mode}`);
ok(
  'فایلِ جداشدهٔ کالا پاک شد (هر سه اندازه)',
  !(await existsFile(productImage.url)) &&
    !(await existsFile(productImage.card)) &&
    !(await existsFile(productImage.thumb)) &&
    run.json?.removed === 3,
  `removed=${run.json?.removed}`,
);
ok('فایلِ بنرِ در حالِ نمایش ماند (همان باگِ اصلی)', await existsFile(bannerImage.url));
ok('عددِ یادداشت‌ها فارسی است', !/[0-9]/.test((run.json?.notes ?? []).join(' ')), (run.json?.notes ?? [])[0] ?? '');

// ── ۴) ممیزی: فقط شمارش، بی‌نامِ فایل ──────────────────────────────────────
const auditRow = sql(`SELECT after_data::text FROM audit_logs WHERE action='media.cleanup_ran' ORDER BY created_at DESC LIMIT 1`);
ok('ممیزیِ اجرا نوشته شد', auditRow.includes('removed'), auditRow.slice(0, 110));
ok('ممیزی نامِ فایل/نشانی ندارد', !auditRow.includes('/media/'), '');
ok('ممیزی سیاست را هم نگه داشته تا قابلِ بازگویی باشد', auditRow.includes('graceDays'), '');

// ── ۵) اعتبارسنجی و دسترسی ──────────────────────────────────────────────────
ok('LIMITِ بی‌سقف رد می‌شود', (await call('POST', '/admin/media/cleanup', token, { limit: 99_999_999 })).status === 400);
ok('LIMITِ صفر رد می‌شود', (await call('POST', '/admin/media/cleanup', token, { limit: 0 })).status === 400);
ok('force بی‌منطقِ رشته‌ای رد می‌شود', (await call('POST', '/admin/media/cleanup', token, { force: 'آره' })).status === 400);
ok('فروشنده می‌تواند پاک‌سازی اجرا کند (media.upload دارد)', (await call('POST', '/admin/media/cleanup', sellerToken, { limit: 5 })).status < 300);
const denied = await call('POST', '/admin/media/cleanup', acctToken, { limit: 5 });
ok('حسابدار فقط خواندنی است: ۴۰۳', denied.status === 403, `status=${denied.status}`);
ok('حسابدار پیش‌نمایش را می‌بیند (media.read)', (await call('GET', '/admin/media/cleanup', acctToken)).status === 200);

// ── ۶) مهلتِ صفر از پنل: بی‌پویش، بی‌حذف ───────────────────────────────────
await call('PATCH', '/admin/settings', token, { values: { media_grace_days: '۰' } });
const off = await call('POST', '/admin/media/cleanup', token, { limit: 50 });
ok('با مهلتِ صفر چیزی پاک نشد', off.json?.removed === 0 && off.json?.files === 0, `files=${off.json?.files}`);
ok('و دلیلش را می‌گوید', String(off.json?.notes?.[0] ?? '').includes('هرگز پاک نشود'), off.json?.notes?.[0] ?? '');
await call('PATCH', '/admin/settings', token, { values: { media_grace_days: '۱۴' } });

// ── ۷) صفحهٔ پاک‌سازیِ کلی، رسانه را هم نشان می‌دهد ─────────────────────────
const obs = await call('GET', '/admin/observability/cleanup', token);
ok('cleanupِ دیدبانی بلوکِ رسانه دارد', !!obs.json?.media?.policy, JSON.stringify(obs.json?.media?.policy));
ok('و همان‌جا فقط پیش‌نمایش است (حذف نمی‌کند)', obs.json?.media?.mode === 'report', `mode=${obs.json?.media?.mode}`);
ok('اندازهٔ جدول‌ها هنوز می‌آید', Array.isArray(obs.json?.sizes) && obs.json.sizes.length === 4);

// ── ۸) خودپاک‌سازی و اثباتِ آن ──────────────────────────────────────────────
if (banner.json?.item?.id) await call('DELETE', `/admin/banners/${banner.json.item.id}`, token);
sql(`DELETE FROM store_banners WHERE title LIKE '${MARK}%'`);
sql(`DELETE FROM product_images WHERE alt = '${MARK}'`);
// آنچه آزمون ساخته باید پاک شود، even اگر پاک‌سازی نَبَرده باشد
for (const rel of ourFiles) await rm(path.join(MEDIA, rel.replace('/media/', '')), { force: true });
// پوشهٔ درنگ‌شدهٔ خودمان را هم برداریم؛ وگرنه سنجه «هیچی نذاشتم» دروغ می‌گوید
const ourDirs = [...new Set(ourFiles.map((f) => f.replace('/media/', '').split('/')[0] ?? ''))].filter((d) => d !== '');
for (const dir of ourDirs) await rm(path.join(MEDIA, dir), { recursive: true, force: true });
const dirsGone = (await Promise.all(ourDirs.map(async (d) => !(await existsFile(d))))).every(Boolean);
sql(`DELETE FROM audit_logs WHERE action = 'media.cleanup_ran'`);
sql(`DELETE FROM store_settings WHERE key = 'media_last_scan'`);
const leftovers = [
  sql(`SELECT count(*) FROM store_banners WHERE title LIKE '${MARK}%'`),
  sql(`SELECT count(*) FROM product_images WHERE alt = '${MARK}'`),
  sql(`SELECT count(*) FROM store_settings WHERE key = 'media_last_scan'`),
  sql(`SELECT value FROM store_settings WHERE key = 'media_grace_days'`),
  String((await readdir(MEDIA, { recursive: true }).catch(() => [])).length),
];
ok(
  'سنجه هیچ ردیف و فایلی جا نگذاشت',
  leftovers[0] === '0' &&
    leftovers[1] === '0' &&
    leftovers[2] === '0' &&
    leftovers[3] === '14' &&
    !(await existsFile(productImage.url)) &&
    !(await existsFile(bannerImage.url)) &&
    dirsGone,
  `بنر=${leftovers[0]} تصویر=${leftovers[1]} کش=${leftovers[2]} مهلت=${leftovers[3]} پوشه‌هایِ سنجه=${ourDirs.length} رفت=${dirsGone}`,
);
console.log(fails === 0 ? '\nهمهٔ سنجه‌هایِ HTTPِ رسانه پاس شد.' : `\n${fails} سنجه شکست خورد.`);
if (fails > 0) process.exitCode = 1;
