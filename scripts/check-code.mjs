#!/usr/bin/env node
/**
 * بازرسِ ست‌شاپ (Quality gate #۳)
 *
 * چرا یک بازرسِ «خودساخته» و نه یک linterِ عمومی؟ چون خطاهایی که این پروژه را
 * در تولید می‌شکنند، با قانون‌هایِ سبکِ کد (نقطه‌ویرگول، فاصله، نام‌گذاری)
 * گرفته نمی‌شوند. اینجا شش قانون استخراج شده از **الزام‌هایِ واقعیِ این
 * پروژه** — هر کدام اگر بشکنند، یا سایت در ایران بالا نمی‌آید، یا امنیت
 * می‌شکند، یا پایگاه در سرورِ مشتری از کار می‌افتد:
 *
 *   ۱. هیچ رازی در مخزن نماند (توکن، کلیدِ خصوصی، رمز).
 *   ۲. هیچ منبعِ خارجی — نه فونت از گوگل، نه کتاب‌خانه از شبکه‌یِ تحویلِ
 *      محتوا. سایت باید بدونِ اینترنتِ بین‌الملل بالا بیاید (الزامِ پروژه).
 *   ۳. کدی که در مرورگر اجرا می‌شود، به نشانیِ مطلقِ میزبان وصل نشود؛
 *      در غیر این صورت رویِ دامنه‌یِ مشتری کار نمی‌کند.
 *   ۴. هیچ `console.log`/`debugger` ی در مسیرِ تولید نماند.
 *   ۵. نام‌گذاریِ مهاجرت‌ها یک‌دست باشد (شماره‌یِ بی‌درنگ، بی‌تکرار).
 *   ۶. کارِ ناتمام (`TODO`/`FIXME`) شمرده شود — پنهان نماند.
 *
 * خروجی: خلاصه + فهرست. در صورتِ خطا، کدِ خروج ۱ (CI را قرمز می‌کند).
 *
 * اجرا:  node scripts/check-code.mjs
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const ROOT = process.cwd();

/** شاخه‌هایی که هرگز بازبینی نمی‌شوند */
const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  '.next',
  'out',
  'dist',
  'build',
  'coverage',
  '.turbo',
  '.data',
  'var',
  'shots',
]);

/** مسیرهایی که «کدِ منبع» به‌شمار می‌آیند (قانون‌هایِ ۲ تا ۴) */
const SOURCE_DIRS = ['apps/api/src', 'apps/web/src', 'packages'];

/** قانونِ ۳ فقط برایِ کدی که در مرورگر اجرا می‌شود */
const BROWSER_DIRS = ['apps/web/src'];

const SCANNABLE = new Set(['.ts', '.tsx', '.mjs', '.js', '.css', '.html', '.json', '.sql', '.yml', '.yaml', '.sh', '.md', '.env.example']);

const errors = [];
const warnings = [];
/** استثناهایِ قانونِ یک — شمرده می‌شوند تا در هر اجرا دیده شوند */
const allowedSecrets = [];

function fail(rule, file, line, text, why) {
  errors.push({ rule, file, line, text, why });
}

function warn(rule, file, line, text, why) {
  warnings.push({ rule, file, line, text, why });
}

/** همه‌یِ پرونده‌ها به‌جز شاخه‌هایِ مستثنا */
function* walk(dir) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      if (entry.name.startsWith('.')) continue;
      yield* walk(full);
    } else if (entry.isFile()) {
      const rel = relative(ROOT, full);
      const ext = rel.slice(rel.lastIndexOf('.'));
      if (SCANNABLE.has(ext)) yield full;
    }
  }
}

function isUnder(path, dirs) {
  const rel = relative(ROOT, path).split(sep).join('/');
  return dirs.some((d) => rel.startsWith(d + '/'));
}

// ───────────────────────────────────────────────────────────────────────────
// قانون ۱: رازها
// ───────────────────────────────────────────────────────────────────────────
// پیشوندها جدا نوشته شده‌اند تا این پرونده — که خودش «پویشگرِ راز» است —
// به‌دستِ پویشگرهایِ خودکار (از جمله اسکنرِ رازِ گیت‌هاب) راز به‌نظر نرسد.
const GH_FINE = 'github_' + 'pat_';
const GH_CLASSIC = 'gh' + 'p_';
const GH_OAUTH = 'gh' + 'o_';

const PEM_BEGIN = '-----BEGIN [A-Z ]*PRIVATE KEY-----';
const PEM_END = '-----END [A-Z ]*PRIVATE KEY-----';

