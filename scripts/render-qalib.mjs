#!/usr/bin/env node
/**
 * قالبِ سایت — یک پروندهٔ HTMLِ خودکفا که از رویِ **کدِ زنده** تولید می‌شود.
 *
 * چرا این ابزار؟
 *   «قالب سایت را به‌صورت HTML بده که با هر تغییری تازه بماند» — یعنی:
 *   ۱. یک پروندهٔ واحد که هویتِ بصریِ فعلی را نشان می‌دهد (فونت، رنگ،
 *      فاصله، شعاع، سایه، هر جزء، و یک تکهٔ ویترینِ واقعی) — بی‌آنکه کسی
 *      دستی آن را بنویسد و کهنه شود؛
 *   ۲. تازه‌ماندنِ خودکار: همهٔ مقادیر از پرونده‌هایِ CSS که سایت
 *      با آن‌ها رندر می‌شود خوانده می‌شوند (نه کپیِ دستی)؛ و CI با
 *      `npm run template:check` نگهبانی می‌دهد — اگر کسی طراحی را عوض کند
 *      و قالب را بازتولید نکند، زنجیرهٔ کیفیت **قرمز** می‌شود.
 *
 * بی‌هیچ وابستگیِ خارجی (قاعدهٔ «فقط ایران»): فونت‌ها و تصویرهایِ کالا به‌صورت
 * data-URI **داخلِ همان پرونده** می‌نشینند؛ پرونده را به هر جایی ببری، درست
 * دیده می‌شود، بی‌اینترنت و بی‌CDN.
 *
 * اجرا:
 *   npm run template          # بازتولیدِ docs/qalib.html
 *   npm run template:check    # فقط بررسی (CI): کهنه باشد → خروجِ ۱
 */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'docs', 'qalib.html');
const GEN_VERSION = 2;

/* ── پرونده‌هایِ سرچشمه (هر کدام با هَش در سربرگِ خروجی ثبت می‌شود) ────── */
const STOREFRONT_CSS = join(ROOT, 'apps/web/src/app/storefront.css');
const GLOBALS_CSS = join(ROOT, 'apps/web/src/app/globals.css');
const PREMIUM_CSS = join(ROOT, 'apps/web/src/app/premium.css');
const ACCOUNT_CSS = join(ROOT, 'apps/web/src/app/account.css');
const FONTS = [
  { name: 'Regular', weight: 400, file: join(ROOT, 'apps/web/public/fonts/Vazirmatn-Regular.woff2') },
  { name: 'Medium', weight: 500, file: join(ROOT, 'apps/web/public/fonts/Vazirmatn-Medium.woff2') },
  { name: 'Bold', weight: 700, file: join(ROOT, 'apps/web/public/fonts/Vazirmatn-Bold.woff2') },
];
/** تصویرهایِ کالاهایِ نمونه — همان پنج عکسی که در ویترینِ واقعی است */
const PHOTOS = [
  'charger-20w-typec.jpg',
  'case-silicon-matte.jpg',
  'powerbank-20000.jpg',
  'cable-typec-1m.jpg',
  'glass-ceramic-9h.jpg',
].map((f) => join(ROOT, 'apps/web/public/products', f));

/* ── محتوایِ نمونهٔ کارت‌ها (دادهٔ کاتالوگِ نمونه؛ قالب، مرجعِ طراحی است) ─ */
const PRODUCTS = [
  { img: 0, title: 'شارژر دیواری ۲۰ وات با کابل تایپ‌سی', brand: 'بیسوس', price: '۳۲٬۰۰', off: null, stock: 'موجود', new: true },
  { img: 1, title: 'قاب سیلیکونی مات با محافظ دوربین', brand: 'نیلکین', price: '۲۲۰۰۰۰', off: null, stock: 'موجود', new: false },
  { img: 2, title: 'پاوربانک ۲۰٬۰۰ میلی‌آمپر ۲۲٫۵ وات', brand: 'انکر', price: '۱٬۲۵۰٬۰۰۰', off: '۲۰٪', old: '۱٬۵۶۲٬۵۰۰', stock: 'تنها ۳ عدد مانده', new: false },
  { img: 3, title: 'کابل بافته‌شده تایپ‌سی ۱ متری', brand: 'یوگرین', price: '۱۱۰٬۰۰۰', off: null, stock: 'موجود', new: false },
  { img: 4, title: 'گلس سرامیکی ۹H دو عددی', brand: 'ریمکس', price: '۸۹٬۰۰۰', off: null, stock: 'ناموجود', new: false },
];

/* ── ابزارها ──────────────────────────────────────────────────────────── */
const sha12 = (buf) => createHash('sha256').update(buf).digest('hex').slice(0, 12);
const b64 = (buf) => buf.toString('base64');

