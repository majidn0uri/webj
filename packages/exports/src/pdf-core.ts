import { deflateSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';

import * as fontkit from 'fontkit';
import type { Font } from 'fontkit';

import { shapeVisual, type ShapedGlyph } from './bidi.js';

/**
 * نوشتنِ پی‌دی‌اف — لایه‌یِ زیرین.
 *
 * چرا نوشتنِ پی‌دی‌اف به دستِ خودمان و نه یک کتاب‌خانه‌یِ آماده؟ چون هیچ
 * کتاب‌خانه‌یِ رایجی «فارسیِ درست» را در پی‌دی‌اف نمی‌نویسد: پی‌دی‌اف
 * جهتِ متن نمی‌فهمد و شکل‌دهیِ حروف را هم به خودِ قلم می‌سپارد، اما
 * **ترتیبِ دیداری** را نه. نتیجه در کتاب‌خانه‌هایِ آماده این است که
 * «فاکتور فروش» به صورتِ «شورف روتکاف» چاپ می‌شود. اینجا آن ترتیب را
 * خودمان می‌سازیم (بخشِ `bidi.ts`) و نگاره‌ها را یکی‌یکی با جایگاهِ دقیق
 * می‌نشانیم.
 *
 * در عوض، از هرچه که کتاب‌خانه‌ها درست انجام می‌دهند استفاده کرده‌ایم:
 * `fontkit` برایِ خواندنِ قلم، شکل‌دهی، و **زیرمجموعه‌سازی** (فقط نگاره‌هایِ
 * به‌کاررفته واردِ پرونده می‌شوند؛ یک فاکتور به جایِ ۲۴۰ کیلوبایت، حدودِ ۲۰
 * کیلوبایت است).
 */

/** اندازه‌یِ برگه‌یِ A4 به نقطه (pt) */
export const A4 = { width: 595.28, height: 841.89 } as const;

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

export const INK: Rgb = { r: 0.09, g: 0.11, b: 0.16 };
export const MUTED: Rgb = { r: 0.42, g: 0.45, b: 0.52 };
export const BRAND: Rgb = { r: 0.11, g: 0.42, b: 0.85 };
export const LINE: Rgb = { r: 0.85, g: 0.87, b: 0.9 };
export const HEAD_BG: Rgb = { r: 0.95, g: 0.96, b: 0.98 };
export const ZEBRA: Rgb = { r: 0.98, g: 0.985, b: 0.99 };

function num(value: number): string {
  // سه رقمِ اعشار برایِ پی‌دی‌اف کافی است و از رشدِ بی‌رویه‌یِ پرونده جلو می‌کند
  return (Math.round(value * 1000) / 1000).toString();
}

/** رنگ به عملگرِ پی‌دی‌اف */
function fill(color: Rgb): string {
  return `${num(color.r)} ${num(color.g)} ${num(color.b)} rg`;
}

function stroke(color: Rgb): string {
  return `${num(color.r)} ${num(color.g)} ${num(color.b)} RG`;
}

/** شناسه‌یِ قلم در منابعِ برگه */
type FontRole = 'body' | 'bold' | 'medium';

const FONT_FILES: Record<FontRole, string> = {
  body: 'Vazirmatn-Regular.ttf',
  bold: 'Vazirmatn-Bold.ttf',
  medium: 'Vazirmatn-Medium.ttf',
};

const ASSET_DIR = fileURLToPath(new URL('../assets/', import.meta.url));

/**
 * یک قلمِ نشانده‌شده در پرونده.
 *
 * زیرمجموعه‌سازی اینجا انجام می‌شود: هر نگاره نخستین بار که به کار می‌رود
 * واردِ زیرمجموعه می‌شود و شناسه‌یِ تازه می‌گیرد. پس پرونده‌یِ پایانی فقط
 * نگاره‌هایی را دارد که واقعاً چاپ شده‌اند.
 */
class EmbeddedFont {
  readonly font: Font;
  private readonly subset: ReturnType<Font['createSubset']>;
  private readonly widths = new Map<number, number>();
  private readonly unicode = new Map<number, number[]>();

  constructor(path: string) {
    this.font = fontkit.openSync(path) as Font;
    this.subset = this.font.createSubset();
  }

  get scale(): number {
    return 1000 / this.font.unitsPerEm;
  }

  get ascentEm(): number {
    return (this.font.ascent / this.font.unitsPerEm) * 1000;
  }

  get descentEm(): number {
    return (this.font.descent / this.font.unitsPerEm) * 1000;
  }

  /** ثبتِ یک نگاره و گرفتنِ شناسه‌اش در زیرمجموعه */
  cidFor(gid: number, advance: number, codePoints: number[]): number {
    const cid = this.subset.includeGlyph(gid) as number;
    this.widths.set(cid, Math.round(advance));
    if (!this.unicode.has(cid) && codePoints.length > 0) this.unicode.set(cid, codePoints);
    return cid;
  }

  /** پهنایِ ثبت‌شده‌یِ یک شناسه (همان که در آرایه‌یِ W نوشته می‌شود) */
  widthOf(cid: number): number {
    return this.widths.get(cid) ?? 0;
  }

  /** آرایه‌یِ W (پهناها) در قالبِ استانداردِ پی‌دی‌اف */
  widthsArray(): string {
    const cids = [...this.widths.keys()].sort((a, b) => a - b);
    const parts: string[] = [];
    let rangeStart: number | null = null;
    let range: number[] = [];

    const flush = (): void => {
      if (rangeStart === null) return;
      parts.push(`${rangeStart} [${range.map((w) => String(w)).join(' ')}]`);
      rangeStart = null;
      range = [];
    };

    for (const cid of cids) {
      if (rangeStart === null) {
        rangeStart = cid;
        range = [this.widths.get(cid) ?? 0];
        continue;
      }
      if (cid === rangeStart + range.length) {
        range.push(this.widths.get(cid) ?? 0);
      } else {
        flush();
        rangeStart = cid;
        range = [this.widths.get(cid) ?? 0];
      }
    }
    flush();
    return `[${parts.join(' ')}]`;
  }

  /** نقشه‌یِ ToUnicode — برایِ اینکه متنِ پی‌دی‌اف رونوشت‌برداری و جست‌وجو شود */
  toUnicode(): string {
    const lines: string[] = [];
    for (const [cid, points] of [...this.unicode.entries()].sort((a, b) => a[0] - b[0])) {
      const hex = points
        .map((p) => p.toString(16).padStart(4, '0'))
        .join('');
      lines.push(`<${cid.toString(16).padStart(4, '0')}> <${hex}>`);
    }
    const count = lines.length;
    return [
      '/CIDInit /ProcSet findresource begin',
      '12 dict begin',
      'begincmap',
      '/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def',
      '/CMapName /Adobe-Identity-UCS def',
      '/CMapType 2 def',
      '1 begincodespacerange',
      '<0000> <FFFF>',
      'endcodespacerange',
      count > 0 ? `${count} beginbfchar` : '0 beginbfchar',
      ...lines,
      'endbfchar',
      'endcmap',
      'CMapName currentdict /CMap defineresource pop',
      'end',
      'end',
    ].join('\n');
  }

  bytes(): Buffer {
    return this.subset.encode() as unknown as Buffer;
  }

  metrics() {
    const scale = this.scale;
    return {
      ascent: this.font.ascent * scale,
      descent: this.font.descent * scale,
      capHeight: (this.font.capHeight || this.font.ascent) * scale,
      xHeight: (this.font.xHeight || 0) * scale,
      bbox: [
        this.font.bbox.minX * scale,
        this.font.bbox.minY * scale,
        this.font.bbox.maxX * scale,
        this.font.bbox.maxY * scale,
      ],
      italicAngle: this.font.italicAngle ?? 0,
      postscriptName: (this.font.postscriptName ?? 'SetShopFont').replace(/[^\x20-\x7E]/g, ''),
    };
  }
}

/** یک برگه: سطحی برایِ ترسیم با مبدأ در بالا-راست */
export class PdfPage {
  private readonly ops: string[] = [];

  constructor(
    readonly width: number,
    readonly height: number,
    private readonly fonts: Map<FontRole, EmbeddedFont>,
    private readonly ensure: (role: FontRole) => EmbeddedFont,
  ) {}

  /** قلم را می‌خواهد؛ اگر هنوز بار نشده، همان لحظه بار می‌شود */
  private font(role: FontRole): EmbeddedFont {
    return this.fonts.get(role) ?? this.ensure(role);
  }

  /** مستطیلِ پر یا توخالی */
  rect(
    x: number,
    yTop: number,
    width: number,
    height: number,
    options: { fill?: Rgb; stroke?: Rgb; lineWidth?: number } = {},
  ): void {
    const y = this.height - yTop - height;
    if (options.stroke) this.ops.push(num(options.lineWidth ?? 0.5), stroke(options.stroke));
    if (options.fill) this.ops.push(fill(options.fill));
    this.ops.push(`${num(x)} ${num(y)} ${num(width)} ${num(height)} re`);
    this.ops.push(options.fill && options.stroke ? 'B' : options.fill ? 'f' : 'S');
  }

  /** خطِ افقی (پرکاربردترین خط در جدول) */
  hline(x1: number, x2: number, yTop: number, color: Rgb = LINE, lineWidth = 0.5): void {
    const y = this.height - yTop;
    this.ops.push(num(lineWidth), 'w', stroke(color), `${num(x1)} ${num(y)} m`, `${num(x2)} ${num(y)} l`, 'S');
  }

  /**
   * نوشتنِ متن.
   *
   * `x` بسته به `align` است: در راست‌چین، **لبه‌یِ راست**ِ متن؛ در
   * چپ‌چین، لبه‌یِ چپ. و `yTop` بالایِ خط است، نه پایه‌اش — چون در
   * چیدمانِ سند انسان به «بالایِ سطر» فکر می‌کند، نه به پایه‌یِ حروف.
   */
  text(
    value: string,
    x: number,
    yTop: number,
    options: {
      size?: number;
      role?: FontRole;
      color?: Rgb;
      align?: 'right' | 'left' | 'center';
      dir?: 'rtl' | 'ltr';
      /** چرخش به رادیان (پادساعت‌گرد) — برایِ نشانِ رویِ سند (مثلِ «پیش‌نویس») */
      rotate?: number;
    } = {},
  ): { width: number; height: number } {
    const size = options.size ?? 10;
    const role = options.role ?? 'body';
    const align = options.align ?? (options.dir === 'ltr' ? 'left' : 'right');
    const dir = options.dir ?? 'rtl';
    if (value.length === 0) return { width: 0, height: size * 1.5 };
    const font = this.font(role);

    const glyphs: ShapedGlyph[] = shapeVisual(value, font.font, dir);
    const total = glyphs.reduce((sum, g) => sum + g.advance, 0);
    const widthPt = (total / 1000) * size;
    const startX = align === 'right' ? x - widthPt : align === 'center' ? x - widthPt / 2 : x;
    const baseline = yTop + (font.ascentEm / 1000) * size;
    const y = this.height - baseline;

    const angle = options.rotate ?? 0;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);

    this.ops.push(fill(options.color ?? INK), 'BT', `/${fontName(role)} ${num(size)} Tf`);

    // دسته‌بندیِ نگاره‌ها: نگاره‌هایِ هم‌ردیف (بی‌جابجاییِ عمودی و با همان
    // پهنایِ ثبت‌شده در آرایه‌یِ W) در یک رشته‌یِ Tj نوشته می‌شوند، نه با یک
    // ماتریس برایِ هر نگاره. چرا؟ چون برایِ هر نگاره یک `Tm` نوشتن، اندازه‌یِ
    // پرونده را چند برابر می‌کند (گزارشِ دو هزار سطری ۸۵۰ کیلوبایت می‌شد،
    // اکنون کمتر از یک‌سومِ آن است) و خواننده‌ها هم کندتر می‌شوند. استثنا
    // دو مورد است: نگاره‌هایِ نشانه (اعراب) که جابجاییِ عمودی دارند، و
    // نگاره‌ای که پهنایش از کرنینگ اثر گرفته و با پهنایِ قلم یکی نیست.
    let cx = startX;
    let cy = y;
    let batch: string[] = [];
    let batchX = cx;
    let batchY = cy;

    const flush = (): void => {
      if (batch.length === 0) return;
      this.ops.push(`1 0 0 1 ${num(batchX)} ${num(batchY)} Tm`, `<${batch.join('')}> Tj`);
      batch = [];
    };

    for (const glyph of glyphs) {
      const cid = font.cidFor(glyph.gid, glyph.advance, glyph.codePoints);
      const hex = cid.toString(16).padStart(4, '0');
      const gy = cy - (glyph.dy / 1000) * size;
      const step = (glyph.advance / 1000) * size;
      const canBatch =
        angle === 0 &&
        glyph.dy === 0 &&
        Math.abs(font.widthOf(cid) - glyph.advance) < 0.5;

      if (canBatch) {
        if (batch.length === 0) {
          batchX = cx;
          batchY = gy;
        }
        batch.push(hex);
      } else {
        flush();
        if (angle === 0) {
          this.ops.push(`1 0 0 1 ${num(cx)} ${num(gy)} Tm`, `<${hex}> Tj`);
        } else {
          // ماتریسِ چرخان: اندازه‌یِ قلم درایه‌هایِ مقیاس است و جهتِ پیشروی،
          // همان بُردارِ (cos, sin) — متن رویِ خطِ چرخیده می‌خزد، نه رویِ افق.
          this.ops.push(
            `${num(cos * size)} ${num(sin * size)} ${num(-sin * size)} ${num(cos * size)} ${num(cx)} ${num(gy)} Tm`,
            `<${hex}> Tj`,
          );
        }
      }

      cx += step * cos;
      cy += step * sin;
    }
    flush();

    this.ops.push('ET');
    return { width: widthPt, height: size * 1.5 };
  }

  /** اندازه‌گیریِ متن بی‌ترسیم — برایِ ستون‌بندی و تراز */
  measure(value: string, size: number, role: FontRole = 'body', dir: 'rtl' | 'ltr' = 'rtl'): number {
    if (value.length === 0) return 0;
    const font = this.font(role);
    const glyphs = shapeVisual(value, font.font, dir);
    return (glyphs.reduce((sum, g) => sum + g.advance, 0) / 1000) * size;
  }

  /** درجِ یک دستورِ خام — برایِ نیازهایی که هنوز رابط ندارند */
  raw(operator: string): void {
    this.ops.push(operator);
  }

  /** بستنِ جریانِ محتوا */
  stream(): Buffer {
    return deflateSync(Buffer.from(this.ops.join('\n'), 'latin1'));
  }
}

