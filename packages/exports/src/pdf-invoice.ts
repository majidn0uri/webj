/**
 * فاکتورِ رسمی (صورتحسابِ فروش) — همان برگه‌ای که به دستِ مشتری می‌رسد.
 * ============================================================================
 *
 * چرا اینجا پر از جزئیاتِ ریز است؟ چون فاکتور فقط یک «رسید» نیست؛ در ایران
 * یک سندِ مالیاتی است. اگر مبلغ به حروف نوشته نشود، اگر شماره و تاریخ
 * نداشته باشد، اگر نشانی و شناسه‌یِ ملیِ فروشنده در آن نباشد، یا اداره‌ی
 * مالیات آن را نمی‌پذیرد یا مشتری به آن اعتماد نمی‌کند. پس:
 *
 *   - مبلغ به **عدد و حروف** (تا حدِ میلیارد)،
 *   - شناسه‌یِ ملی و کدِ اقتصادی در کادرِ فروشنده،
 *   - تفکیکِ «جمعِ کالاها / تخفیف / ارسال / مالیات / قابلِ پرداخت»،
 *   - جایِ مهر و امضا برایِ هر دو سو،
 *   - و شماره‌یِ برگه در پانویس، تا اگر فاکتور چند برگه شد، برگه‌ای گم نشود.
 *
 * همه‌یِ این‌ها از تنظیماتِ فروشگاه (`store_settings`) می‌آید — یعنی فروشنده
 * نشانی و شناسه‌اش را یک‌بار در پنل می‌نویسد و در هر فاکتور چاپ می‌شود؛
 * نیازی نیست کسی دست به کد ببرد.
 */

import { DocBuilder, TYPO, drawTable, type TableColumn } from './pdf-doc.js';
import { BRAND, INK, LINE, MUTED, type Rgb } from './pdf-core.js';
import { formatCell, groupDigits, numberToPersianWords, tomanDisplay } from './format.js';
import { jalaliOf } from './format.js';
import type { InvoiceLine, InvoiceSpec, PartyInfo, ReportRow } from './types.js';

/* ------------------------------- برچسب‌ها -------------------------------- */

const STATUS_LABEL: Record<string, string> = {
  paid: 'پرداخت‌شده',
  pending: 'در انتظارِ پرداخت',
  pending_payment: 'در انتظارِ پرداخت',
  processing: 'در حالِ آماده‌سازی',
  shipped: 'ارسال‌شده',
  delivered: 'تحویل‌شده',
  cancelled: 'ابطال‌شده',
  refunded: 'مسترد‌شده',
};

const STATUS_COLOR: Record<string, Rgb> = {
  paid: { r: 0.11, g: 0.55, b: 0.33 },
  delivered: { r: 0.11, g: 0.55, b: 0.33 },
  pending: { r: 0.78, g: 0.52, b: 0.05 },
  pending_payment: { r: 0.78, g: 0.52, b: 0.05 },
  cancelled: { r: 0.7, g: 0.18, b: 0.18 },
  refunded: { r: 0.45, g: 0.25, b: 0.6 },
};

function statusLabel(status: string | undefined): string {
  return STATUS_LABEL[status ?? ''] ?? 'پیش‌نویس';
}

function statusColor(status: string | undefined): Rgb {
  return STATUS_COLOR[status ?? ''] ?? MUTED;
}

/* ------------------------------ کادرِ یک سو ------------------------------ */

/**
 * کادرِ مشخصاتِ فروشنده یا خریدار.
 *
 * چرا کادر و نه چند سطرِ ساده؟ چون در یک برگه‌یِ پر از عدد، چشم باید بتواند
 * «شناسه‌یِ ملی» را از «مبلغِ واحد» جدا کند. کادر این جدایی را بی‌هزینه
 * می‌سازد.
 */