/**
 * برشِ CSS به قطعاتِ سطحِ بالا (قاعده/کامنت/استوری) با شمارشِ آکولاد.
 * پرونده‌هایِ این پروژه CSSِ تخت دارند؛ این برش فقط برایِ انتخابِ
 * بخشی از globals.css لازم است — storefront.css **کامل** کپی می‌شود.
 */
function cssSegments(css) {
  const out = [];
  let i = 0;
  while (i < css.length) {
    const ch = css[i];
    if (ch === '/' && css[i + 1] === '*') {
      const end = css.indexOf('*/', i + 2);
      const stop = end === -1 ? css.length : end + 2;
      out.push(css.slice(i, stop));
      i = stop;
    } else if (ch === '@') {
      const open = css.indexOf('{', i);
      if (open === -1) break;
      let depth = 1;
      let j = open + 1;
      while (j < css.length && depth > 0) {
        if (css[j] === '{') depth += 1;
        else if (css[j] === '}') depth -= 1;
        j += 1;
      }
      out.push(css.slice(i, j));
      i = j;
    } else {
      const open = css.indexOf('{', i);
      if (open === -1) break;
      let depth = 1;
      let j = open + 1;
      while (j < css.length && depth > 0) {
        if (css[j] === '{') depth += 1;
        else if (css[j] === '}') depth -= 1;
        j += 1;
      }
      out.push(css.slice(i, j));
      i = j;
    }
  }
  return out;
}

/** انتخابِ بخش‌هایی از globals.css که «لایهٔ اجزا» را می‌سازد (بقیه، مخصوصِ پنل است) */
function pickGlobals(css) {
  const keep = (seg) => {
    const head = seg.split('{')[0] ?? '';
    const prefixes = [
      ':root', '*', 'html', 'body', 'a ', 'button', ':focus-visible',
      '.page', '.btn', '.actions', '.grow', '.badge', '.card', '.num',
      '.field', '.alert', '.table',
    ];
    return prefixes.some((p) => head.trim().startsWith(p));
  };
  return cssSegments(css).filter(keep).join('\n\n');
}

/** متغیرهایِ `--x: value` از یک بلوکِ :root — خودِ آن‌ها در خروجی نمایش داده می‌شوند */
function tokensOf(rootBlock) {
  const map = new Map();
  for (const m of rootBlock.matchAll(/(--[A-Za-z0-9-]+)\s*:\s*([^;]+);/g)) map.set(m[1], m[2].trim());
  return map;
}

/* ── بارگذاریِ ورودی‌ها ───────────────────────────────────────────────── */
const read = (p) => {
  if (!existsSync(p)) {
    console.error(`✗ پروندهٔ سرچشمه پیدا نشد: ${p}`);
    process.exit(2);
  }
  return readFileSync(p);
};

const storefrontCss = read(STOREFRONT_CSS).toString('utf8');
const globalsCss = read(GLOBALS_CSS).toString('utf8');
const fontBufs = FONTS.map((f) => read(f.file));
const photoBufs = PHOTOS.map((f) => read(f));

const inputs = [
  ['storefront.css', read(STOREFRONT_CSS)],
  ['globals.css', read(GLOBALS_CSS)],
  ['premium.css', read(PREMIUM_CSS)],
  ['account.css', read(ACCOUNT_CSS)],
  ...FONTS.map((f) => [`fonts/${f.name}.woff2`, read(f.file)]),
  ...PHOTOS.map((f) => [`products/${f.split('/').pop()}`, read(f)]),
];

/* ── CSSِ خروجی ───────────────────────────────────────────────────────── */
// @font-face با data-URI — همان سه وزنِ خودمیزبانِ سایت، ولی داخلِ پرونده
const fontFace = FONTS.map(
  (f, k) =>
    `@font-face {\n  font-family: 'Vazirmatn';\n  src: url('data:font/woff2;base64,${b64(fontBufs[k])}') format('woff2');\n  font-weight: ${f.weight};\n  font-display: swap;\n}`,
).join('\n');

// globals: فقط لایهٔ توکن‌ها + اجزای مشترک (دکمه، نشان، کارت، فرم، جدول)
const globalsSubset = pickGlobals(globalsCss);

// storefront.css **کامل** — چون ویترینِ واقعی با همین قواعد رندر می‌شود
const storefrontCssAll = storefrontCss;

/* ── بخش‌هایِ «مرجعِ طراحی» (از رویِ همان توکن‌ها ساخته می‌شوند) ─────── */
const stRoot = storefrontCss.match(/:root\s*\{[^}]*\}/)?.[0] ?? '';
const glRoot = globalsCss.match(/:root\s*\{[^}]*\}/)?.[0] ?? '';
const stTokens = tokensOf(stRoot);
const glTokens = tokensOf(glRoot);

const isColor = (v) => /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(v.trim());
const toFa = (s) => String(s).replace(/[0-9]/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[d]).replace(/,/g, '٬');

