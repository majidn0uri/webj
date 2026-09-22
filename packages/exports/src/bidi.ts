import { createRequire } from 'node:module';

/**
 * شکل‌دهی و ترتیبِ دیداریِ فارسی/عربی برایِ پی‌دی‌اف.
 * ============================================================================
 *
 * مسئله، در یک جمله: **پی‌دی‌اف جهتِ متن نمی‌فهمد.** در پی‌دی‌اف هیچ مفهومی به
 * نامِ «راست‌چین» یا «چپ‌چین» وجود ندارد؛ فقط مختصات هست و نگاره‌هایی که یکی‌یکی
 * چیده می‌شوند. پس هر کس که بخواهد فارسی را در پی‌دی‌اف بنویسد، باید خودش
 * دو کارِ جداگانه انجام دهد:
 *
 *   ۱. **شکل‌دهی (Shaping):** «سـت شاپ»ِ منطقی باید به نگاره‌هایِ پیوسته‌یِ
 *      آغازین/میانی/پایانی تبدیل شود. این کار را `fontkit` (همان موتوری که
 *      `pdfkit` هم از آن استفاده می‌کند) انجام می‌دهد.
 *
 *   ۲. **ترتیبِ دیداری (Bidi reorder):** نگاره‌ها باید به ترتیبی که چشم
 *      می‌خواند رویِ کاغذ چیده شوند، نه به ترتیبِ حافظه. این کارِ ماست.
 *
 * چرا اینجا و نه با یک کتابخانه‌یِ آماده؟ چون اندازه‌گیری نشان داد (گزارش در
 * `docs/khoruji-excel-pdf.md`) که `pdfkit` خروجی‌اش وارونه است:
 * «فاکتور فروش» می‌شود «فروشفاکتور» و «۱٬۲۵۰٬۰۰۰» می‌شود «۰۰۰٬۰۵۲٬۱».
 *
 * و یک نکته‌یِ ظریف که در کمین است: `fontkit.layout` خودش در انتها، اگر جهتِ
 * خط راست‌چین باشد، **کلِ** نگاره‌ها را وارونه می‌کند
 * (`glyphRun.direction === 'rtl' → glyphs.reverse()`). این وارونگی برایِ
 * متنِ یک‌دستِ فارسی درست است، اما برایِ هر چه در میانش باشد — عدد، لاتین،
 * تاریخ — غلط است: «قاب iPhone 15 پرو» می‌شود «enohPi». راهِ درست این است که
 * شکل‌دهی را با جهتِ **چپ‌چین** بخواهیم (تا نگاره‌ها به ترتیبِ منطقی برگردند،
 * و ثابت کردیم که شکلِ نگاره‌ها با حالتِ راست‌چین یکی است) و خودمان، تکه‌تکه،
 * ترتیبِ دیداری را بسازیم.
 */

/* ---------------------------------- انواع --------------------------------- */

export interface ShapedGlyph {
  /** شناسه‌یِ نگاره در قلمِ زیرمجموعه (CID) */
  gid: number;
  /** پیشروی به هزارمِ ام (واحدِ متنِ پی‌دی‌اف)، یعنی آماده برایِ Tm/Td */
  advance: number;
  /** جابجاییِ عمودی (برایِ اعراب و نشانه‌هایِ ترکیبی) */
  dy: number;
  /** کدهایِ یونیکدِ اصلی — برایِ نگاشتِ ToUnicode و در نتیجه رونوشت‌برداری */
  codePoints: number[];
}

/* --------------------------------- موتورِ دو‌سویه ------------------------ */

interface BidiJs {
  getEmbeddingLevels(text: string, baseDir: 'ltr' | 'rtl'): {
    /** ترازِ نهشتیِ هر نویسه، با کلیدِ اندیس (رشته) — برایِ سرعت در آن کتابخانه */
    levels: Record<string, number>;
  };
}

let cachedBidi: BidiJs | null = null;

/**
 * بارگزاریِ همگامِ `bidi-js`.
 *
 * چرا همگام؟ چون اگر اینجا ناهمگام می‌شد، **همه‌یِ** مشتقات هم ناهمگام می‌شدند:
 * `shapeVisual`، `measureText`، `PdfPage.text` و در نهایت کلِ ساختِ گزارش.
 * ساختنِ یک فاکتور نباید به رقصِ Promiseها تبدیل شود. `bidi-js` بسته‌یِ سی‌جی‌اس
 * است، پس با `createRequire` بی‌دردسر و همان لحظه بار می‌شود.
 */
function bidiEngine(): BidiJs {
  if (!cachedBidi) {
    const require = createRequire(import.meta.url);
    const factory = require('bidi-js') as () => BidiJs;
    cachedBidi = factory();
  }
  return cachedBidi;
}

/* ---------------------------------- انواع --------------------------------- */

type FontLike = {
  unitsPerEm: number;
  layout(text: string, features?: unknown, script?: unknown, language?: unknown, dir?: 'ltr' | 'rtl'): {
    glyphs: Array<{ id: number; advanceWidth?: number; codePoints?: number[] }>;
    positions?: Array<{ xAdvance?: number; yOffset?: number }>;
  };
};