function drawPartyBox(
  doc: DocBuilder,
  leftX: number,
  width: number,
  top: number,
  title: string,
  party: PartyInfo,
  height: number,
): void {
  doc.page.rect(leftX, top, width, height, { stroke: LINE, lineWidth: 0.6 });
  doc.page.rect(leftX, top, width, 15, { fill: { r: 0.95, g: 0.96, b: 0.98 } });
  doc.page.text(title, leftX + width - 8, top + 2.5, { size: 8.6, role: 'bold' });

  const fields: Array<[string, string | null | undefined]> = [
    ['نام / شرکت', party.name],
    ['شناسه‌یِ ملی', party.nationalId],
    ['کدِ اقتصادی', party.economicCode],
    ['کدِ پستی', party.postalCode],
    ['تلفن', party.phone],
    ['نشانی', party.address],
  ];

  let y = top + 19;
  for (const [label, value] of fields) {
    if (!value) continue;
    if (y + 12 > top + height - 2) break; // کادر پر شده: بقیه می‌افتد
    doc.page.text(`${label}:`, leftX + width - 8, y, { size: 8.2, color: MUTED });
    const labelWidth = doc.measurer.width(`${label}:`, 8.2) + 4;
    const maxWidth = width - 16 - labelWidth - 8;
    const lines = doc.measurer.wrap(value, maxWidth, 8.4);
    lines.forEach((line, index) => {
      doc.page.text(line, leftX + width - 8 - labelWidth, y + index * 10, { size: 8.4, role: 'bold' });
    });
    y += Math.max(1, lines.length) * 10 + 2.6;
  }
}

/* --------------------------------- نشان ---------------------------------- */

/** نشانِ وضعیت: یک کادرِ رنگی با متنِ روشن در گوشه‌یِ برگه */
function drawBadge(doc: DocBuilder, text: string, color: Rgb, rightEdge: number, top: number): void {
  const width = doc.measurer.width(text, 8.6, true) + 16;
  const height = 16;
  doc.page.rect(rightEdge - width, top, width, height, { fill: color });
  doc.page.text(text, rightEdge - width / 2, top + 3.2, {
    size: 8.6,
    role: 'bold',
    align: 'center',
    color: { r: 1, g: 1, b: 1 },
  });
}

/* ------------------------------ جمع‌بندیِ مبلغ ---------------------------- */

interface TotalsPanelRow {
  label: string;
  value: string;
  strong?: boolean;
}

function drawTotalsPanel(doc: DocBuilder, rows: TotalsPanelRow[], width = 236): void {
  const rowHeight = 15;
  const height = rows.length * rowHeight + 8;
  doc.ensureSpace(height + 6);
  const leftX = doc.left;

  doc.page.rect(leftX, doc.y, width, height, { fill: { r: 0.975, g: 0.98, b: 0.99 }, stroke: LINE, lineWidth: 0.6 });

  rows.forEach((row, index) => {
    const y = doc.y + 4 + index * rowHeight;
    if (row.strong) {
      doc.page.rect(leftX + 1, y, width - 2, rowHeight, { fill: { r: 0.9, g: 0.94, b: 1 } });
    }
    doc.page.text(row.label, leftX + width - 10, y + 2.5, { size: 8.8, color: row.strong ? INK : MUTED });
    // مقدار در لبه‌یِ چپِ کادر می‌نشیند و برچسب در راست — همان ترتیبی که
    // در یک سندِ راست‌چین خوانده می‌شود: «مبلغِ قابلِ پرداخت: ۱۲۵٬۰۰۰»
    doc.page.text(row.value, leftX + 10, y + 2.5, {
      size: row.strong ? 10 : 9,
      role: 'bold',
      align: 'left',
    });
  });

  doc.y += height + 6;
}

/* --------------------------------- فاکتور -------------------------------- */

/** جمعِ یک سطر: اگر داده نشده باشد، حساب می‌شود */
export function lineTotal(line: InvoiceLine): number {
  if (typeof line.totalRial === 'number') return line.totalRial;
  const gross = line.quantity * line.unitPriceRial;
  return gross - (line.discountRial ?? 0) + (line.taxRial ?? 0);
}

/**
 * ساختنِ پی‌دی‌افِ فاکتور.
 *
 * ساختارِ برگه: سربرگ (نامِ فروشگاه، شماره، تاریخ، نشانِ وضعیت) → دو کادرِ
 * فروشنده/خریدار → جدولِ اقلام → جمع‌بندی → مبلغ به حروف → پرداخت و امضا.
 */
