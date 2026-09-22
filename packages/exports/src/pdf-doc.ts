/**
 * موتورِ چیدمانِ سند — آنچه یک «گزارشِ رسمیِ فارسی» را می‌سازد.
 * ============================================================================
 *
 * `pdf-core.ts` می‌داند چطور متن و خط رویِ کاغذ بنشیند؛ اینجا می‌دانیم
 * **کجا** بنشیند: کادرِ مشخصات، جدولی که سرستونش در هر برگه تکرار می‌شود،
 * سطرِ جمع، پانویس با شماره‌یِ برگه، و نشانِ کج‌رویِ رویِ سند.
 *
 * سه مسئله در اینجا حل شده که هر کدام، اگر حل نمی‌شد، خروجی غیرِحرفه‌ای
 * از آب درمی‌آمد:
 *
 *   ۱. **شکستنِ برگه.** جدولی که از برگه بیرون می‌زند، نباید ادامه‌اش را در
 *      برگه‌یِ بعد بی‌سرستون رها کند: خواننده باید بداند هر ستون چیست. پس
 *      سرستون در هر برگه بازنویسی می‌شود.
 *
 *   ۲. **پهنایِ ستون.** نه ستونِ ثابت (که درِ هم می‌روند) و نه «همه مساوی»
 *      (که نامِ کالا را می‌بُرد). پهنا از رویِ عنوان و محتوایِ واقعی اندازه
 *      گرفته می‌شود و سپس در پهنایِ برگه جای می‌گیرد.
 *
 *   ۳. **متنِ بلند.** سلولی که جا نمی‌شود یا در دو سطر می‌نشیند (با شکستنِ
 *      رویِ فاصله، نه میانِ حروف) یا با «…» کوتاه می‌شود؛ هرگز رویِ هم
 *      نمی‌لغزد.
 */

import { A4, BRAND, HEAD_BG, INK, LINE, MUTED, PdfPage, PdfWriter, ZEBRA, type Rgb } from './pdf-core.js';
import { formatCell, numericValue } from './format.js';
import type { CellValue, ColumnType, ReportRow, ReportSpec } from './types.js';
import { jalaliOf } from './format.js';

/* ------------------------------- مقیاس‌ها -------------------------------- */

/** مقیاسِ تایپوگرافی — از رویِ اندازه گرفتن و دیدن تنظیم شده، نه حدس */
export const TYPO = {
  title: 15,
  subtitle: 9.5,
  head: 8.8,
  body: 9,
  meta: 8.6,
  footer: 8,
  lineHeight: 11.4,
  rowPad: 4,
  headPad: 5,
} as const;

const PAD = 4.5; // فاصله‌یِ محتوا از لبه‌یِ سلول
const MIN_COL = 24; // باریک‌ترین ستونِ مجاز
const MAX_LINES = 2; // بیشینه‌یِ سطرهایِ یک سلول

/* ------------------------------- اندازه‌گیر ------------------------------ */

/**
 * اندازه‌گیری با حافظه.
 *
 * چرا حافظه؟ چون شکل‌دهیِ فارسی برای هر رشته چند صد عملیات است و یک گزارشِ
 * هزارسطری همان «جمع کل» را هزار بار اندازه می‌گیرد. بی‌حافظه، ساختنِ یک
 * گزارشِ بزرگ چندین ثانیه طول می‌کشید.
 */
class Measurer {
  private readonly cache = new Map<string, number>();

  constructor(private readonly page: PdfPage) {}

  width(text: string, size: number, bold = false): number {
    if (text.length === 0) return 0;
    const key = `${bold ? 'b' : 'r'}|${size}|${text}`;
    const hit = this.cache.get(key);
    if (hit !== undefined) return hit;
    const value = this.page.measure(text, size, bold ? 'bold' : 'body');
    this.cache.set(key, value);
    return value;
  }