function fontName(role: FontRole): string {
  return role === 'bold' ? 'F2' : role === 'medium' ? 'F3' : 'F1';
}

/** کلاسِ اصلی: ساختِ یک پرونده‌یِ پی‌دی‌اف */
export class PdfWriter {
  private readonly pages: PdfPage[] = [];
  private readonly objects: string[] = [];
  private readonly fonts = new Map<FontRole, EmbeddedFont>();

  constructor(
    private readonly options: {
      width?: number;
      height?: number;
      margin?: number;
      title?: string;
      author?: string;
    } = {},
  ) {}

  get pageWidth(): number {
    return this.options.width ?? A4.width;
  }

  get pageHeight(): number {
    return this.options.height ?? A4.height;
  }

  get margin(): number {
    return this.options.margin ?? 36;
  }

  /** پهنایِ ناحیه‌یِ محتوا */
  get contentWidth(): number {
    return this.pageWidth - this.margin * 2;
  }

  /**
   * برگه‌ها — برایِ نوشتنِ پانویس (شماره‌یِ «صفحه ۱ از ۳») پس از پایانِ چیدمان.
   *
   * چرا پس از پایان؟ چون تا زمانی که چیدمان تمام نشود، شمارِ برگه‌ها را
   * نمی‌دانیم؛ و شمارِ برگه باید در همه‌یِ برگه‌ها چاپ شود.
   */
  get pageList(): readonly PdfPage[] {
    return this.pages;
  }

