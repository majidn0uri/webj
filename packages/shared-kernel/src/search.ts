/**
 * جستجویِ فارسی — فرهنگِ مترادف‌ها و گسترشِ عبارت.
 *
 * چرا این فایل وجود دارد؟ چون کاربرِ ایرانی یک کالا را به ده شکل می‌نویسد:
 *   • با حروفِ عربی: «كابل» به‌جای «کابل»
 *   • با نیم‌فاصله و بی‌فاصله: «شارژر» / «شارژ ر» / «شارژرِ»
 *   • با املایِ گفتاری: «هندزفری» / «هندز فری» / «هندsfree»
 *   • با واژه‌یِ لاتین: «iphone» / «آیفون» / «ايفون»
 *   • با تکواژِ جمع: «قاب‌ها» به‌جای «قاب»
 *
 * نرمال‌سازی (در persian.ts) دسته‌یِ اول و دوم را حل می‌کند. این فایل دسته‌یِ
 * سوم تا پنجم را: «واژه‌ای که کاربر نوشت» به «واژه‌ای که در داده‌ها هست» ترجمه
 * می‌شود، و برعکس.
 *
 * اصل: فرهنگ در پایگاه‌داده هم هست (جدولِ search_synonyms) تا فروشنده بتواند
 * آن را در پنل گسترش دهد؛ این نسخه‌یِ کد، فقط «پیش‌فرضِ کارخانه» است که در
 * نخستین مهاجرت به پایگاه‌داده درج می‌شود.
 */

import { searchKey } from './persian.js';

/**
 * فرهنگِ مترادف: کلید = واژه‌یِ canonical (آنچه در نامِ کالا هست)،
 * مقدار = واژه‌هایی که کاربر ممکن است بنویسد.
 *
 * هر ردیف با داده‌یِ واقعیِ بازارِ لوازمِ جانبیِ موبایلِ ایران نوشته شده،
 * نه با حدس: این‌ها پرتکرارترین نوشته‌هایِ جایگزین در جستجویِ کاربران‌اند.
 */