/* ------------------------------- آینه‌سازی -------------------------------- */

/**
 * آینه‌یِ نگاره‌ها (Bidi Mirroring).
 *
 * کمانه‌ها جهت دارند. در یک خطِ راست‌چین، پرانتزِ بازِ منطقی باید به شکلِ
 * پرانتزِ بسته دیده شود — وگرنه «(تخفیف)» به صورتِ «)تخفیف(» چاپ می‌شود که
 * آشکارا غلط است. همین است که مرورگرها هم می‌کنند.
 */
const MIRRORED = new Map<string, string>([
  ['(', ')'],
  [')', '('],
  ['[', ']'],
  [']', '['],
  ['{', '}'],
  ['}', '{'],
  ['<', '>'],
  ['>', '<'],
  ['«', '»'],
  ['»', '«'],
  ['‹', '›'],
  ['›', '‹'],
  ['〈', '〉'],
  ['〉', '〈'],
]);

function mirror(text: string): string {
  let out = '';
  for (const ch of text) out += MIRRORED.get(ch) ?? ch;
  return out;
}

function unmirrorCodePoints(codePoints: number[]): number[] {
  return codePoints.map((cp) => {
    const ch = String.fromCodePoint(cp);
    const back = MIRRORED.get(ch);
    return back ? back.codePointAt(0)! : cp;
  });
}

/* ------------------------------ تکه‌بندیِ دو‌سویه -------------------------- */

export interface Run {
  text: string;
  /** آیا این تکه در ترتیبِ دیداری باید وارونه شود؟ */
  rtl: boolean;
}

/**
 * حافظه‌یِ تکه‌ها.
 *
 * چرا؟ چون یک گزارشِ هزار سطری هزار بار «جمع کل» و «تعداد» و «مبلغ» را
 * تکه‌بندی می‌کند و الگوریتمِ UAX#9 برایِ هر کدام باید کلِ رشته را دور بزند.
 * برچسب‌ها در گزارش تکرار می‌شوند، پس این حافظه بسیاری از کارها را حذف
 * می‌کند. سقف دارد تا حافظه‌یِ سرور را نبلعد (یک سندِ بسیار بزرگ با متن‌هایِ
 * یکتا، حافظه را پر نکند).
 */
const RUN_CACHE_LIMIT = 4000;
const runCache = new Map<string, Run[]>();


/**
 * تکه‌بندیِ هم‌جهتِ رشته بر پایه‌یِ الگوریتمِ استانداردِ یونیکد (UAX#9).
 *
 * تقسیمِ کار: یافتنِ مرزِ تکه‌ها را `bidi-js` انجام می‌دهد (الگوریتمِ پیچیده‌ای
 * است با ده‌ها قانون برایِ نویسه‌هایِ خنثی و عدد و کمانه؛ بازنویسی‌اش هم خطا
 * می‌آورد و هم لازم نیست). اما `bidi-js` **ترتیبِ دیداری نمی‌سازد**: خروجی‌اش
 * تکه‌هایی به ترتیبِ منطقی است که باید خودمان وارونه‌شان کنیم.
 */
export function directionalRuns(text: string, baseDir: 'rtl' | 'ltr'): Run[] {
  if (text.length === 0) return [];

  const key = `${baseDir}|${text}`;
  const hit = runCache.get(key);
  if (hit) return hit;

  const bidi = bidiEngine();
  const levels = bidi.getEmbeddingLevels(text, baseDir).levels;
  const parity: number[] = [];

  for (let i = 0; i < text.length; i += 1) {
    const level = levels[String(i)] ?? levels[i] ?? (baseDir === 'rtl' ? 1 : 0);
    parity.push(level % 2);
  }

  const runs: Run[] = [];
  let start = 0;
  for (let i = 1; i <= text.length; i += 1) {
    if (i === text.length || parity[i] !== parity[start]) {
      runs.push({ text: text.slice(start, i), rtl: parity[start] === 1 });
      start = i;
    }
  }

  if (runCache.size >= RUN_CACHE_LIMIT) runCache.clear();
  runCache.set(key, runs);
  return runs;
}

/**
 * ترتیبِ دیداریِ تکه‌ها: برایِ بندِ راست‌چین، تکه‌ها وارونه می‌شوند (آخرین تکه‌یِ
 * منطقی، چپ‌ترین تکه‌یِ دیداری است).
 */
export function toVisualRuns(text: string, baseDir: 'rtl' | 'ltr'): Run[] {
  const runs = directionalRuns(text, baseDir);
  return baseDir === 'rtl' ? [...runs].reverse() : runs;
}

/**
 * معادلِ دیداریِ یک رشته (فقط برایِ آزمون و خطایابی).
 *
 * این تابع همان چیزی را برمی‌گرداند که باید رویِ کاغذ دیده شود؛ نه برایِ
 * ترسیم، برایِ این که بتوان در آزمون‌ها نوشت:
 *   `expect(await visualString('مبلغ: ۱٬۲۵۰٬۰۰۰ ریال')).toBe('لایر ۱٬۲۵۰٬۰۰۰ :غلبم')`
 */