  addPage(): PdfPage {
    const page = new PdfPage(this.pageWidth, this.pageHeight, this.fonts, (role) => this.ensureFont(role));
    this.pages.push(page);
    return page;
  }

  /**
   * بارگزاریِ تنبلِ قلم.
   *
   * چرا تنبل؟ چون یک سند ممکن است فقط قلمِ معمولی بخواهد؛ بار کردنِ
   * بی‌قیدِ هر سه قلم یعنی خواندن و واکاویِ ۳۶۰ کیلوبایت برایِ چیزی که
   * به کار نمی‌رود.
   */
  private ensureFont(role: FontRole): EmbeddedFont {
    const existing = this.fonts.get(role);
    if (existing) return existing;
    const font = new EmbeddedFont(ASSET_DIR + FONT_FILES[role]);
    this.fonts.set(role, font);
    return font;
  }

  get pageCount(): number {
    return this.pages.length;
  }

  private reserve(value = ''): number {
    this.objects.push(value);
    return this.objects.length; // شماره‌یِ شیء (یک-پایه)
  }

  private setObject(number: number, value: string): void {
    this.objects[number - 1] = value;
  }

  /** خروجیِ نهایی */
  toBuffer(): Buffer {
    if (this.pages.length === 0) this.addPage();

    // اگر هیچ متنی نوشته نشده باشد، یک قلمِ پایه وارد می‌شود تا سندِ بی‌قلم
    // (که برخی خواننده‌ها را به خطا می‌اندازد) ساخته نشود.
    if (this.fonts.size === 0) this.ensureFont('body');

    const chunks: Buffer[] = [];
    const offsets: number[] = [];
    let length = 0;

    const push = (data: Buffer | string): void => {
      const buf = typeof data === 'string' ? Buffer.from(data, 'latin1') : data;
      chunks.push(buf);
      length += buf.length;
    };

    push('%PDF-1.7\n%\xE2\xE3\xCF\xD3\n');

    // جایِ اشیاءِ ثابت: ۱ = فهرست، ۲ = برگه‌ها، ۳ = اطلاعات
    this.reserve('');
    this.reserve('');
    const infoNumber = this.reserve();

    const fontNumbers = new Map<FontRole, { type0: number; cid: number; descriptor: number; file: number; unicode: number }>();
    for (const [role, font] of this.fonts) {
      fontNumbers.set(role, {
        type0: this.reserve(),
        cid: this.reserve(),
        descriptor: this.reserve(),
        file: this.reserve(),
        unicode: this.reserve(),
      });
    }

    const pageNumbers: number[] = [];
    const contentNumbers: number[] = [];
    for (let i = 0; i < this.pages.length; i += 1) {
      pageNumbers.push(this.reserve());
      contentNumbers.push(this.reserve());
    }

    const writeObject = (number: number, body: Buffer | string, dict?: string): void => {
      offsets[number] = length;
      push(`${number} 0 obj\n`);
      if (dict) push(`${dict}\n`);
      if (typeof body === 'string') {
        push(body);
      } else {
        push(`stream\n`);
        push(body);
        push(`\nendstream`);
      }
      push(`\nendobj\n`);
    };

    for (let i = 0; i < this.pages.length; i += 1) {
      const page = this.pages[i]!;
      const content = page.stream();
      writeObject(contentNumbers[i]!, content, `<< /Length ${content.length} /Filter /FlateDecode >>`);

      const fontDict = [...this.fonts.keys()]
        .map((role) => `/${fontName(role)} ${fontNumbers.get(role)!.type0} 0 R`)
        .join(' ');
      writeObject(
        pageNumbers[i]!,
        '',
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${num(page.width)} ${num(page.height)}] ` +
          `/Resources << /ProcSet [/PDF /Text] /Font << ${fontDict} >> >> ` +
          `/Contents ${contentNumbers[i]!} 0 R >>`,
      );
    }

    for (const [role, font] of this.fonts) {
      const refs = fontNumbers.get(role)!;
      const metrics = font.metrics();
      const bytes = font.bytes();
      const base = metrics.postscriptName;

      writeObject(refs.file, bytes, `<< /Length ${bytes.length} /Length1 ${bytes.length} >>`);
      const cmap = Buffer.from(font.toUnicode(), 'latin1');
      writeObject(refs.unicode, cmap, `<< /Length ${cmap.length} >>`);
      writeObject(
        refs.descriptor,
        '',
        `<< /Type /FontDescriptor /FontName /${base} /Flags 4 ` +
          `/FontBBox [${metrics.bbox.map((v) => num(v)).join(' ')}] ` +
          `/ItalicAngle ${num(metrics.italicAngle)} /Ascent ${num(metrics.ascent)} ` +
          `/Descent ${num(metrics.descent)} /CapHeight ${num(metrics.capHeight)} ` +
          `/XHeight ${num(metrics.xHeight)} /StemV 80 /FontFile2 ${refs.file} 0 R >>`,
      );
      writeObject(
        refs.cid,
        '',
        `<< /Type /Font /Subtype /CIDFontType2 /BaseFont /${base} ` +
          `/CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> ` +
          `/FontDescriptor ${refs.descriptor} 0 R /DW 1000 /W ${font.widthsArray()} ` +
          `/CIDToGIDMap /Identity >>`,
      );
      writeObject(
        refs.type0,
        '',
        `<< /Type /Font /Subtype /Type0 /BaseFont /${base} /Encoding /Identity-H ` +
          `/DescendantFonts [${refs.cid} 0 R] /ToUnicode ${refs.unicode} 0 R >>`,
      );
    }

    const now = pdfDate(new Date());
    writeObject(
      infoNumber,
      '',
      `<< /Title ${pdfText(this.options.title ?? 'سند')} /Author ${pdfText(this.options.author ?? 'ست‌شاپ')} ` +
        `/Creator ${pdfText('ست‌شاپ')} /Producer ${pdfText('ست‌شاپ')} /CreationDate (${now}) /ModDate (${now}) >>`,
    );

    const kids = pageNumbers.map((n) => `${n} 0 R`).join(' ');
    writeObject(2, '', `<< /Type /Pages /Kids [${kids}] /Count ${pageNumbers.length} >>`);
    writeObject(1, '', `<< /Type /Catalog /Pages 2 0 R >>`);

    const xrefOffset = length;
    const size = this.objects.length + 1;
    push(`xref\n0 ${size}\n`);
    push('0000000000 65535 f \n');
    for (let i = 1; i < size; i += 1) {
      push(`${String(offsets[i] ?? 0).padStart(10, '0')} 00000 n \n`);
    }
    push(`trailer\n<< /Size ${size} /Root 1 0 R /Info ${infoNumber} 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`);

    return Buffer.concat(chunks);
  }
}

/** تاریخِ پی‌دی‌اف: D:YYYYMMDDHHmmSS+HH'mm' */
function pdfDate(date: Date): string {
  const pad = (n: number): string => String(n).padStart(2, '0');
  return (
    `D:${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}` +
    `${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}Z`
  );
}

/**
 * رشته‌یِ پی‌دی‌اف در قالبِ UTF-16BE.
 *
 * چرا هگزادسیمالِ یوتی‌اف-۱۶ و نه رشته‌یِ ساده؟ چون رشته‌یِ ساده‌یِ پی‌دی‌اف
 * عملاً لاتین است و «فاکتور فروش» در فراداده (metadata) به صورتِ «?????»
 * می‌نشست — در حالی که همان سند درست چاپ می‌شد. فراداده‌یِ درست برایِ
 * بایگانی و جست‌وجو لازم است.
 */
function pdfText(value: string): string {
  const body = Buffer.from(value, 'utf16le').swap16().toString('hex');
  return `<FEFF${body}>`;
}

/** یک قلم را از پیش بار می‌کند (برایِ برگه‌هایی که فقط قلمِ درشت می‌خواهند) */
export function loadRole(role: FontRole): EmbeddedFont {
  return new EmbeddedFont(ASSET_DIR + FONT_FILES[role]);
}