export const SEARCH_SYNONYMS: Record<string, string[]> = {
  // --- برندها و مدل‌ها (لاتین ↔ فارسی ↔ املایِ گفتاری)
  'اپل': ['apple', 'ayfon', 'آیفون', 'ايفون', 'آيفون'],
  'آیفون': ['iphone', 'ایفون', 'ايفون', 'آيفون', 'اپل'],
  'سامسونگ': ['samsung', 'سامسونگ', 'سامسونق', 'سامسونج', 'گلکسی', 'galaxy'],
  'گلکسی': ['galaxy', 'گلکسی', 'سامسونگ'],
  'شیائومی': ['xiaomi', 'شایومی', 'شیاعومی', 'xiaomi', 'mi', 'پوکو', 'poco'],
  'هواوی': ['huawei', 'هایووی', 'هوآوی', 'آنر', 'honor'],
  'آنر': ['honor', 'هنر', 'هواوی'],
  'نوکیا': ['nokia', 'نوكيا'],
  'ال‌جی': ['lg', 'ال جی', 'الجی'],
  'سونی': ['sony', 'سونی'],
  'موتورولا': ['motorola', 'موتورلا'],
  'ریلمی': ['realme', 'رلمی', 'ریالمی'],

  // --- گونه‌های کالا
  'قاب': ['کاور', 'cover', 'case', 'کیس', 'قاب'],
  'کاور': ['قاب', 'cover', 'case'],
  'محافظ': ['گلس', 'glass', 'پروتکتور', ' protector', 'محافظ', 'محافظ صفحه'],
  'گلس': ['glass', 'گلاس', 'محافظ صفحه', 'محافظ'],
  'شارژر': ['شارجر', 'charger', 'شارژ', 'شارژر', 'آداپتور', 'adapter'],
  'آداپتور': ['adapter', 'اداپتور', 'شارژر'],
  'کابل': ['كابل', 'cable', 'کیبل', 'سیم', 'کابل شارژ', 'lightning', 'تایپ سی', 'type-c'],
  'هندزفری': ['هدفون', 'هندز فری', 'هندسفری', 'هندزفري', 'earphone', 'headphone', 'earbuds', 'ایربادز'],
  'هدفون': ['headphone', 'هندزفری', 'هندز فری'],
  'پاوربانک': ['پاور بنک', 'powerbank', 'پاوربانك', 'شارژر همراه', 'باتری همراه'],
  'اسپیکر': ['speaker', 'بلندگو', 'اسپیکر'],
  'پایه': ['استند', 'stand', ' holder', 'نگهدارنده'],
  'نگهدارنده': ['holder', 'پایه', 'استند'],
  'محافظ لنز': ['لنز گارد', 'camera protector', 'محافظ دوربین'],
  'سیم': ['کابل', 'wire'],
  'فندکی': ['شارژر فندکی', 'car charger', 'شارژر ماشین'],
  'بی‌سیم': ['وایرلس', 'wireless', 'بلوتوثی', 'بلوتوث'],

  // --- ویژگی‌ها
  'ضدضربه': ['ضد ضربه', 'shockproof', 'ضربه گیر'],
  'ضدآب': ['ضد آب', 'waterproof', 'واترپروف'],
  'مات': ['matte', 'مت'],
  'شفاف': ['clear', 'transparent', 'کلیر'],
  'فست': ['fast', 'سریع', 'فست شارژ', 'quick charge'],
  'شارژ': ['شازر', 'charger', 'شارژر'],
  'سیلیکونی': ['سیلیکون', 'silicone', 'ژله‌ای'],
  'چرمی': ['چرم', 'leather'],
  'مگنتی': ['مغناطیسی', 'magnetic', 'مگنت'],
  'اصلی': ['اورجینال', 'original', 'اوریجینال'],
  'هایکپی': ['های کپی', 'high copy', 'کپی'],

  // --- پسوندهایِ مدلِ گوشی: کاربر «۱۳ پرو» می‌نویسد، داده «13 pro» دارد
  //     (و برعکس). بدونِ این ردیف‌ها، رایج‌ترین جستجویِ بازار — «قاب آیفون ۱۳
  //     پرو» — به‌خاطرِ یک واژه هیچ نتیجه‌ای نشان نمی‌داد.
  'pro': ['پرو', 'پروفشنال'],
  'max': ['مکس', 'مگس'],
  'plus': ['پلاس', 'پلص'],
  'ultra': ['اولترا', 'الترا'],
  'mini': ['مینی', 'مينی'],
  'note': ['نوت'],
  'lite': ['لایت'],
  'watt': ['وات', 'w'],
  'mah': ['میلیآمپر', 'میلی امپر', 'میلی‌آمپر'],
};

/**
 * عبارت‌هایِ چندواژه‌ای → تک‌واژه‌یِ canonical.
 *
 * چرا لازم است؟ چون «پاور بانک» دو واژه است و اگر همان‌گونه واکاوی شود،
 * منطقِ «همه‌ی واژه‌ها باید باشند (AND)» به‌دنبالِ کالایی می‌گردد که هم
 * «پاور» در آن باشد و هم «بانک» — و چنین کالایی وجود ندارد. پیش از
 * واکاوی، این عبارت‌ها به یک واژه فشرده می‌شوند.
 */
const PHRASES: Array<[phrase: string, canonical: string]> = [
  ['پاور بنک', 'پاوربانک'],
  ['پاور بانک', 'پاوربانک'],
  ['شارژر همراه', 'پاوربانک'],
  ['باتری همراه', 'پاوربانک'],
  ['هندز فری', 'هندزفری'],
  ['هندزفري', 'هندزفری'],
  ['محافظ صفحه', 'گلس'],
  ['محافظ دوربین', 'محافظلنز'],
  ['لنز گارد', 'محافظلنز'],
  ['ضد ضربه', 'ضدضربه'],
  ['ضد آب', 'ضدآب'],
  ['شارژر فندکی', 'فندکی'],
  ['شارژر ماشین', 'فندکی'],
  ['ال جی', 'الجی'],
  ['های کپی', 'هایکپی'],
  ['نوع سی', 'تایپسی'],
  ['تایپ سی', 'تایپسی'],
  ['type c', 'تایپسی'],
  ['تایپ c', 'تایپسی'],
  ['فست شارژ', 'فست'],
].map(([p, c]) => [searchKey(p ?? ''), searchKey(c ?? '')] as [string, string]);