function swatchGrid(tokens, title) {
  const rows = [...tokens.entries()]
    .filter(([, v]) => isColor(v))
    .map(([k, v]) => {
      const light = /#(f|F|e|E)/.test(v) && v.length <= 7;
      return `<div class="sw"><span class="sw__chip" style="background:${v};${light ? 'border:1px solid var(--st-200)' : ''}"></span><b>${k}</b><code class="num">${v}</code></div>`;
    })
    .join('\n');
  return `<h3 class="ref__h">${title}</h3>\n<div class="swg">\n${rows}\n</div>`;
}

const spaceScale = [...stTokens.entries()]
  .filter(([k]) => /^--st-[1-9]$/.test(k))
  .map(([k, v]) => `<div class="sp"><i style="width:${v}"></i><b class="num">${v}</b></div>`)
  .join('');

const radiusScale = [...stTokens.entries()]
  .filter(([k]) => k.startsWith('--st-r-'))
  .map(([k, v]) => `<div class="rd"><i style="border-radius:${v}"></i><b>${k}</b><code class="num">${v}</code></div>`)
  .join('');

const shadowScale = [...stTokens.entries()]
  .filter(([k]) => k.startsWith('--st-shadow'))
  .map(([k, v]) => `<div class="sh"><i style="box-shadow:${v}"></i><b>${k}</b></div>`)
  .join('');

const typeScale = [
  ['--st-* (سنت‌شاپ)', '1.15rem', 'متنِ کمکی'],
  ['1.3rem', 'عنوانِ کارت'],
  ['1.5rem', 'زیرعنوان'],
  ['2rem', 'عنوانِ بخش'],
  ['3.2rem', 'عنوانِ اصلی (هیرو)'],
].map(([size, use]) => `<div class="ty"><span style="font-size:${size}">${use}</span><code class="num">${size}</code></div>`).join('');

/* ── ویترینِ نمونه (با کلاس‌هایِ واقعی و دادهٔ نمونه) ────────────────── */
const productCard = (p, i) => `
    <div class="card-p">
      ${p.off ? `<span class="card-p__badge">${p.off}</span>` : ''}${p.new ? `<span class="tag tag--ok" style="position:absolute;top:8px;left:8px">جدید</span>` : ''}
      <div class="card-p__media"><img class="card-p__img" src="data:image/jpeg;base64,${b64(photoBufs[p.img])}" alt="${p.title}" width="400" height="400"></div>
      <button type="button" class="card-p__qv" aria-label="نمایشِ سریع" style="opacity:1"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg></button>
      <div class="card-p__body">
        <div class="card-p__title">${p.title}</div>
        <div class="card-p__meta">${p.brand}</div>
        <div class="card-p__foot">
          <div class="price"><span class="price__value num">${p.price}</span><span class="price__unit">تومان</span>${p.old ? `<span class="price__old num">${p.old}</span>` : ''}</div>
          <span class="card-p__stock ${p.stock === 'ناموجود' ? 'is-out' : p.stock.startsWith('تنها') ? 'is-low' : 'is-in'}">${p.stock}</span>
        </div>
      </div>
    </div>`;

const demoHeader = `
  <div class="hdr">
    <div class="container-x hdr__row">
      <a class="hdr__logo" href="#"><span class="hdr__logo-mark">ست</span> ست‌شاپ</a>
      <div class="hdr__search">
        <div class="searchbox">
          <input class="searchbox__input" type="search" placeholder="جستجو در میانِ ۲۰٬۰۰۰ کالا… مثال: «شارژر تایپ‌سی»" aria-label="جستجو">
          <span class="searchbox__hint">جستجو</span>
        </div>
      </div>
      <div class="hdr__actions">
        <button class="iconbtn" type="button" aria-label="حساب کاربری">👤</button>
        <button class="iconbtn iconbtn--cart" type="button" aria-label="سبد خرید">🛒<span class="cartcount num">۲</span></button>
      </div>
    </div>
    <div class="container-x">
      <nav class="hdr__nav" aria-label="دسته‌ها">
        <a class="navlink navlink--cats" href="#">همهٔ دسته‌ها</a>
        <span class="navsep"></span>
        <a class="navlink" href="#">شارژر و کابل</a>
        <a class="navlink" href="#">قاب و گلس</a>
        <a class="navlink" href="#">پاوربانک</a>
        <a class="navlink" href="#">هدفون و اسپیکر</a>
        <a class="navlink" href="#">لپ‌تاپ و لوازم</a>
        <a class="navlink" href="#">تخفیف‌ها</a>
      </nav>
    </div>
  </div>`;