  /**
   * شکستنِ متن به چند سطر.
   *
   * شکستن فقط رویِ **فاصله** انجام می‌شود: شکستنِ میانِ حروفِ فارسی، حروف را
   * از هم می‌بُرد (چون فارسی پیوسته است و نگاره‌یِ میانی با پایانی فرق
   * دارد). خطِ تیره و نیم‌فاصله هم جایِ شکستن نیستند، به همان دلیل.
   */
  wrap(text: string, maxWidth: number, size: number, bold = false): string[] {
    if (text.length === 0) return [''];
    if (this.width(text, size, bold) <= maxWidth) return [text];

    const hardLines = text.split('\n');
    const out: string[] = [];

    for (const hard of hardLines) {
      const words = hard.split(/\s+/).filter(Boolean);
      let line = '';
      for (const word of words) {
        const candidate = line === '' ? word : `${line} ${word}`;
        if (this.width(candidate, size, bold) <= maxWidth || line === '') {
          line = candidate;
        } else {
          out.push(line);
          line = word;
        }
      }
      if (line !== '') out.push(line);
    }

    if (out.length <= MAX_LINES) return out;

    // بیش از دو سطر: سطرهایِ اضافه حذف و انتهایِ سطرِ دوم با «…» بسته می‌شود
    const kept = out.slice(0, MAX_LINES);
    let last = kept[MAX_LINES - 1]!;
    while (last.length > 1 && this.width(`${last}…`, size, bold) > maxWidth) {
      last = last.slice(0, -1);
    }
    kept[MAX_LINES - 1] = `${last.trimEnd()}…`;
    return kept;
  }
}

/* ------------------------------ سازنده‌یِ سند ---------------------------- */

/**
 * سازنده‌یِ سند.
 *
 * چرا یک کلاسِ جدا؟ چون «برگه‌یِ تازه ساختن» در اینجا معنایِ بیشتری دارد:
 * نشانِ رویِ سند را می‌کشد، مکان‌نما را به بالا می‌برد، و برگه را در فهرستی
 * نگه می‌دارد تا در پایان پانویس رویِ همه‌یِ برگه‌ها بنشیند.
 */
export class DocBuilder {
  private readonly writer: PdfWriter;
  private readonly pagesInternal: PdfPage[] = [];
  private currentInternal!: PdfPage;
  private yInternal = 0;
  private readonly watermark: string | null;
  private readonly footerNote: string;

  readonly measurer: Measurer;
  readonly margin: number;
  readonly width: number;
  readonly height: number;

  constructor(
    options: {
      landscape?: boolean;
      margin?: number;
      title?: string;
      author?: string;
      watermark?: string | null;
      footerNote?: string;
    } = {},
  ) {
    const width = options.landscape ? A4.height : A4.width;
    const height = options.landscape ? A4.width : A4.height;
    this.writer = new PdfWriter({
      width,
      height,
      margin: options.margin ?? 36,
      title: options.title ?? 'گزارش',
      author: options.author ?? 'ست‌شاپ',
    });
    this.margin = this.writer.margin;
    this.width = width;
    this.height = height;
    this.watermark = options.watermark ?? null;
    this.footerNote = options.footerNote ?? 'ست‌شاپ';
    this.measurer = new Measurer(this.openPage());
  }

  private openPage(): PdfPage {
    const page = this.writer.addPage();
    this.pagesInternal.push(page);
    this.currentInternal = page;
    this.yInternal = this.margin;
    if (this.watermark) this.drawWatermark(page, this.watermark);
    return page;
  }

  get page(): PdfPage {
    return this.currentInternal;
  }

  get y(): number {
    return this.yInternal;
  }

  set y(value: number) {
    this.yInternal = value;
  }

  /** لبه‌یِ راستِ ناحیه‌یِ محتوا (در چیدمانِ راست‌به‌چپ، مبدأی که از آن می‌چینیم) */
  get right(): number {
    return this.width - this.margin;
  }

  get left(): number {
    return this.margin;
  }

  get contentWidth(): number {
    return this.width - this.margin * 2;
  }

  /** پایین‌ترین نقطه‌ای که محتوا مجاز است برسد (پانویس جدا است) */
  get bottom(): number {
    return this.height - this.margin - 18;
  }

