/**
 * ممیزیِ بصریِ فروشگاه — اندازه‌گیری به‌جایِ حدس.
 *
 * این اسکریپت مرورگرِ کرومیوم را بی‌سر باز می‌کند، هر صفحه را در دو اندازه‌ی
 * «رومیزی» و «موبایل» بار می‌کند و چیزهایی را اندازه می‌گیرد که در نگاهِ
 * اول دیده نمی‌شوند اما کیفیت را تعیین می‌کنند:
 *
 *   • سرریزِ افقی (لغزشِ عرضی) — شایع‌ترین ایرادِ صفحه‌هایِ راست‌به‌چپ
 *   • عناصری که از لبه‌ی نمایشگر بیرون زده‌اند
 *   • تصویرهایی که بارگیری نشده‌اند یا alt ندارند
 *   • این‌که فونتِ فارسی واقعاً نشسته باشد (سنجشِ پهنایِ حروف)
 *   • کنتراستِ متن با زمینه (کمتر از ۴٫۵:۱ یعنی خواندن دشوار است)
 *   • هدف‌هایِ لمسیِ کوچک‌تر از ۳۲ پیکسل
 *   • زمانِ بارگیریِ کامل
 *
 * استفاده:
 *   node scripts/visual-audit.js                      # همه‌ی صفحه‌ها
 *   node scripts/visual-audit.js "/" "/cart"          # صفحه‌هایِ دلخواه
 *   SHOTS=1 node scripts/visual-audit.js /           # همراه با عکس
 *
 * خروجی: جدول در خروجیِ استاندارد + فایلِ shots/report.json
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import puppeteer from 'puppeteer-core';

const BASE = process.env.SITE_URL ?? 'http://127.0.0.1:3100';
const CHROME = process.env.CHROME_PATH ?? '/usr/bin/chromium';
const SHOT_DIR = new URL('../shots/', import.meta.url).pathname;

const PAGES = process.argv.slice(2).length
  ? process.argv.slice(2)
  : ['/', '/search?q=%D9%82%D8%A7%D8%A8', '/cart', '/products'];

const SIZES = [
  { label: 'رومیزی', width: 1280, height: 900 },
  { label: 'موبایل', width: 390, height: 844 },
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const AUDIT = () => {
  const findings = [];
  const doc = document;
  const html = doc.documentElement;
  const vw = window.innerWidth;

  const add = (severity, kind, detail) => findings.push({ severity, kind, detail });

  // ۱) جهت و زبان
  if (html.dir !== 'rtl') add('high', 'direction', `dir="${html.dir}"`);
  if (html.lang !== 'fa') add('medium', 'direction', `lang="${html.lang}"`);

  // ۲) سرریزِ افقی
  if (doc.documentElement.scrollWidth > vw + 1) {
    add('high', 'overflow', `عرضِ سند ${doc.documentElement.scrollWidth}px > نمایشگر ${vw}px`);
  }

  // ۳) عناصرِ بیرون‌زده
  //
  // استثنا: چیزی که درونِ یک نگه‌دارنده‌یِ پیمایش‌پذیرِ افقی است (ریلِ
  // پیشنهادها، نوارِ دسته‌بندی) «بیرون‌زده» نیست — قرار است با انگشت یا
  // موس پیمایش شود. در راست‌به‌چپ، موقعیتِ آغازینِ این نگه‌دارنده‌ها از
  // دیدِ getBoundingClientRect مقداری منفی می‌دهد؛ اگر آن‌ها را خطا
  // می‌گرفتیم، هر ریلی ده‌ها خطایِ دروغین می‌ساخت.
  const inHorizontalScroller = (el) => {
    let n = el.parentElement;
    while (n && n !== doc.body) {
      const ox = getComputedStyle(n).overflowX;
      if (ox === 'auto' || ox === 'scroll') return true;
      n = n.parentElement;
    }
    return false;
  };

  for (const el of doc.querySelectorAll('body *')) {
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    if (r.right > vw + 2 || r.left < -2) {
      if (inHorizontalScroller(el)) continue;
      const name = `${el.tagName.toLowerCase()}.${String(el.className || '').split(' ')[0]}`;
      add('medium', 'offscreen', `${name} — راست ${Math.round(r.right)} / چپ ${Math.round(r.left)}`);
    }
  }

  // ۴) تصویرها
  for (const img of doc.querySelectorAll('img')) {
    if (img.complete && img.naturalWidth === 0) {
      add('high', 'image', `بارگیری نشد: ${img.currentSrc || img.src}`.slice(0, 110));
    }
    if (!img.hasAttribute('alt')) add('low', 'image', `بی‌alt: ${(img.src || '').slice(0, 70)}`);
  }

  // ۵) فونتِ فارسی واقعاً نشسته؟
  const fontFamily = getComputedStyle(doc.body).fontFamily;
  if (!/Vazirmatn|Vazir|وزیر|Shabnam|Yekan/i.test(fontFamily)) {
    add('medium', 'font', `بدنه: ${fontFamily}`);
  }

  // ۶) کنتراست
  const lum = ([r, g, b]) => {
    const f = (v) => {
      const c = v / 255;
      return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  };
  const rgb = (v) => {
    const m = v.match(/rgba?\(([^)]+)\)/);
    if (!m) return null;
    const p = m[1].split(',').map((x) => parseFloat(x.trim()));
    return [p[0] ?? 0, p[1] ?? 0, p[2] ?? 0];
  };
  // اگر در مسیرِ تا ریشه تصویر یا گرادیان باشد، رنگِ پس‌زمینه با
  // getComputedStyle به‌دست نمی‌آید؛ در آن صورت کنتراست را «نامعلوم»
  // می‌گذاریم تا گزارش دروغین نسازیم (مثلِ تیترِ سفید رویِ تصویرِ قهرمان).
  const bgOf = (el) => {
    let n = el;
    while (n) {
      const cs = getComputedStyle(n);
      if (cs.backgroundImage && cs.backgroundImage !== 'none') return null;
      const bg = cs.backgroundColor;
      if (bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent') return bg;
      n = n.parentElement;
    }
    return 'rgb(255, 255, 255)';
  };

  let worst = { ratio: 21, where: '', text: '' };
  const nodes = Array.from(doc.querySelectorAll('h1,h2,h3,p,a,span,button,td,th,label'))
    .filter((el) => (el.textContent ?? '').trim().length > 2)
    .filter((el) => el.getBoundingClientRect().height > 0)
    .slice(0, 400);

  for (const el of nodes) {
    const cs = getComputedStyle(el);
    // متنِ شفاف (مثلِ گرادیانِ رویِ حروف) را هم نمی‌توان سنجید
    if (cs.webkitTextFillColor === 'rgba(0, 0, 0, 0)') continue;
    const a = rgb(cs.color);
    const b = bgOf(el);
    if (!a || !b) continue;
    const l1 = lum(a);
    const l2 = lum(b);
    const [hi, lo] = l1 > l2 ? [l1, l2] : [l2, l1];
    const ratio = (hi + 0.05) / (lo + 0.05);
    if (ratio < worst.ratio) {
      worst = {
        ratio,
        where: `${el.tagName.toLowerCase()}.${String(el.className || '').split(' ')[0]}`,
        text: (el.textContent ?? '').trim().slice(0, 40),
      };
    }
  }
  if (worst.ratio < 4.5) {
    add(worst.ratio < 3 ? 'high' : 'medium', 'contrast', `${worst.ratio.toFixed(2)}:1 در ${worst.where} «${worst.text}»`);
  }

  // ۷) هدف‌هایِ لمسی
  //
  // یک چک‌باکسِ ۱۶ پیکسلی درونِ یک دکمه‌یِ ۳۴ پیکسلی، هدفِ کوچکی نیست:
  // آنچه لمس می‌شود دکمه است. پس اگر رویِ والدِ کلیک‌پذیر نشسته، اندازه‌یِ
  // والد را می‌سنجیم.
  for (const el of doc.querySelectorAll('button, a.btn, .btn, input[type="checkbox"], input[type="radio"]')) {
    const clickableParent = el.closest('button, a.btn, .btn, label');
    const target = el.tagName === 'INPUT' && clickableParent && clickableParent !== el ? clickableParent : el;
    const r = target.getBoundingClientRect();
    if (r.height > 0 && r.height < 32) {
      add('low', 'touch', `${Math.round(r.height)}px — «${(target.textContent ?? '').trim().slice(0, 20)}»`);
    }
  }

  return {
    title: doc.title,
    counts: {
      images: doc.querySelectorAll('img').length,
      headings: doc.querySelectorAll('h1,h2,h3').length,
      sections: doc.querySelectorAll('section').length,
      buttons: doc.querySelectorAll('button').length,
    },
    findings,
  };
};

function severityRank(s) {
  return s === 'high' ? 0 : s === 'medium' ? 1 : 2;
}

const report = [];

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage'],
});

try {
  for (const path of PAGES) {
    for (const size of SIZES) {
      const page = await browser.newPage();
      await page.setViewport({ width: size.width, height: size.height, deviceScaleFactor: 1 });

      const errors = [];
      // پیش‌واکشی‌هایِ نکست (‎?_rsc=) هنگامِ خروج از صفحه لغو می‌شوند و
      // خطایِ واقعی نیستند؛ نشانی‌هایِ favicon هم جداگانه بررسی می‌شود.
      const ignorable = (t) => t.includes('_rsc=') || t.includes('favicon');
      page.on('console', (m) => {
        if (m.type() === 'error' && !ignorable(m.text())) errors.push(m.text().slice(0, 120));
      });
      page.on('pageerror', (e) => errors.push(String(e).slice(0, 120)));

      // پشتیبانی از نشستِ مدیر تا صفحه‌هایِ پنل هم ممیزی شوند:
      //   ADMIN_TOKEN=... node scripts/visual-audit.js /admin
      if (process.env.ADMIN_TOKEN) {
        await page.setCookie({
          name: 'set_admin_token',
          value: process.env.ADMIN_TOKEN,
          domain: new URL(BASE).hostname,
          path: '/',
        });
      }

      const started = Date.now();
      let status = 0;
      try {
        const res = await page.goto(`${BASE}${path}`, { waitUntil: 'networkidle2', timeout: 30000 });
        status = res?.status() ?? 0;
      } catch (err) {
        errors.push(`بارگیری: ${String(err).slice(0, 100)}`);
      }
      await sleep(600);
      const loadMs = Date.now() - started;

      let result = { title: '', counts: {}, findings: [] };
      try {
        result = await page.evaluate(AUDIT);
      } catch (err) {
        errors.push(`ممیزی: ${String(err).slice(0, 100)}`);
      }

      if (process.env.SHOTS) {
        const name = `shot${path.replace(/[^a-z0-9]/gi, '_') || '_home'}_${size.width}.png`;
        await page.screenshot({ path: SHOT_DIR + name, fullPage: size.width < 500 });
        result.shot = name;
      }

      report.push({ path, size: size.label, width: size.width, status, loadMs, errors, ...result });
      await page.close();
    }
  }
} finally {
  await browser.close();
}

mkdirSync(SHOT_DIR, { recursive: true });
writeFileSync(SHOT_DIR + 'report.json', JSON.stringify(report, null, 2), 'utf8');

// --- خروجیِ خوانا
let high = 0;
let medium = 0;
for (const r of report) {
  const bad = r.findings.filter((f) => f.severity === 'high').length;
  const mid = r.findings.filter((f) => f.severity === 'medium').length;
  high += bad;
  medium += mid;
  console.log(
    `\n${r.path}  [${r.size} ${r.width}px]  پاسخ ${r.status} · ${r.loadMs}ms · عکس ${r.counts.images} · تیتر ${r.counts.headings} · بخش ${r.counts.sections}`,
  );
  if (r.errors.length) console.log(`  خطاها: ${r.errors.join(' | ')}`);
  for (const f of r.findings.sort((a, b) => severityRank(a.severity) - severityRank(b.severity)).slice(0, 8)) {
    console.log(`   • [${f.severity}] ${f.kind}: ${f.detail}`);
  }
}
console.log(`\nجمع: ${high} ایرادِ مهم، ${medium} متوسط — گزارشِ کامل در shots/report.json`);