const SECRET_PATTERNS = [
  [new RegExp(GH_FINE + '[A-Za-z0-9_]{20,}', 'g'), 'توکنِ دسترسیِ گیت‌هاب'],
  [new RegExp(GH_CLASSIC + '[A-Za-z0-9]{36}', 'g'), 'توکنِ شخصیِ گیت‌هاب'],
  [new RegExp(GH_OAUTH + '[A-Za-z0-9]{36}', 'g'), 'توکنِ OAuthِ گیت‌هاب'],
  [new RegExp(PEM_BEGIN, 'g'), 'کلیدِ خصوصی'],
  [/AIza[0-9A-Za-z_-]{35}/g, 'کلیدِ API گوگل'],
  [/sk_live_[0-9a-zA-Z]{24,}/g, 'کلیدِ زنده‌یِ استرایپ'],
  // افزوده‌شده پس از بررسیِ ایستا: آنچه در این پروژه **ممکن است** چسبانده
  // شود، نه فهرستِ کلیشه‌ایِ اینترنت. هر کدام به یک وسوسه‌یِ واقعی وصل است:
  [/AKIA[0-9A-Z]{16}/g, 'کلیدِ دسترسیِ AWS'],
  [/xox[baprs]-[A-Za-z0-9-]{10,}/g, 'توکنِ Slack'],
  [/sk-[A-Za-z0-9]{32,}/g, 'کلیدِ OpenAI'],
  [/eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\./g, 'توکنِ وب (JWT)'],
  [/postgres(?:ql)?:\/\/[^\s'"]*:[^\s'"@]+@/g, 'نشانیِ پایگاه با رمز'],
  [/merchant[_-]?id['"\\s:=]+[A-Za-z0-9-]{32,}/gi, 'شناسه‌یِ پذیرنده‌یِ درگاه'],
];

/**
 * نمونه در برابرِ راز.
 *
 * مستنداتِ این پروژه پر از قالب است: `postgres://user:pass@host/db`،
 * `ZARINPAL_MERCHANT_ID=xxxxxxxx-…`، `DB_URL=…$PGPASSWORD…`. پویشگرِ ساده
 * این‌ها را هم «رازِ چسبانده‌شده» می‌نامد — و دروغِ پیاپی، بدتر از نداشتنِ
 * پویشگر است، چون کسی دیگر به هشدارهایش نگاه نمی‌کند.
 *
 * پس هر رشته‌ای که به یکی از نشانه‌هایِ «الگو بودن» بخورد کنار گذاشته
 * می‌شود: واژه‌هایِ جای‌نگه‌دار، متغیرِ پوسته، یا تکرارِ یک نویسه (`xxxx`).
 */
const PLACEHOLDER = /(?:user|pass|password|رمز|changeme|example|نمونه|xxx+|\*+|\$\{?[A-Z_]+)/i;

/**
 * بخشِ «رازگونه»‌یِ یک رشته — همان که باید داوری شود.
 *
 * در نشانیِ پایگاه، کلِ رشته شاملِ نامِ میزبان هم هست؛ و میزبان ممکن است
 * `example.com` باشد در حالی که رمز، واقعی است. پس برایِ این الگو فقط رمز را
 * جدا می‌کنیم (میانِ واپسینِ دو‌نقطه و @).
 */
function suspectPart(label, text) {
  if (label !== 'نشانیِ پایگاه با رمز') return text;
  const at = text.indexOf('@');
  const before = at === -1 ? text : text.slice(0, at);
  const colon = before.lastIndexOf(':');
  return colon === -1 ? text : before.slice(colon + 1);
}

function looksLikePlaceholder(text) {
  if (PLACEHOLDER.test(text)) return true;
  // تکرارِ یک نویسه (xxxxxxxx-xxxx-…): یک شناسه‌یِ واقعی چنین نیست
  const body = text.replace(/[^A-Za-z0-9]/g, '');
  return body.length > 4 && new Set(body.toLowerCase()).size <= 2;
}

// ───────────────────────────────────────────────────────────────────────────
// استثنایِ آگاهانه برایِ مدارکِ آزمایشی
//
// چرا اصلاً استثنا؟ چون آزمونِ گاوصندوقِ گواهی باید یک جفتِ کلید و گواهیِ
// واقعی داشته باشد (تا امضا و راستی‌آزمایی واقعاً انجام شود، نه شبیه‌سازی)،
// و ساختنش باopenssl در هر اجرا یعنی وابستگیِ پنهان به ابزاری که ممکن است
// نباشد. پس یک جفتِ **خودامضا و یک‌بار‌مصرف** در مخزن می‌نشیند.
//
// چرا این خطر نیست؟ چون این کلیدها هیچ چیزی را امضا نمی‌کنند که ارزشی
// داشته باشد: نه مرجع آن‌ها را صادر کرده، نه در هیچ سامانه‌ای ثبت‌اند، و
// تنها در آزمون به کار می‌روند. خطرِ واقعی این است که کسی **کلیدِ واقعیِ
// سازمان** را همین‌جا بچسباند؛ برای همین استثنا «فایل‌محور» است (فقط همین
// یک پرونده) و در هر اجرا **با صدایِ بلند** گزارش می‌شود تا فراموش نشود.
// ───────────────────────────────────────────────────────────────────────────
const SECRET_ALLOWLIST = new Map([
  [
    'packages/tax/src/cert-fixtures.ts',
    'مدارکِ آزمایشیِ خودامضا — فقط برایِ آزمون؛ هرگز در نصبِ واقعی به کار نرود',
  ],
]);

// ───────────────────────────────────────────────────────────────────────────
// قانون ۲: منابعِ خارجی (الزامِ «فقط ایران»)
// ───────────────────────────────────────────────────────────────────────────
const EXTERNAL_PATTERNS = [
  [/https?:\/\/fonts\.googleapis\.com/g, 'فونتِ گوگل'],
  [/https?:\/\/fonts\.gstatic\.com/g, 'فونتِ گوگل'],
  [/https?:\/\/(cdn\.jsdelivr\.net|unpkg\.com|cdnjs\.cloudflare\.com|cdn\.jsdelivr\.com)/g, 'شبکه‌یِ تحویلِ محتوا'],
  [/<script[^>]+src=["']https?:\/\//g, 'کتاب‌خانه از اینترنت'],
  [/<link[^>]+href=["']https?:\/\/(?!.*(?:schema\.org|w3\.org))/g, 'منبع از اینترنت'],
];

// ───────────────────────────────────────────────────────────────────────────
// قانون ۳: نشانیِ مطلق در کدِ مرورگر
// ───────────────────────────────────────────────────────────────────────────
const ABSOLUTE_HOST = /["'`]https?:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?/g;

/** پرونده‌هایی که فقط رویِ سرور اجرا می‌شوند (قانونِ ۳ درباره‌شان نیست) */
const SERVER_ONLY_FILE =
  /(^|\/)(route|middleware)\.ts$|\/src\/lib\//;

/** پرونده‌هایی که نوشتنِ لاگ در آن‌ها «عملیاتی» است، نه ردِّ اشکال‌زدایی */
const LOGS_ALLOWED = /^apps\/api\/|^scripts\/|-cli\.ts$|\.test\.ts$/;

// ───────────────────────────────────────────────────────────────────────────
// قانون ۴: ردِّ اشکال‌زدایی در مسیرِ تولید
// ───────────────────────────────────────────────────────────────────────────
const DEBUG_PATTERNS = [/console\.(log|debug|info)\(/g, /\bdebugger\b/g];

// ───────────────────────────────────────────────────────────────────────────
// قانون ۶: کارِ ناتمام
// ───────────────────────────────────────────────────────────────────────────
const TODO_PATTERN = /\b(TODO|FIXME|XXX|HACK)\b/g;

let scanned = 0;

for (const file of walk(ROOT)) {
  let content;
  try {
    content = readFileSync(file, 'utf8');
  } catch {
    continue;
  }
  scanned += 1;
  const rel = relative(ROOT, file).split(sep).join('/');
  const lines = content.split('\n');

  // ۱) راز
  //
  // یک نکته‌یِ ظریف: «نشانه‌یِ آغازِ کلید» با «خودِ کلید» یکی نیست. کدی که
  // کلیدِ خصوصی را **تشخیص** می‌دهد (مثلاً گاوصندوقِ گواهی) ناگزیر همان
  // رشته را در یک الگو دارد — و اگر پویشگر آن را راز بشمارد، راهِ درست
  // «پنهان کردنِ الگو» است، که یعنی کدِ بازرسی‌ناپذیر. پس برایِ کلیدِ
  // خصوصی، راز بودن را به **نشانه‌یِ پایان در همان نزدیکی** گره می‌زنیم:
  // رشته‌یِ تنها که کلیدی دنبالش نیست، یک شناسه است، نه یک راز.
  const allowance = SECRET_ALLOWLIST.get(rel) ?? null;
  const isPrivateKeyPattern = (label) => label === 'کلیدِ خصوصی';
  for (const [pattern, label] of SECRET_PATTERNS) {
    lines.forEach((line, i) => {
      pattern.lastIndex = 0;
      let match;
      // eslint-disable-next-line no-cond-assign
      while ((match = pattern.exec(line)) !== null) {
        if (match[0] === '') {
          pattern.lastIndex += 1;
          continue;
        }

        if (isPrivateKeyPattern(label)) {
          const closes = lines
            .slice(i + 1, i + 40)
            .some((next) => new RegExp(PEM_END).test(next));
          if (!closes) return; // نشانه‌یِ تنها = شناسه، نه راز
        }

        // داوری رویِ خودِ رشته است، نه رویِ خط: یک خط می‌تواند هم‌زمان یک
        // رازِ واقعی و یک نامِ دامنه‌یِ نمونه داشته باشد. پیش از این، هر خطی
        // که در آن «example» می‌آمد بخشوده می‌شد — یعنی رازِ واقعی پشتِ یک
        // نشانیِ نمونه پنهان می‌ماند.
        if (looksLikePlaceholder(suspectPart(label, match[0]))) return;

        if (allowance) {
          allowedSecrets.push({ file: rel, line: i + 1, what: label, why: allowance });
          return;
        }

        fail(1, rel, i + 1, `${label} یافت شد`, 'هیچ رازی نباید در مخزن باشد؛ در متغیرِ محیطی بگذار و توکن را باطل کن');
        return; // یک گزارش برای هر خط بس است؛ ادامه فقط خروجی را شلوغ می‌کند
      }
    });
  }

  const isSource = isUnder(file, SOURCE_DIRS);
  const isBrowser = isUnder(file, BROWSER_DIRS);

  if (isSource) {
    // ۲) منبعِ خارجی
    for (const [pattern, label] of EXTERNAL_PATTERNS) {
      lines.forEach((line, i) => {
        pattern.lastIndex = 0;
        if (pattern.test(line)) {
          fail(2, rel, i + 1, `${label}`, 'سایت باید بدونِ اینترنتِ بین‌الملل بالا بیاید؛ منبع را در خودِ پروژه بگذار');
        }
      });
    }

    // ۳) نشانیِ مطلقِ میزبان در کدِ مرورگر
    //
    // دقت: این قانون فقط درباره‌یِ کدی است که واقعاً در مرورگر اجرا می‌شود.
    // route handlerها، کنش‌هایِ سروری و middleware در «سرورِ نکست» اجرا
    // می‌شوند و حق دارند پیش‌فرضِ `process.env` یِ خود را داشته باشند؛
    // آن‌ها تنها جایی‌اند که مجاز به دانستنِ نشانیِ داخلیِ API هستند.
    if (isBrowser && !SERVER_ONLY_FILE.test(rel)) {
      lines.forEach((line, i) => {
        const trimmed = line.trim();
        if (/^(\/\/|\*|\/\*)/.test(trimmed)) return;
        // پیش‌فرضِ خوانده‌شده از محیط، فقط در سرور حل می‌شود
        if (trimmed.includes('process.env')) return;
        ABSOLUTE_HOST.lastIndex = 0;
        if (ABSOLUTE_HOST.test(line)) {
          fail(3, rel, i + 1, 'نشانیِ مطلقِ localhost در کدِ مرورگر', 'مرورگرِ مشتری به localhost دسترسی ندارد؛ نشانیِ نسبی به‌کار ببر');
        }
      });
    }

    // ۴) اشکال‌زداییِ جامانده
    //
    // استثنا: فرآیندِ سرور (apps/api) و ابزارهایِ خطِ فرمان حق دارند
    // گزارشِ راه‌اندازی بنویسند — این «لاگِ عملیاتی» است، نه ردِّ
    // اشکال‌زدایی. آنچه ممنوع است، `console.log` در کتاب‌خانه‌ها و در کدی
    // است که به مرورگر می‌رود.
    if (isSource && !LOGS_ALLOWED.test(rel)) {
      for (const pattern of DEBUG_PATTERNS) {
        lines.forEach((line, i) => {
          pattern.lastIndex = 0;
          if (pattern.test(line)) {
            fail(4, rel, i + 1, line.trim().slice(0, 60), 'ردِّ اشکال‌زدایی در تولید نباید بماند');
          }
        });
      }
    }
  }

  // ۶) کارِ ناتمام (گزارش، نه خطا)
  if (isSource || rel.endsWith('.sql')) {
    lines.forEach((line, i) => {
      TODO_PATTERN.lastIndex = 0;
      if (TODO_PATTERN.test(line)) {
        warn(6, rel, i + 1, line.trim().slice(0, 60), 'کارِ ناتمام در کد');
      }
    });
  }
}

// ───────────────────────────────────────────────────────────────────────────
// قانون ۵: نام‌گذاری و ترتیبِ مهاجرت‌ها
// ───────────────────────────────────────────────────────────────────────────
const MIGRATION_DIR = join(ROOT, 'packages/db/migrations');
const migrations = readdirSync(MIGRATION_DIR)
  .filter((f) => f.endsWith('.sql'))
  .sort();

const seen = new Map();
let expected = 1;
for (const file of migrations) {
  const match = /^(\d{3})_([a-z0-9_]+)\.sql$/.exec(file);
  if (!match) {
    fail(5, `packages/db/migrations/${file}`, 0, 'نامِ پرونده با الگو نمی‌خواند', 'الگو: NNN_name.sql با حروفِ کوچک و زیرخط');
    continue;
  }
  const num = Number(match[1]);
  if (seen.has(num)) {
    fail(5, `packages/db/migrations/${file}`, 0, `شماره‌یِ ${match[1]} تکراری است (${seen.get(num)})`, 'دو مهاجرت با یک شماره، ترتیب را مبهم می‌کند');
  }
  seen.set(num, file);
  if (num !== expected) {
    fail(5, `packages/db/migrations/${file}`, 0, `شماره ${num} است، ${String(expected).padStart(3, '0')} انتظار می‌رفت`, 'شکاف در شماره‌گذاری یعنی مهاجرتی گم شده');
  }
  expected = num + 1;

  // مهاجرتی که یک جدول را بی‌برگشت ویران می‌کند، باید هشدار داشته باشد
  const body = readFileSync(join(MIGRATION_DIR, file), 'utf8');
  if (/DROP TABLE/i.test(body) && !/IF EXISTS/i.test(body)) {
    warn(5, `packages/db/migrations/${file}`, 0, 'DROP TABLE بی‌ IF EXISTS', 'در پایگاهِ مشتری، نبودِ جدول نباید مهاجرت را بشکند');
  }
}

// ───────────────────────────────────────────────────────────────────────────
// گزارش
// ───────────────────────────────────────────────────────────────────────────
const byRule = (list) =>
  list.reduce((acc, item) => {
    (acc[item.rule] ??= []).push(item);
    return acc;
  }, {});

console.log(`\nبازرسیِ ست‌شاپ — ${scanned} پرونده، ${migrations.length} مهاجرت`);
console.log('─'.repeat(72));

if (errors.length === 0) {
  console.log('✅ خطا: صفر');
} else {
  const grouped = byRule(errors);
  for (const rule of Object.keys(grouped).sort()) {
    console.log(`\n❌ قانونِ ${rule} — ${grouped[rule].length} مورد`);
    for (const e of grouped[rule].slice(0, 20)) {
      console.log(`   ${e.file}${e.line ? ':' + e.line : ''}`);
      console.log(`      ${e.text}`);
      console.log(`      ↳ ${e.why}`);
    }
    if (grouped[rule].length > 20) console.log(`   … و ${grouped[rule].length - 20} موردِ دیگر`);
  }
}

// استثناها ساکت نمی‌مانند: هر اجرا، فهرستِ مدارکِ آزمایشی را می‌گوید.
// خطر این نیست که این چند کلید لو بروند؛ خطر این است که کسی کلیدِ واقعیِ
// سازمان را کنارشان بچسباند و کسی نبیند.
if (allowedSecrets.length > 0) {
  const files = [...new Set(allowedSecrets.map((a) => a.file))];
  console.log(`\n⚠️  قانونِ ۱ (استثنایِ آگاهانه) — ${allowedSecrets.length} نشانه در ${files.length} پرونده`);
  for (const file of files) {
    const item = allowedSecrets.find((a) => a.file === file);
    console.log(`   ${file}`);
    console.log(`      ↳ ${item.why}`);
  }
  console.log('   این استثنا فقط برایِ همین پرونده است؛ هر کلیدِ دیگر خطاست.');
}

if (warnings.length > 0) {
  const grouped = byRule(warnings);
  for (const rule of Object.keys(grouped).sort()) {
    console.log(`\n⚠️  قانونِ ${rule} (گزارش) — ${grouped[rule].length} مورد`);
    for (const w of grouped[rule].slice(0, 8)) {
      console.log(`   ${w.file}${w.line ? ':' + w.line : ''} — ${w.text}`);
    }
    if (grouped[rule].length > 8) console.log(`   … و ${grouped[rule].length - 8} موردِ دیگر`);
  }
}

console.log('─'.repeat(72));
console.log(`نتیجه: ${errors.length} خطا، ${warnings.length} هشدار\n`);

process.exit(errors.length > 0 ? 1 : 0);