const demoHero = `
  <section class="hero" aria-label="معرفی">
    <div class="hero__grid">
      <div>
        <h1 class="hero__title">برای گوشی شما،<br>دقیقاً همان چیزی که باید.</h1>
        <p class="hero__sub">گوشی‌ات را انتخاب کن؛ ما فقط کالاهایِ سازگار با مدلِ دقیقِ تو را نشان می‌دهیم — نه فهرستی بی‌نهایت برایِ کاوش.</p>
        <div class="hero__panel">
          <div class="hero__label">گوشیِ شما چیست؟</div>
          <div class="hero__chips">
            <span class="hero__chip">اپل</span><span class="hero__chip">سامسونگ</span><span class="hero__chip">شیائومی</span><span class="hero__chip">هاوئویی</span>
          </div>
        </div>
      </div>
      <div class="hero__visual" aria-hidden="true"><div class="hero__orbit"></div><div class="hero__phone"><img src="data:image/jpeg;base64,${b64(photoBufs[1])}" alt=""></div><div class="hero__float hero__float--one">سازگار با گوشی شما</div></div>
    </div>
    <div class="hero__stat">ارسالِ امروز از ساعت ۱۴</div>
  </section>`;

const demoTrust = `
  <div class="trust" aria-label="اعتماد">
    <div class="trust__item"><span class="trust__icon">✓</span><div><div class="trust__t">تطبیقِ دقیق</div><div class="trust__d">با مدلِ گوشیِ خودتان</div></div></div>
    <div class="trust__item"><span class="trust__icon">↩</span><div><div class="trust__t">۷ روزِ بازگشت</div><div class="trust__d">بدونِ توضیح</div></div></div>
    <div class="trust__item"><span class="trust__icon">💳</span><div><div class="trust__t">پرداختِ امن</div><div class="trust__d">درگاه‌هایِ ایرانی</div></div></div>
    <div class="trust__item"><span class="trust__icon">🛡</span><div><div class="trust__t">گارانتیِ اصالت</div><div class="trust__d">مکتوب و قابلِ پیگیری</div></div></div>
  </div>`;

const demoProducts = `
  <section class="sect" aria-label="کالاهایِ پرفروش">
    <div class="sect__head">
      <h2 class="sect__title">پرفروش‌ها</h2>
      <a class="sect__more" href="#">همه ←</a>
    </div>
    <div class="grid-p">
${PRODUCTS.map(productCard).join('\n')}
    </div>
  </section>

  <section class="sect" aria-label="فیلترها">
    <div class="sect__head"><h2 class="sect__title">فیلترها</h2></div>
    <div class="chips-row">
      <span class="chip chip--on">همه</span><span class="chip">فقط موجود</span><span class="chip">تخفیف‌دار</span><span class="chip">جدید</span><span class="chip">امتیاز ۴ به بالا</span>
    </div>
  </section>`;

const demoCompare = `
  <section class="sect" aria-label="مقایسه‌یِ کالا">
    <div class="sect__head">
      <h2 class="sect__title">مقایسه‌یِ ۳ کالا</h2>
      <span style="font-size:1.25rem;color:var(--st-500)">جدولِ سرتاسری، ستونِ راهنمایِ چسبیده، ارزان‌ترین با رنگِ برند</span>
    </div>
    <div class="cmp" role="region" aria-label="جدولِ مقایسه" tabindex="0">
      <table class="cmp__table">
        <thead>
          <tr>
            <th class="cmp__corner" scope="col"></th>
            <th scope="col" class="cmp__head is-best">
              <img class="cmp__head-img" src="data:image/jpeg;base64,${b64(photoBufs[0])}" alt="" width="120" height="120">
              <span class="cmp__head-title">شارژر دیواری ۲۰ وات</span>
              <span class="cmp__head-brand">بیسوس</span>
              <div class="cmp__price"><span class="num">۳۲۰٬۰۰۰</span><span class="cmp__unit">تومان</span></div>
            </th>
            <th scope="col" class="cmp__head">
              <img class="cmp__head-img" src="data:image/jpeg;base64,${b64(photoBufs[4])}" alt="" width="120" height="120">
              <span class="cmp__head-title">کابل تایپ‌سی ۱ متری</span>
              <span class="cmp__head-brand">یوگرین</span>
              <div class="cmp__price"><span class="num">۱۱۰٬۰۰۰</span><span class="cmp__unit">تومان</span></div>
            </th>
            <th scope="col" class="cmp__head">
              <img class="cmp__head-img" src="data:image/jpeg;base64,${b64(photoBufs[1])}" alt="" width="120" height="120">
              <span class="cmp__head-title">قاب سیلیکونی مات</span>
              <span class="cmp__head-brand">نیلکین</span>
              <div class="cmp__price"><span class="num">۲۲۰٬۰۰۰</span><span class="cmp__unit">تومان</span></div>
            </th>
          </tr>
        </thead>
        <tbody>
          <tr><th scope="row" class="cmp__rowhead">امتیاز</th><td class="cmp__cell">★★★★☆ <span style="color:var(--st-500);font-size:1.15rem">(۱۲ نظر)</span></td><td class="cmp__cell">—</td><td class="cmp__cell">★★★★★ <span style="color:var(--st-500);font-size:1.15rem">(۸ نظر)</span></td></tr>
          <tr><th scope="row" class="cmp__rowhead">توان</th><td class="cmp__cell">۲۰ وات</td><td class="cmp__cell">—</td><td class="cmp__cell">—</td></tr>
          <tr><th scope="row" class="cmp__rowhead">جنس</th><td class="cmp__cell">—</td><td class="cmp__cell">—</td><td class="cmp__cell">سیلیکون مایع</td></tr>
          <tr><th scope="row" class="cmp__rowhead">سازگاری</th><td class="cmp__cell"><ul class="cmp__models"><li>اپل iPhone 13</li><li>سامسونگ Galaxy S23</li><li style="color:var(--st-500)">+۴ مدلِ دیگر</li></ul></td><td class="cmp__cell"><ul class="cmp__models"><li>شیائومی Redmi Note 13</li><li style="color:var(--st-500)">+۵ مدلِ دیگر</li></ul></td><td class="cmp__cell"><ul class="cmp__models"><li>اپل iPhone 13 Pro</li><li style="color:var(--st-500)">+۲ مدلِ دیگر</li></ul></td></tr>
        </tbody>
      </table>
    </div>
  </section>`;