/**
 * شکل‌هایِ دیگرِ یک عبارتِ مرکب: canonical → عبارت‌هایی که به آن فشرده شده‌اند.
 *
 * چرا لازم است؟ چون ما در هنگامِ جستجو «پاور بانک» را به «پاوربانک» می‌چسبانیم،
 * اما در عنوانِ کالا ممکن است همان واژه جدانویسی شده باشد (و برعکس). اگر فقط
 * شکلِ چسبیده را جستجو کنیم، کاربری که «type c» می‌نویسد کالایی را که عنوانش
 * «کابل تایپ سی» است پیدا نمی‌کند. پس هر دو شکل، هم‌معنیِ هم‌اند.
 */
const PHRASE_FORMS: Record<string, string[]> = (() => {
  const map: Record<string, Set<string>> = {};
  for (const [phrase, canonical] of PHRASES) {
    map[canonical] = map[canonical] ?? new Set<string>();
    map[canonical].add(phrase);
  }
  const out: Record<string, string[]> = {};
  for (const [k, v] of Object.entries(map)) out[k] = [...v];
  return out;
})();

/** نمایِ معکوس: هر واژه‌یِ جایگزین → واژه‌یِ canonical */
const REVERSE: Record<string, string> = (() => {
  const map: Record<string, string> = {};
  for (const [canonical, variants] of Object.entries(SEARCH_SYNONYMS)) {
    for (const variant of variants) {
      map[searchKey(variant)] = canonical;
    }
    map[searchKey(canonical)] = canonical;
  }
  return map;
})();

/** نمایِ مستقیم: هر canonical → همه‌ی واژه‌هایِ هم‌معنی (برای گسترشِ پرس‌وجو) */
const FORWARD: Record<string, string[]> = (() => {
  const map: Record<string, Set<string>> = {};
  const add = (from: string, to: string) => {
    const key = searchKey(from);
    map[key] = map[key] ?? new Set<string>();
    map[key].add(searchKey(to));
  };
  for (const [canonical, variants] of Object.entries(SEARCH_SYNONYMS)) {
    add(canonical, canonical);
    for (const variant of variants) {
      add(canonical, variant);
      add(variant, canonical);
    }
  }
  const out: Record<string, string[]> = {};
  for (const [k, v] of Object.entries(map)) out[k] = [...v];
  return out;
})();

export interface ExpandedQuery {
  /**
   * به‌ازای هر واژه‌یِ پرس‌وجو، یک گروه از واژه‌هایِ هم‌معنی.
   * منطقِ جستجو: درونِ هر گروه «یا» (OR)، میانِ گروه‌ها «و» (AND).
   */
  groups: string[][];
  /** واژه‌هایی که مترادف برایشان پیدا شد — برای نمایش به کاربر («منظورتان … بود؟») */
  applied: Array<{ input: string; matched: string[] }>;
  /** کلِ عبارت پس از نرمال‌سازی */
  normalized: string;
}

/**
 * گسترشِ عبارتِ جستجو.
 *
 * مثال: «شارژر ایفون» → گروه‌های [شارژر، شارجر، charger، آداپتور، …] و
 * [آیفون، iphone، اپل، …]. نتیجه: کالایی که نامش «آداپتور شارژ iPhone» است
 * پیدا می‌شود، بی‌آنکه کاربر املایِ درست را بداند.
 *
 * @param extra مترادف‌هایِ افزوده در پنل (از جدولِ search_synonyms)
 */