  newPage(): PdfPage {
    return this.openPage();
  }

  /** اگر به اندازه‌یِ `needed` جا نمانده، برگه‌یِ تازه */
  ensureSpace(needed: number): void {
    if (this.y + needed > this.bottom) this.openPage();
  }

  get pages(): readonly PdfPage[] {
    return this.pagesInternal;
  }

  /** نشانِ کج‌روی — زیرِ متن، چون نخستین چیزی است که رویِ برگه می‌نشیند */
  private drawWatermark(page: PdfPage, text: string): void {
    const size = Math.min(64, this.contentWidth / (text.length * 0.35));
    const w = page.measure(text, size, 'bold');
    const angle = Math.PI / 4;
    const cx = this.width / 2;
    const cy = this.height / 2;
    page.text(text, cx - (w / 2) * Math.cos(angle), cy + (w / 2) * Math.sin(angle) - size / 2, {
      size,
      role: 'bold',
      align: 'left',
      rotate: angle,
      color: { r: 0.84, g: 0.86, b: 0.9 },
    });
  }

  /**
   * پانویسِ همه‌یِ برگه‌ها.
   *
   * چرا در پایان و نه هنگامِ چیدمان؟ چون «صفحه ۱ از ۳» تا پایانِ چیدمان
   * ناتمام است. پس برگه‌ها جمع می‌شوند و در پایان، یک‌باره پانویس می‌خورند.
   */
  toBuffer(): Buffer {
    const total = this.pagesInternal.length;
    const printedAt = jalaliOf(new Date(), true);

    this.pagesInternal.forEach((page, index) => {
      const y = this.height - this.margin + 8;
      page.hline(this.margin, this.width - this.margin, y - 8, LINE, 0.5);

      // چیدمانِ پانویس: نامِ فروشگاه در راست، شماره‌یِ برگه و تاریخِ چاپ در چپ.
      // فاصله‌ها اندازه گرفته می‌شوند (ثابت گذاشته نشده‌اند) تا درازتر شدنِ
      // نامِ فروشگاه رویِ شماره‌یِ برگه نیفتد.
      const pageText = `صفحه ${index + 1} از ${total}`;
      const dateText = `تاریخِ چاپ: ${printedAt}`;
      const pageWidthPt = page.measure(pageText, TYPO.footer);

      page.text(this.footerNote, this.width - this.margin, y, { size: TYPO.footer, color: MUTED });
      page.text(pageText, this.margin, y, { size: TYPO.footer, color: MUTED, align: 'left' });
      page.text(dateText, this.margin + pageWidthPt + 12, y, {
        size: TYPO.footer,
        color: MUTED,
        align: 'left',
      });
    });

    return this.writer.toBuffer();
  }
}

/* --------------------------------- جدول ---------------------------------- */

export interface TableColumn {
  key: string;
  title: string;
  type?: ColumnType;
  align?: 'right' | 'left' | 'center';
  width?: number;
  sum?: boolean;
}

/**
 * پهنایِ ستون‌ها، اندازه گرفته از محتوا.
 *
 * ترتیبِ تصمیم‌ها:
 *  ۱) ستونِ شماره‌یِ ردیف (اگر خواسته شده)،
 *  ۲) برایِ هر ستون، بیشینه‌یِ پهنایِ عنوان و نمونه‌ای از داده‌ها،
 *  ۳) جا دادن در پهنایِ برگه — با کشش اگر جا هست و با فشردن اگر نیست.
 */