const demoRecentlyViewed = `
  <section class="sect" aria-label="دیده‌شده‌های اخیر">
    <div class="sect__head"><h2 class="sect__title">دیده‌شده‌هایِ اخیر</h2></div>
    <div class="rv__strip">
      <a href="#" class="rv__card" title="شارژر دیواری ۲۰ وات"><img class="rv__img" src="data:image/jpeg;base64,${b64(photoBufs[0])}" alt="" width="80" height="80"><span class="rv__title">شارژر دیواری ۲۰ وات</span></a>
      <a href="#" class="rv__card" title="قاب سیلیکونی مات"><img class="rv__img" src="data:image/jpeg;base64,${b64(photoBufs[1])}" alt="" width="80" height="80"><span class="rv__title">قاب سیلیکونی مات</span></a>
      <a href="#" class="rv__card" title="پاوربانک ۲۰۰۰۰ میلی‌آمپر"><img class="rv__img" src="data:image/jpeg;base64,${b64(photoBufs[2])}" alt="" width="80" height="80"><span class="rv__title">پاوربانک ۲۰۰۰۰ میلی‌آمپر</span></a>
      <a href="#" class="rv__card" title="گلس سرامیکی ۹H"><img class="rv__img" src="data:image/jpeg;base64,${b64(photoBufs[3])}" alt="" width="80" height="80"><span class="rv__title">گلس سرامیکی ۹H</span></a>
      <a href="#" class="rv__card" title="کابل تایپ‌سی ۱ متری"><img class="rv__img" src="data:image/jpeg;base64,${b64(photoBufs[4])}" alt="" width="80" height="80"><span class="rv__title">کابل تایپ‌سی ۱ متری</span></a>
    </div>
  </section>`;

const demoPriceHistory = `
  <section class="sect" aria-label="تاریخچهٔ قیمت">
    <div class="sect__head"><h2 class="sect__title">تاریخچهٔ قیمت</h2><span style="font-size:1.25rem;color:var(--st-500)">«آیا فروشنده قیمت را بالا برد و بعد تخفیف زد؟»</span></div>
    <div style="border:1px solid var(--st-200);border-radius:var(--st-r-md);padding:var(--st-4);background:var(--st-0);max-width:420px">
      <p style="font-size:1.25rem;font-weight:700;color:var(--st-600);margin:0 0 var(--st-2)">تاریخچهٔ قیمت — شارژر دیواری ۲۰ وات</p>
      <div style="display:flex;gap:var(--st-1);flex-wrap:wrap">
        <span style="font-size:1.15rem;color:var(--st-500);white-space:nowrap">۰۶/۰۱: ۳۲۰٬۰۰۰</span>
        <span style="font-size:1.15rem;color:var(--st-500);white-space:nowrap">۰۶/۰۵: ۳۲۰٬۰۰۰</span>
        <span style="font-size:1.15rem;color:var(--st-500);white-space:nowrap">۰۶/۱۰: ۳۵۰٬۰۰۰</span>
        <span style="font-size:1.15rem;color:var(--st-deal,#b91c1c);font-weight:700;white-space:nowrap">۰۶/۱۵: ۲۹۰٬۰۰۰</span>
        <span style="font-size:1.15rem;color:var(--st-deal,#b91c1c);font-weight:700;white-space:nowrap">۰۶/۲۰: ۲۹۰٬۰۰۰</span>
      </div>
      <p style="font-size:1.15rem;color:var(--st-400);margin:var(--st-1) 0 0">۷ روز داده — قیمتِ فعلی <strong style="color:var(--st-deal,#b91c1c)">ارزان‌ترین</strong></p>
    </div>
  </section>`;