export function expandSearchQuery(
  input: string,
  extra: Record<string, string[]> = {},
): ExpandedQuery {
  let normalized = searchKey(input);

  const groups: string[][] = [];
  const applied: Array<{ input: string; matched: string[] }> = [];

  /**
   * مترادف‌هایِ پنل دو جورند و دو جور رفتار می‌کنند — و این تفاوت از عمد است:
   *
   *   • **تک‌واژه** → به گروه افزوده می‌شود: «شارجر» جستجو شد، «شارژر» هم
   *     جوسته می‌شود. نتیجه کم نمی‌شود، فقط زیاد می‌شود.
   *   • **چندواژه** → در خودِ عبارت جایگزین می‌شود (همان کاری که `PHRASESِ`
   *     داخلی می‌کند). اینجا افزودنِ یک واژه به گروه بی‌معنی است، چون کلیدِ
   *     فروشنده یک عبارت است و باید پیش از واکاوی دیده شود — وگرنه هیچ‌وقت
   *     به دستِ حلقهِٔ واژگان نمی‌رسد و مترادف «ثبت شد ولی اثر نکرد» می‌شود.
   */
  const phraseExtra = new Map<string, string>();
  const tokenExtra: Record<string, string[]> = {};
  for (const [rawTerm, values] of Object.entries(extra)) {
    const term = searchKey(rawTerm);
    if (!term) continue;
    const canonical = (values ?? []).map((v) => searchKey(v)).filter((v) => v.length > 0);
    if (term.includes(' ') && canonical.length > 0) {
      phraseExtra.set(term, [...new Set(canonical)].join(' '));
    } else {
      tokenExtra[term] = [...(tokenExtra[term] ?? []), ...(values ?? [])];
    }
  }

  // ۱) عبارت‌هایِ چندواژه‌ای را پیش از واکاوی فشرده کن (بلندترین أول)
  //
  // چرا یک‌بارگذر و با یک الگویِ جایگزین‌ها؟ چون جدولِ پنل **دوطرفه** است
  // («زبلوف قلقوف → کابل زربوف» و «کابل زربوف → زبلوف قلقوف» هر دو ثبت
  // می‌شوند، تا مشتری از هر دو سو به نتیجه برسد). اگر جایگزینی رویِ متنِ
  // جایگزین‌شده دوباره اجرا شود، عبارت اول به دومی بدل می‌شود و دومی بی‌درنگ
  // به اول برمی‌گردد — یعنی دقیقاً همان «مترادف ثبت شد و هیچ نشد» که این
  // بخش قرار بود حل کند. یک `replace` با الگویِ جایگزین‌ها هیچ متنِ تازه‌ای را
  // بازخوانی نمی‌کند، پس چرخه ممکن نیست. (فرهنگِ داخلی یک‌طرفه است و با حلقهٔ
  // قبلی هم درست کار می‌کرد؛ ولی قاعدهٔ امن برایِ هر دو یکی است.)
  const byPhrase = new Map<string, string>(PHRASES);
  for (const [phrase, canonical] of phraseExtra) byPhrase.set(phrase, canonical); // پنل برنده است
  const phraseKeys = [...byPhrase.keys()]
    .filter((p) => p.length >= 3)
    .sort((a, b) => b.length - a.length || (a < b ? -1 : 1));
  if (phraseKeys.length > 0) {
    const pattern = new RegExp(phraseKeys.map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'), 'g');
    const used = new Set<string>();
    normalized = normalized.replace(pattern, (match) => {
      const value = byPhrase.get(match);
      if (!value || value === match) return match;
      used.add(match);
      return value;
    });
    for (const match of used) applied.push({ input: match, matched: [byPhrase.get(match) as string] });
  }

  const tokens = normalized.split(' ').filter((t) => t.length > 1);

  for (const token of tokens) {
    const fromExtra = (tokenExtra[token] ?? []).map((t) => searchKey(t));
    const fromBuiltin = FORWARD[token] ?? [];
    // اگر خودِ واژه یک واژه‌یِ جایگزین باشد، canonical را هم اضافه کن
    const canonical = REVERSE[token];

    const set = new Set<string>([token]);
    for (const t of fromBuiltin) set.add(t);
    for (const t of fromExtra) set.add(t);
    if (canonical) set.add(searchKey(canonical));

    // عبارتِ مرکب: شکلِ جدانویسی‌شده را هم به گروه بیفزا («تایپسی» ↔ «تایپ سی»)
    for (const t of [...set]) {
      for (const form of PHRASE_FORMS[t] ?? []) set.add(form);
    }

    // جمعِ بسته‌شده و بنِ فعل: «قاب‌ها» → «قاب»، «شارژرها» → «شارژر»
    // این کار با حذفِ «ها» و «های» از پایان انجام می‌شود، نه با ریشه‌یابیِ
    // کامل (که برایِ فارسی در دسترس نیست).
    for (const t of [...set]) {
      if (t.length > 3 && (t.endsWith('ها') || t.endsWith('های'))) {
        set.add(t.replace(/(های|ها)$/, ''));
      }
    }

    const group = [...set].filter((t) => t.length > 1);
    groups.push(group);
    if (group.length > 1) applied.push({ input: token, matched: group.filter((g) => g !== token) });
  }

  return { groups, applied, normalized };
}

/** واژه‌یِ canonical یک واژه — برای نمایشِ «منظورتان این بود؟» */
export function canonicalOf(token: string): string | null {
  return REVERSE[searchKey(token)] ?? null;
}