export function columnWidths(
  doc: DocBuilder,
  columns: TableColumn[],
  rows: ReportRow[],
  options: { rowNumbers?: boolean; sample?: number } = {},
): number[] {
  const contentWidth = doc.contentWidth;
  const sample = rows.slice(0, options.sample ?? 300);
  const widths: number[] = [];

  if (options.rowNumbers) widths.push(Math.max(26, doc.measurer.width('ردیف', TYPO.head, true) + PAD * 2));

  for (const column of columns) {
    const titleWidth = doc.measurer.width(column.title, TYPO.head, true) + PAD * 2;
    let dataWidth = 0;
    for (const row of sample) {
      const text = formatCell(row[column.key], column.type ?? 'text');
      const w = doc.measurer.width(text, TYPO.body) + PAD * 2;
      if (w > dataWidth) dataWidth = w;
    }
    const cap = contentWidth * (column.type === 'text' ? 0.42 : 0.28);
    widths.push(Math.min(Math.max(titleWidth, dataWidth, MIN_COL), cap));
  }

  // جا دادن در پهنایِ برگه
  const scaleTo = (target: number): void => {
    const total = widths.reduce((a, b) => a + b, 0);
    if (total === 0) return;
    const factor = target / total;
    for (let i = 0; i < widths.length; i += 1) widths[i] = widths[i]! * factor;
    // هیچ ستونی از کمینه کمتر نشود
    for (let i = 0; i < widths.length; i += 1) {
      if (widths[i]! < MIN_COL) widths[i] = MIN_COL;
    }
  };

  const total = widths.reduce((a, b) => a + b, 0);
  if (total > contentWidth) {
    scaleTo(contentWidth);
    const after = widths.reduce((a, b) => a + b, 0);
    // فشردن ممکن است از پهنا بیرون بزند (به‌خاطرِ کمینه)؛ آن‌گاه متن کوتاه می‌شود
    if (after > contentWidth) {
      const overflow = after - contentWidth;
      for (let i = widths.length - 1; i >= 0 && overflow > 0; i -= 1) {
        const shrink = Math.min(overflow, widths[i]! - MIN_COL);
        widths[i] = widths[i]! - shrink;
      }
    }
  } else if (total < contentWidth) {
    scaleTo(contentWidth);
  }

  return widths;
}

export interface TableOptions {
  columns: TableColumn[];
  rows: ReportRow[];
  widths: number[];
  rowNumbers?: boolean;
  /** در هر برگه سرستون دوباره چاپ شود */
  repeatHeader?: boolean;
  /** ردیفِ راه‌راه برایِ خواناییِ سطرهایِ پشتِ‌هم */
  zebra?: boolean;
  headerBg?: Rgb;
  headerColor?: Rgb;
  fontSize?: number;
  /** سطرِ جمع در پایان (از رویِ ستون‌هایِ sum) */
  totals?: { label?: string };
}

/**
 * رسمِ جدول با شکستنِ خودکارِ برگه.
 *
 * مکان‌نما (`doc.y`) را جلو می‌برد و برمی‌گرداند تا چیدمانِ بعدی (مثلِ سطرِ
 * جمع یا امضا) بداند از کجا ادامه دهد.
 */