/* ── سربرگِ «تازه‌سازی خودکار» (هَش‌هایِ ورودی = انگشتِ خونیِ قالب) ───── */
const stamp = new Date().toISOString().slice(0, 10);
const hashLines = inputs.map(([name, buf]) => `    ${name}: ${sha12(buf)}`).join('\n');
const headerComment = `
<!--
  ⚠ این پرونده با «npm run template» (scripts/render-qalib.mjs) **خودکار** تولید شده — دست‌کاری نکنید.
  برایِ تغییرِ قالب: توکن‌ها را در apps/web/src/app/storefront.css یا globals.css ویرایش کنید،
  سپس «npm run template» را اجرا و هر دو پرونده را commت کنید.
  CI با «npm run template:check» نگهبانی می‌دهد: اگر طراحی عوض شود و این پرونده
  بازتولید نشود، زنجیرهٔ کیفیت قرمز می‌شود.

  نسخهٔ سازنده: ${GEN_VERSION} · تاریخ: ${stamp}
  ورودی‌ها (sha256 — اگر یکی فرق دارد، پرونده کهنه است):
${hashLines}
-->
`;

/* ── HTML ─────────────────────────────────────────────────────────────── */
const html = `${headerComment}
<!doctype html>
<html lang="fa" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>قالبِ ست‌شاپ — مرجعِ بصریِ خودکار</title>
<style>
${fontFace}

${globalsSubset}

${storefrontCssAll}
${read(ACCOUNT_CSS).toString('utf8')}
${read(PREMIUM_CSS).toString('utf8')}

/* ── استایل‌هایِ خاصِ همین مرجع (فقط برایِ صفحاتِ «توکن» و «درباره») ── */
body { background: var(--st-50); }
.gen {
  background: var(--st-900); color: #fff; text-align: center;
  font-size: 1.2rem; padding: var(--st-2) var(--st-3);
}
.gen b { color: var(--st-accent); }
.ref { margin-top: var(--st-8); }
.ref__h { font-size: 1.8rem; font-weight: 800; color: var(--st-800); margin: 0 0 var(--st-4); }
.ref__card {
  background: var(--st-0); border: 1px solid var(--st-200);
  border-radius: var(--st-r-md); padding: var(--st-6); margin-bottom: var(--st-4);
}
.swg { display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: var(--st-2); }
.sw { display: grid; grid-template-columns: 40px 1fr auto; align-items: center; gap: var(--st-2);
     border: 1px solid var(--st-200); border-radius: var(--st-r-sm); padding: var(--st-2); font-size: 1.2rem; }
.sw__chip { width: 40px; height: 28px; border-radius: var(--st-r-xs); display: block; }
.sw b { color: var(--st-700); font-weight: 700; }
.sp { display: grid; grid-template-columns: 1fr auto; align-items: center; gap: var(--st-3); margin-bottom: var(--st-2); font-size: 1.2rem; }
.sp i { height: 14px; background: var(--st-brand-100); border: 1px solid var(--st-brand); border-radius: 3px; }
.rd { display: grid; grid-template-columns: 48px 1fr auto; align-items: center; gap: var(--st-2); margin-bottom: var(--st-2); font-size: 1.2rem; }
.rd i { width: 48px; height: 32px; background: var(--st-brand-50); border: 1px solid var(--st-brand); }
.sh { display: grid; grid-template-columns: 48px 1fr; align-items: center; gap: var(--st-2); margin-bottom: var(--st-2); font-size: 1.2rem; }
.sh i { width: 48px; height: 32px; background: #fff; border-radius: var(--st-r-xs); }
.ty { display: grid; grid-template-columns: 1fr auto; align-items: baseline; gap: var(--st-3);
      padding: var(--st-2) 0; border-bottom: 1px dashed var(--st-200); color: var(--st-800); }
.ty code { color: var(--st-500); }
.chips-row { display: flex; flex-wrap: wrap; gap: var(--st-2); }
.card-p__stock { font-size: 1.15rem; font-weight: 700; }
.card-p__stock.is-in { color: var(--st-ok); }
.card-p__stock.is-low { color: var(--st-accent); }
.card-p__stock.is-out { color: var(--st-err); }
.about { font-size: 1.3rem; line-height: 2.1; color: var(--st-700); }
.about code { background: var(--st-100); border-radius: var(--st-r-xs); padding: 1px var(--st-1); direction: ltr; unicode-bidi: embed; }
.about li { margin-bottom: var(--st-1); }
</style>
</head>
<body>

<div class="gen st">
  قالبِ خودکارِ ست‌شاپ · تولیدِ <b class="num">${stamp}</b> · از رویِ <b>کدِ زندهٔ</b> سایت (هَشِ ورودی‌ها در انتهایِ این پرونده)
</div>

<main class="st container-x" style="padding-block: var(--st-4) 96px">

${demoHeader}
${demoHero}
${demoTrust}
${demoProducts}
${demoCompare}
${demoRecentlyViewed}
${demoPriceHistory}

<!-- ═══════════════ بخشِ دوم: سیستمِ طراحیِ ویترین ═══════════════ -->
<section class="ref" aria-label="سیستمِ طراحی">
  <h2 class="sect__title" style="font-size:2.4rem">سیستمِ طراحیِ ویترین <span style="font-size:1.3rem;font-weight:500;color:var(--st-500)">— همه از storefront.css خوانده شده است</span></h2>

  <div class="ref__card">
${swatchGrid(stTokens, 'رنگ‌ها (برند: نیلیِ تیره، قرمز = فقط تخفیف)')}
  </div>

  <div class="ref__card"><h3 class="ref__h">فاصله (مضرب‌هایِ ۴)</h3>${spaceScale}</div>
  <div class="ref__card"><h3 class="ref__h">شعاع</h3>${radiusScale}</div>
  <div class="ref__card"><h3 class="ref__h">سایه</h3>${shadowScale}</div>
  <div class="ref__card"><h3 class="ref__h">تایپوگرافی (rem = ۱۰px، خطِ سیر ۱٫۸)</h3>${typeScale}</div>

  <div class="ref__card">
    <h3 class="ref__h">اجزایِ ویترین</h3>
    <div class="chips-row" style="margin-bottom:var(--st-4)">
      <button class="btn-p btn-p--primary" type="button">افزودن به سبد</button>
      <button class="btn-p btn-p--primary btn-p--lg" type="button">خریدِ فوری</button>
      <button class="btn-p btn-p--outline" type="button">مشاهدهٔ همه</button>
      <button class="btn-p btn-p--ghost" type="button">انصراف</button>
      <button class="btn-p btn-p--primary" type="button" disabled>ناموجود</button>
    </div>
    <div class="chips-row" style="margin-bottom:var(--st-4)">
      <span class="tag tag--ok">موجود</span>
      <span class="tag" style="background:var(--st-accent-soft);color:var(--st-accent)">تنها ۳ عدد</span>
      <span class="tag" style="background:var(--st-err-soft);color:var(--st-err)">ناموجود</span>
      <span class="card-p__badge" style="position:static">۲۰٪</span>
      <span class="chip chip--on">فیلترِ فعال</span>
      <span class="chip">فیلتر</span>
    </div>
    <div class="price price--lg" style="margin-bottom:var(--st-2)">
      <span class="price__value num">۱٬۲۰٬۰۰</span><span class="price__unit">تومان</span><span class="price__old num">۱٬۵۶۲٬۵۰۰</span>
    </div>
    <div class="searchbox" style="max-width:480px">
      <input class="searchbox__input" type="search" placeholder="جستجو… مثال: «قاب آیفون ۱۴»" aria-label="جستجو (نمونه)">
    </div>
  </div>
</section>

<!-- ═══════════════ بخشِ سوم: اجزایِ پنل (globals.css) ═══════════════ -->
<section class="ref" aria-label="اجزایِ پنل">
  <h2 class="sect__title" style="font-size:2.4rem">اجزایِ پنل <span style="font-size:1.3rem;font-weight:500;color:var(--st-500)">— از globals.css (رنگِ برندِ پنل)</span></h2>
  <div class="ref__card">
    ${swatchGrid(glTokens, 'توکن‌هایِ پایه (پنل و صفحاتِ عمومی)')}
  </div>
  <div class="ref__card">
    <div class="chips-row" style="margin-bottom:var(--st-4)">
      <button class="btn btn--primary" type="button">ذخیره</button>
      <button class="btn btn--ghost" type="button">انصراف</button>
      <button class="btn btn--danger" type="button">حذف</button>
      <button class="btn btn--primary" type="button" disabled>غیرفعال</button>
    </div>
    <div class="chips-row" style="margin-bottom:var(--st-4)">
      <span class="badge badge--success">پرداخت شد</span>
      <span class="badge badge--warning">در انتظار</span>
      <span class="badge badge--danger">لغو</span>
      <span class="badge badge--soft">پیش‌نویس</span>
      <span class="badge badge--brand">پیشنهاد ویژه</span>
    </div>
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:var(--s-4);margin-bottom:var(--s-4)">
      <div class="field"><span class="field__label">عنوانِ کالا</span><input class="field__input" type="text" value="شارژر دیواری ۲۰ وات"></div>
      <div class="field"><span class="field__label">قیمت (تومان)</span><input class="field__input num" type="text" value="۳۲٬۰۰"></div>
    </div>
    <div class="alert alert--danger">این کالا در موجودی نیست؛ سفارش را لغو یا موجودی را بارگذاری کنید.</div>
  </div>
  <div class="ref__card">
    <h3 class="ref__h">جدول (الگویِ پنلِ سفارش‌ها)</h3>
    <div class="card" style="padding:var(--s-4)">
      <table class="table">
        <thead><tr><th>سفارش</th><th>مشتری</th><th>مبلغ</th><th>وضعیت</th></tr></thead>
        <tbody>
          <tr><td class="num">SET-۱۴۵-۰۱۲</td><td>مهدی رضایی</td><td class="num">۳٬۲۰٬۰۰ تومان</td><td><span class="badge badge--success">پرداخت شد</span></td></tr>
          <tr><td class="num">SET-۱۴۵-۰۰۱۱</td><td>سارا احمدی</td><td class="num">۱۱۰۰۰۰ تومان</td><td><span class="badge badge--warning">در انتظارِ پرداخت</span></td></tr>
        </tbody>
      </table>
    </div>
  </div>
</section>

<!-- ═══════════════ بخشِ چهارم: دربارهٔ این پرونده ═══════════════ -->
<section class="ref" aria-label="درباره">
  <h2 class="sect__title" style="font-size:2.4rem">دربارهٔ این پرونده</h2>
  <div class="ref__card about">
    <ul>
      <li>این فایل با <code>npm run template</code> از رویِ **چهار پروندهٔ CSSِ زنده** (globals.css، storefront.css، account.css و premium.css)، سه فونتِ Vazirmatn و پنج تصویرِ کالایِ نمونه ساخته می‌شود — هیچ مقداری دستی واردش نشده است.</li>
      <li>«با هر بارِ تغییرِ سایت تازه بماند» دو لایه دارد:
        <ol style="list-style:none;padding:0;margin:var(--s-2) 0 0">
          <li>وقتی توکن یا قاعدهٔ طراحی را عوض می‌کنید، یک‌بار <code>npm run template</code> بزنید و خروجی را همراهِ تغییرِ CSS commت کنید؛</li>
          <li>و اگر فراموش کردید، CI (گیت‌هاب اکشن «کیفیت») با <code>npm run template:check</code> متوجه می‌شود و زنجیره را قرمز می‌کند — یعنی قالبِ کهنه نمی‌تواند به <code>main</code> برسد.</li>
        </ol>
      </li>
      <li>همهٔ فونت و تصویر <b>داخلِ همین پرونده</b> است (data-URI): بی‌اینترنت، بی‌CDN — را به هر جایی ببرید.</li>
      <li>در انتهایِ پرونده، هَشِ (sha256) هر ورودی ثبت شده: اگر یکی از آن‌ها با واقعیت فرق داشته باشد، این پرونده کهنه است.</li>
      <li>محتوایِ کارت‌ها (عنوان/قیمت/موجودی) **نمونه** است تا اجزا دیده شوند؛ دادهٔ واقعی همیشه از پایگاه می‌آید.</li>
    </ul>
  </div>
</section>

</main>
</body>
</html>
`;

