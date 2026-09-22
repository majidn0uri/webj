/**
 * خروجی‌هایِ رسمی — اکسل و پی‌دی‌اف.
 * ============================================================================
 *
 * این بسته «دو خروجی» نیست؛ **یک مدل و دو نمایش** است. یک گزارش یک‌بار
 * توصیف می‌شود (ستون‌ها، نوع‌ها، جمع‌ها، عنوان) و سپس به دلخواه اکسل یا
 * پی‌دی‌اف می‌شود. شرحِ کاملِ تصمیم‌ها در `docs/khoruji-excel-pdf.md`.
 *
 * سه نکته برایِ کسی که از این بسته استفاده می‌کند:
 *
 *   ۱. **واحدِ پول ریال است.** هر جا «مبلغ» گفتیم یعنی ریالِ صحیح. نمایش به
 *      تومان فقط در جمع‌بندیِ فاکتور است و با برچسب.
 *
 *   ۲. **همه چیز همگام است** جز اکسل (که کتابخانه‌اش ناهمگام است). ساختنِ
 *      یک پی‌دی‌اف نباید یک مسیرِ زنجیره‌ای از Promise ساخت؛ چیدمانِ سند
 *      کاری است رویِ حافظه، نه رویِ شبکه.
 *
 *   ۳. **هیچ وابستگی به اینترنت نیست.** قلم‌ها در خودِ بسته‌اند
 *      (`assets/Vazirmatn-*.ttf`) و هیچ چیز از بیرون بار نمی‌شود — فروشگاه
 *      بدونِ دسترسیِ بین‌الملل هم خروجی می‌سازد.
 */

export * from './types.js';
export { renderReportPdf, DocBuilder, drawTable, drawMetaCard, drawTitle, columnWidths, TYPO } from './pdf-doc.js';
export type { TableColumn, TableOptions } from './pdf-doc.js';
export { renderInvoicePdf, invoiceTotals, lineTotal } from './pdf-invoice.js';
export { renderReportExcel, reportFileName } from './xlsx.js';
export {
  formatCell,
  groupDigits,
  jalaliOf,
  numberToPersianWords,
  numericValue,
  tomanDisplay,
  toPersianDigits,
} from './format.js';
export { shapeVisual, measureText, visualString, directionalRuns, toVisualRuns } from './bidi.js';
export type { ShapedGlyph } from './bidi.js';