export function drawTable(doc: DocBuilder, options: TableOptions): void {
  const { columns, rows, widths } = options;
  const fontSize = options.fontSize ?? TYPO.body;
  const zebra = options.zebra ?? true;
  const rowNumbers = options.rowNumbers ?? false;
  const right = doc.right;
  const bottom = doc.bottom;

  // ستونِ ردیف در ابتدایِ فهرستِ ستون‌ها (یعنی راست‌ترین ستون)
  const cells: Array<{ key: string | null; title: string; type: ColumnType; align: 'right' | 'left' | 'center'; width: number; sum: boolean }> = [];
  if (rowNumbers) {
    cells.push({ key: null, title: 'ردیف', type: 'number', align: 'center', width: widths[0]!, sum: false });
  }
  columns.forEach((column, index) => {
    cells.push({
      key: column.key,
      title: column.title,
      type: column.type ?? 'text',
      align: column.align ?? (column.type === 'text' ? 'right' : 'right'),
      width: widths[index + (rowNumbers ? 1 : 0)]!,
      sum: column.sum ?? false,
    });
  });

  const drawHeader = (): void => {
    const height = TYPO.lineHeight + TYPO.headPad * 2 - 2;
    doc.page.rect(right - widths.reduce((a, b) => a + b, 0), doc.y, widths.reduce((a, b) => a + b, 0), height, {
      fill: options.headerBg ?? HEAD_BG,
    });
    const textY = doc.y + TYPO.headPad + 1;
    let x = right;
    for (const cell of cells) {
      const cellRight = x;
      const cellLeft = x - cell.width;
      doc.page.text(cell.title, cell.align === 'center' ? (cellRight + cellLeft) / 2 : cellRight - PAD, textY, {
        size: TYPO.head,
        role: 'bold',
        align: cell.align === 'center' ? 'center' : 'right',
        color: options.headerColor ?? INK,
      });
      x -= cell.width;
    }
    doc.y += height;
    doc.page.hline(right - widths.reduce((a, b) => a + b, 0), right, doc.y, LINE, 0.8);
  };

  drawHeader();

  rows.forEach((row, index) => {
    // اندازه‌یِ سطر: بلندترین سلول تعیین می‌کند
    const prepared = cells.map((cell) => {
      const raw: CellValue = cell.key === null ? index + 1 : row[cell.key];
      const text = cell.key === null ? String(index + 1) : formatCell(raw, cell.type);
      const lines = doc.measurer.wrap(text, cell.width - PAD * 2, fontSize);
      return { cell, lines };
    });
    const lineCount = Math.max(...prepared.map((p) => p.lines.length));
    const height = lineCount * (fontSize + 2.4) + TYPO.rowPad * 2;

    if (doc.y + height > bottom) {
      doc.newPage();
      drawHeader();
    }

    if (zebra && index % 2 === 1) {
      const tableWidth = widths.reduce((a, b) => a + b, 0);
      doc.page.rect(right - tableWidth, doc.y, tableWidth, height, { fill: ZEBRA });
    }

    let x = right;
    for (const { cell, lines } of prepared) {
      const cellRight = x;
      const cellLeft = x - cell.width;
      lines.forEach((line, lineIndex) => {
        const textY = doc.y + TYPO.rowPad + lineIndex * (fontSize + 2.4);
        doc.page.text(line, cell.align === 'center' ? (cellRight + cellLeft) / 2 : cellRight - PAD, textY, {
          size: fontSize,
          align: cell.align === 'center' ? 'center' : 'right',
          color: INK,
        });
      });
      x -= cell.width;
    }

    doc.y += height;
    const tableWidth = widths.reduce((a, b) => a + b, 0);
    doc.page.hline(right - tableWidth, right, doc.y, LINE, 0.4);
  });

  if (options.totals) {
    const height = TYPO.lineHeight + TYPO.rowPad * 2;
    if (doc.y + height > bottom) doc.newPage();
    const tableWidth = widths.reduce((a, b) => a + b, 0);
    doc.page.hline(right - tableWidth, right, doc.y, INK, 0.8);
    doc.y += 1;

    let x = right;
    let labelDrawn = false;
    for (const cell of cells) {
      const cellRight = x;
      x -= cell.width;
      if (cell.sum) {
        const total = rows.reduce((sum, row) => sum + (numericValue(row[cell.key!]) ?? 0), 0);
        doc.page.text(formatCell(total, cell.type), cellRight - PAD, doc.y + TYPO.rowPad, {
          size: fontSize,
          role: 'bold',
          align: 'right',
        });
      } else if (!labelDrawn) {
        doc.page.text(options.totals.label ?? 'جمع', cellRight - PAD, doc.y + TYPO.rowPad, {
          size: fontSize,
          role: 'bold',
          align: 'right',
        });
        labelDrawn = true;
      }
    }
    doc.y += height;
    doc.page.hline(right - tableWidth, right, doc.y, INK, 0.8);
  }
}

/* ------------------------------ کادرِ مشخصات ----------------------------- */

/**
 * کادرِ مشخصات: دو ستون، راست‌چین، با برچسبِ کمرنگ و مقدارِ پررنگ.
 *
 * چرا دو ستون؟ چون چهار یا پنج جفتِ «برچسب: مقدار» در یک ستون، بالایِ گزارش
 * را قد می‌کشد و جدول را به برگه‌یِ دوم می‌راند؛ در دو ستون همان اطلاعات در
 * نیمِ فضا جا می‌گیرد.
 */