/* ── بررسیِ کهنه‌بودن (CI) ─────────────────────────────────────────────── */
function staleReport(existing) {
  const lines = [];
  for (const [name, buf] of inputs) {
    const want = sha12(buf);
    const m = existing.match(new RegExp(`${name.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&')}: (\\w{12})`));
    const have = m ? m[1] : null;
    if (have !== want) lines.push(`  ${name}: در پرونده ${have ?? '—'}، در پروندهٔ زنده ${want}`);
  }
  if (!lines.length) {
    const wantV = String(GEN_VERSION);
    if (!existing.includes(`نسخهٔ سازنده: ${wantV}`)) lines.push(`  نسخهٔ سازنده: پرونده قدیمی‌تر از سازندهٔ کنونی است`);
  }
  return lines;
}

const CHECK = process.argv.includes('--check');
if (CHECK) {
  if (!existsSync(OUT)) {
    console.error(`✗ قالب پیدا نشد: ${OUT} — «npm run template» را اجرا کنید.`);
    process.exit(1);
  }
  const existing = readFileSync(OUT, 'utf8');
  const lines = staleReport(existing);
  if (lines.length) {
    console.error(`✗ قالبِ سایت کهنه است (ورودی‌ها تغییر کرده‌اند):\n${lines.join('\n')}`);
    console.error('درمان: npm run template   (و commتِ نتیجه با تغییرِ CSS)');
    process.exit(1);
  }
  console.log('✓ قالبِ سایت با کدِ زنده هم‌خوان است.');
  process.exit(0);
}

writeFileSync(OUT, html);
const kb = Math.round((Buffer.byteLength(html) / 1024) * 10) / 10;
console.log(`✓ قالب تولید شد: docs/qalib.html (${kb} کیلوبایت، خودکفا: فونت + ۵ تصویر داخلِ پرونده)`);