export function visualString(text: string, baseDir: 'rtl' | 'ltr' = 'rtl'): string {
  const runs = toVisualRuns(text, baseDir);
  let out = '';
  for (const run of runs) {
    out += run.rtl ? [...mirror(run.text)].reverse().join('') : run.text;
  }
  return out;
}

/* ------------------------------ شکل‌دهیِ نهایی ---------------------------- */

/**
 * شکل‌دهی و چینشِ دیداریِ یک رشته: خروجی آماده‌یِ چاپ است.
 *
 * شکل‌دهی **درونِ هر تکه** انجام می‌شود، نه رویِ کلِ رشته. آیا این درست است؟
 * بله — و دلیلش مهم است: مرزِ دو تکه همیشه جایی است که جهت عوض می‌شود، یعنی
 * همسایه‌ای که حرفِ فارسی در دو سویِ مرز می‌بیند همان است که در رشته‌یِ کامل
 * می‌دید؛ چون عدد و لاتین و فاصله هیچ‌کدام به حرفِ پیشین نمی‌چسبند و شکلِ
 * آغازین/میانی/پایانی را عوض نمی‌کنند. پس بریدنِ رشته به تکه، شکل‌دهی را
 * خراب نمی‌کند.
 */
/**
 * حافظه‌یِ شکل‌دهی، جدا برایِ هر قلم.
 *
 * چرا؟ چون اندازه گرفتنِ یک سلول و سپس چاپ کردنِ همان سلول یعنی دو بار
 * شکل‌دهیِ یک رشته. در یک گزارشِ بزرگ، این یعنی دو برابر کارِ بی‌فایده.
 * کلید شاملِ خودِ رشته است و حافظه با یک `WeakMap` به قلم بسته شده تا
 * با آزاد شدنِ قلم، خودبه‌خود پاک شود.
 */
const SHAPE_CACHE_LIMIT = 4000;
const SHAPE_CACHE_MAX_TEXT = 240;
const shapeCache = new WeakMap<object, Map<string, ShapedGlyph[]>>();

export function shapeVisual(text: string, font: FontLike, baseDir: 'rtl' | 'ltr' = 'rtl'): ShapedGlyph[] {
  const cacheable = text.length > 0 && text.length <= SHAPE_CACHE_MAX_TEXT;
  let cache: Map<string, ShapedGlyph[]> | undefined;
  if (cacheable) {
    cache = shapeCache.get(font);
    if (!cache) {
      cache = new Map();
      shapeCache.set(font, cache);
    }
    const hit = cache.get(`${baseDir}|${text}`);
    if (hit) return hit;
  }

  const scale = 1000 / font.unitsPerEm;
  const out: ShapedGlyph[] = [];

  for (const run of toVisualRuns(text, baseDir)) {
    // آینه‌سازی پیش از شکل‌دهی: نگاره‌یِ درست انتخاب می‌شود...
    const source = run.rtl ? mirror(run.text) : run.text;
    const shaped = font.layout(source, undefined, undefined, undefined, 'ltr');
    const glyphs = shaped.glyphs ?? [];
    const positions = shaped.positions ?? [];

    const items: ShapedGlyph[] = glyphs.map((glyph, i) => {
      const advance = (positions[i]?.xAdvance ?? glyph.advanceWidth ?? 0) * scale;
      const raw = glyph.codePoints ?? [];
      // نیم‌فاصله (ZWNJ) در قلم نگاره‌یِ ویژه‌ای ندارد و `fontkit` آن را با
      // نگاره‌یِ فاصله نشان می‌دهد — اما پیشروی‌اش صفر است. اگر نگاره‌یِ
      // فاصله با پیشرویِ صفر دیدیم، یعنی نیم‌فاصله: نویسه‌یِ اصلی را برمی‌
      // گردانیم تا رونوشت‌برداری از پی‌دی‌اف «ست‌شاپ» را «ست شاپ» نکند.
      const codePoints =
        raw.length === 1 && raw[0] === 0x20 && advance === 0
          ? [0x200c]
          : run.rtl
            ? unmirrorCodePoints(raw)
            : [...raw];

      return {
        gid: glyph.id,
        advance,
        dy: (positions[i]?.yOffset ?? 0) * scale,
        // رونوشت‌برداری باید همان نویسه‌یِ اصلی را بدهد، نه آینه‌اش را.
        codePoints,
      };
    });

    if (run.rtl) items.reverse();
    out.push(...items);
  }

  if (cacheable && cache) {
    if (cache.size >= SHAPE_CACHE_LIMIT) cache.clear();
    cache.set(`${baseDir}|${text}`, out);
  }

  return out;
}

/** پهنایِ رشته به نقطه (pt) — بی‌نیاز از ترسیم */
export function measureText(text: string, font: FontLike, size: number, baseDir: 'rtl' | 'ltr' = 'rtl'): number {
  const glyphs = shapeVisual(text, font, baseDir);
  let width = 0;
  for (const glyph of glyphs) width += glyph.advance;
  return (width / 1000) * size;
}