export function drawMetaCard(doc: DocBuilder, meta: Array<{ label: string; value: string }>): void {
  if (meta.length === 0) return;

  const pairs = Math.ceil(meta.length / 2);
  const rowHeight = 14;
  const height = pairs * rowHeight + 12;
  const width = doc.contentWidth;

  doc.page.rect(doc.left, doc.y, width, height, { fill: { r: 0.975, g: 0.98, b: 0.99 }, stroke: LINE, lineWidth: 0.6 });

  meta.forEach((item, index) => {
    const col = index % 2; // ۰ یعنی ستونِ راست
    const rowIndex = Math.floor(index / 2);
    const cellRight = col === 0 ? doc.right - 10 : doc.left + width / 2 - 10;
    const y = doc.y + 6 + rowIndex * rowHeight;
    doc.page.text(`${item.label}:`, cellRight, y + 1, { size: TYPO.meta, color: MUTED });
    const labelWidth = doc.measurer.width(`${item.label}:`, TYPO.meta) + 4;
    doc.page.text(item.value, cellRight - labelWidth, y + 1, { size: TYPO.meta, role: 'bold' });
  });

  doc.y += height + 8;
}

/* ------------------------------ عنوانِ سند -------------------------------- */

export function drawTitle(doc: DocBuilder, title: string, subtitle?: string, corner?: string): void {
  doc.page.text(title, doc.right, doc.y, { size: TYPO.title, role: 'bold', color: INK });
  if (corner) {
    doc.page.text(corner, doc.left, doc.y + 3, { size: TYPO.meta, color: MUTED, align: 'left', dir: 'ltr' });
  }
  doc.y += TYPO.title * 1.35;

  if (subtitle) {
    doc.page.text(subtitle, doc.right, doc.y, { size: TYPO.subtitle, color: MUTED });
    doc.y += TYPO.subtitle * 1.5;
  }

  doc.page.hline(doc.left, doc.right, doc.y, BRAND, 1.2);
  doc.y += 10;
}

/* ------------------------------- گزارشِ کامل ----------------------------- */

/**
 * ساختنِ پی‌دی‌افِ یک گزارش.
 *
 * این تابع همان «یک توصیف، یک نمایش» است: `ReportSpec` را می‌گیرد و برگه‌ای
 * می‌سازد که با نامِ فروشگاه بالا و شماره‌یِ برگه پایین، آماده‌یِ چاپ یا
 * پیوست کردن در یک نامه است.
 */
export function renderReportPdf(spec: ReportSpec): Buffer {
  const doc = new DocBuilder({
    landscape: spec.landscape ?? false,
    title: spec.title,
    watermark: spec.watermark ?? null,
    footerNote: spec.footerNote ?? 'ست‌شاپ',
  });

  const printedAt = jalaliOf(new Date(), true);
  drawTitle(doc, spec.title, spec.subtitle, `تاریخِ چاپ: ${printedAt}`);

  if (spec.meta && spec.meta.length > 0) drawMetaCard(doc, spec.meta);

  if (spec.rows.length === 0) {
    doc.page.text('هیچ ردیفی با این صافی‌ها پیدا نشد.', doc.right, doc.y + 8, { size: TYPO.body, color: MUTED });
    doc.y += 26;
  } else {
    const widths = columnWidths(doc, spec.columns, spec.rows, { rowNumbers: spec.rowNumbers ?? true });
    drawTable(doc, {
      columns: spec.columns,
      rows: spec.rows,
      widths,
      rowNumbers: spec.rowNumbers ?? true,
      totals: spec.columns.some((c) => c.sum) ? { label: spec.totalsLabel ?? 'جمع' } : undefined,
    });
  }

  if (spec.note) {
    doc.y += 8;
    doc.ensureSpace(30);
    doc.page.text(spec.note, doc.right, doc.y, { size: TYPO.meta, color: MUTED });
  }

  return doc.toBuffer();
}