export function renderInvoicePdf(spec: InvoiceSpec): Buffer {
  const issuedAt = spec.issuedAt instanceof Date ? spec.issuedAt : new Date(String(spec.issuedAt));
  const watermark = spec.watermark ?? (spec.status === 'paid' ? null : 'پیش‌نویس');

  const doc = new DocBuilder({
    title: `${spec.title ?? 'صورتحساب فروش'} ${spec.number}`,
    watermark,
    footerNote: spec.seller.name,
  });

  /* ── سربرگ ───────────────────────────────────────────────────────────── */
  const title = spec.title ?? 'صورتحساب فروش';
  doc.page.text(spec.seller.name, doc.right, doc.y, { size: 14, role: 'bold', color: INK });
  doc.y += 19;

  // نشانِ وضعیت در گوشه‌یِ **چپ** می‌نشیند، نه راست: عنوان و نامِ فروشگاه هر دو
  // راست‌چین‌اند و نشان، اگر آن‌جا می‌رفت، رویِ عنوان می‌افتاد.
  doc.page.text(title, doc.right, doc.y, { size: 10.5, color: BRAND, role: 'bold' });
  const badgeText = statusLabel(spec.status);
  const badgeWidth = doc.measurer.width(badgeText, 8.6, true) + 16;
  drawBadge(doc, badgeText, statusColor(spec.status), doc.left + badgeWidth, doc.y - 1);

  doc.y += 18;
  doc.page.text(`شماره: ${spec.number}`, doc.right, doc.y, { size: 8.8, color: MUTED });
  doc.page.text(`تاریخِ صدور: ${jalaliOf(issuedAt, true)}`, doc.right - 110, doc.y, {
    size: 8.8,
    color: MUTED,
  });
  doc.y += 14;
  doc.page.hline(doc.left, doc.right, doc.y, BRAND, 1.2);
  doc.y += 10;

  /* ── دو کادرِ فروشنده و خریدار ───────────────────────────────────────── */
  const boxWidth = doc.contentWidth / 2 - 6;
  const fieldCount = (party: PartyInfo): number =>
    [party.name, party.nationalId, party.economicCode, party.postalCode, party.phone, party.address].filter(Boolean)
      .length;
  const sellerCount = fieldCount(spec.seller);
  const buyerCount = spec.buyer ? fieldCount(spec.buyer) : 1;
  const boxHeight = Math.max(60, Math.max(sellerCount, buyerCount) * 12.6 + 24);

  // فروشنده در کادرِ **راست** و خریدار در چپ: در یک سندِ راست‌چین، نخستین
  // چیزی که خوانده می‌شود باید سمتِ راست باشد — و در فاکتور، نخستین چیز
  // هویتِ فروشنده است.
  const boxTop = doc.y;
  drawPartyBox(doc, doc.right - boxWidth, boxWidth, boxTop, 'فروشنده', spec.seller, boxHeight);
  drawPartyBox(
    doc,
    doc.left,
    boxWidth,
    boxTop,
    'خریدار',
    spec.buyer ?? { name: 'مشتریِ حضوری / ثبت‌نشده' },
    boxHeight,
  );
  doc.y = boxTop + boxHeight + 10;

  /* ── جدولِ اقلام ─────────────────────────────────────────────────────── */
  const columns: TableColumn[] = [
    { key: 'title', title: 'شرحِ کالا / خدمات', type: 'text' },
    { key: 'quantity', title: 'تعداد', type: 'number', align: 'center' },
    { key: 'unit', title: 'واحد', type: 'text', align: 'center' },
    { key: 'unitPrice', title: 'مبلغِ واحد (ریال)', type: 'money' },
    { key: 'discount', title: 'تخفیف (ریال)', type: 'money' },
    { key: 'tax', title: 'مالیات (ریال)', type: 'money' },
    { key: 'total', title: 'مبلغِ کل (ریال)', type: 'money' },
  ];

  const rows: ReportRow[] = spec.lines.map((line) => ({
    title: line.sku ? `${line.title}\nکد: ${line.sku}` : line.title,
    quantity: line.quantity,
    unit: line.unit ?? 'عدد',
    unitPrice: line.unitPriceRial,
    discount: line.discountRial ?? 0,
    tax: line.taxRial ?? 0,
    total: lineTotal(line),
  }));

  // پهنا با وزنِ دستی: «شرحِ کالا» باید جایِ بیشتری داشته باشد، بقیه به اندازه
  const weights = [3.1, 0.75, 0.6, 1.15, 1, 1, 1.25];
  const totalWeight = weights.reduce((a, b) => a + b, 0);
  const rowNoWidth = 26;
  const usable = doc.contentWidth - rowNoWidth;
  const widths = [rowNoWidth, ...weights.map((w) => (w / totalWeight) * usable)];

  drawTable(doc, { columns, rows, widths, rowNumbers: true, fontSize: 8.6 });

  /* ── جمع‌بندی ───────────────────────────────────────────────────────── */
  const itemsTotal = spec.lines.reduce((sum, line) => sum + line.quantity * line.unitPriceRial, 0);
  const linesDiscount = spec.lines.reduce((sum, line) => sum + (line.discountRial ?? 0), 0);
  const linesTax = spec.lines.reduce((sum, line) => sum + (line.taxRial ?? 0), 0);
  const discount = linesDiscount + (spec.discountRial ?? 0);
  const shipping = spec.shippingRial ?? 0;
  const tax = linesTax > 0 ? linesTax : (spec.taxRial ?? 0);
  const payable = itemsTotal - discount + shipping + tax;

  doc.y += 6;
  doc.ensureSpace(120);

  drawTotalsPanel(doc, [
    { label: 'جمعِ کلِ کالاها', value: groupDigits(itemsTotal) },
    ...(discount > 0 ? [{ label: 'تخفیف', value: `(${groupDigits(discount)})` }] : []),
    ...(shipping > 0 ? [{ label: 'هزینه‌یِ ارسال', value: groupDigits(shipping) }] : []),
    {
      label: spec.taxRatePercent ? `مالیات و عوارض (${spec.taxRatePercent}٪)` : 'مالیات و عوارض',
      value: groupDigits(tax),
    },
    { label: 'مبلغِ قابلِ پرداخت (ریال)', value: groupDigits(payable), strong: true },
  ]);

  /* ── مبلغ به حروف و پرداخت ───────────────────────────────────────────── */
  doc.ensureSpace(46);
  const wordsY = doc.y;
  doc.page.text('مبلغ به حروف:', doc.right, wordsY, { size: 9, color: MUTED });
  const labelWidth = doc.measurer.width('مبلغ به حروف:', 9) + 4;
  doc.page.text(`${numberToPersianWords(payable)} ریال`, doc.right - labelWidth, wordsY, {
    size: 9.4,
    role: 'bold',
  });
  doc.y += 13;
  doc.page.text(`معادل: ${tomanDisplay(payable)} تومان`, doc.right, doc.y, { size: 8.6, color: MUTED });
  doc.y += 14;

  if (spec.paymentMethod || spec.paymentReference) {
    doc.page.text(
      `روشِ پرداخت: ${spec.paymentMethod ?? '—'}${spec.paymentReference ? ` — کدِ رهگیری: ${spec.paymentReference}` : ''}`,
      doc.right,
      doc.y,
      { size: 8.6, color: MUTED },
    );
    doc.y += 13;
  }

  if (spec.note) {
    doc.page.text(spec.note, doc.right, doc.y, { size: 8.4, color: MUTED });
    doc.y += 14;
  }

  /* ── امضا ────────────────────────────────────────────────────────────── */
  doc.ensureSpace(46);
  const signY = doc.y + 16;
  doc.page.hline(doc.left + 10, doc.left + 160, signY, LINE, 0.6);
  doc.page.text('مهر و امضایِ فروشنده', doc.left + 85, signY + 4, { size: 8.2, color: MUTED, align: 'center' });
  doc.page.hline(doc.right - 160, doc.right - 10, signY, LINE, 0.6);
  doc.page.text('امضایِ خریدار', doc.right - 85, signY + 4, { size: 8.2, color: MUTED, align: 'center' });
  doc.y = signY + 22;

  return doc.toBuffer();
}

/** نمایشِ یک مقدار برایِ بیرون (تست و لاگ) */
export function invoiceTotals(spec: InvoiceSpec): { itemsTotal: number; discount: number; shipping: number; tax: number; payable: number } {
  const itemsTotal = spec.lines.reduce((sum, line) => sum + line.quantity * line.unitPriceRial, 0);
  const discount =
    spec.lines.reduce((sum, line) => sum + (line.discountRial ?? 0), 0) + (spec.discountRial ?? 0);
  const shipping = spec.shippingRial ?? 0;
  const linesTax = spec.lines.reduce((sum, line) => sum + (line.taxRial ?? 0), 0);
  const tax = linesTax > 0 ? linesTax : (spec.taxRial ?? 0);
  return { itemsTotal, discount, shipping, tax, payable: itemsTotal - discount + shipping + tax };
}

/** نمایشِ سلول برایِ استفاده‌یِ بیرونی (سازگار با ستون‌ها) */
export const displayCell = formatCell;
export const typography = TYPO;
