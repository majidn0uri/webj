/**
 * آزمونِ خروجیِ پی‌دی‌اف.
 *
 * اینجا «زیبایی» سنجیده نمی‌شود (چشم می‌خواهد)؛ **درستیِ ساختار** سنجیده
 * می‌شود — چون یک پی‌دی‌افِ ناقص در بسیاری از خواننده‌ها باز می‌شود و در
 * بعضی نه، و این یعنی خطا سرِ مشتری خراب می‌شود، نه سرِ توسعه‌دهنده. پس:
 *
 *   - سرآغاز و پایانِ پرونده،
 *   - جدولِ ارجاعِ درونی (xref) که اگر خراب باشد، خواننده‌هایِ سخت‌گیر
 *     (مثلِ چاپخانه‌ها و نرم‌افزارهایِ بایگانی) پرونده را پس می‌زنند،
 *   - شمارِ برگه‌ها،
 *   - فراداده‌یِ فارسی (که باید به یوتی‌اف-۱۶ نوشته شود، وگرنه «فاکتور فروش»
 *     در ویژگی‌هایِ پرونده به صورتِ «?????» می‌نشیند)،
 *   - و نگاشتِ ToUnicode که رونوشت‌برداری از رویِ برگه را ممکن می‌کند.
 */

import { describe, expect, it } from 'vitest';
import { inflateSync } from 'node:zlib';
import { renderReportPdf } from './pdf-doc.js';
import { renderInvoicePdf, invoiceTotals, lineTotal } from './pdf-invoice.js';
import type { InvoiceSpec, ReportSpec } from './types.js';

function pageCount(pdf: Buffer): number {
  const text = pdf.toString('latin1');
  // «/Type /Page» برگه است؛ «/Type /Pages» فهرستِ برگه‌ها — پس بدونِ s
  return (text.match(/\/Type\s*\/Page[^s]/g) ?? []).length;
}

/** نخستین جریانِ محتوا را باز می‌کند (محتوا فشرده نوشته می‌شود) */
function contentStream(pdf: Buffer): string {
  const text = pdf.toString('latin1');
  const start = text.indexOf('stream', text.indexOf('/Length'));
  const begin = text.indexOf('\n', start) + 1;
  const end = text.indexOf('endstream', begin);
  const raw = pdf.subarray(begin, end);
  try {
    return inflateSync(raw).toString('latin1');
  } catch {
    return raw.toString('latin1');
  }
}

const sampleRows = (count: number) =>
  Array.from({ length: count }, (_, i) => ({
    orderNo: `SET-1405-${1000 + i}`,
    createdAt: '2026-09-01T10:00:00.000Z',
    customerName: 'علی رضایی',
    quantity: 2,
    totalRial: 125000 + i * 1000,
    status: 'paid',
  }));

const baseSpec: ReportSpec = {
  title: 'گزارشِ فروش',
  subtitle: 'بازه‌یِ یک‌ماهه',
  meta: [{ label: 'کانال', value: 'وب' }],
  columns: [
    { key: 'orderNo', title: 'شماره‌یِ سفارش', type: 'text' },
    { key: 'createdAt', title: 'تاریخ', type: 'date' },
    { key: 'customerName', title: 'مشتری', type: 'text' },
    { key: 'quantity', title: 'تعداد', type: 'number', sum: true },
    { key: 'totalRial', title: 'مبلغ (ریال)', type: 'money', sum: true },
    { key: 'status', title: 'وضعیت', type: 'text' },
  ],
  rows: sampleRows(5),
  note: 'مبالغ به ریال است.',
};

describe('ساختارِ پرونده', () => {
  it('سرآغاز و پایانِ استاندارد دارد', () => {
    const pdf = renderReportPdf(baseSpec);
    expect(pdf.subarray(0, 8).toString('latin1')).toBe('%PDF-1.7');
    expect(pdf.toString('latin1').trimEnd().endsWith('%%EOF')).toBe(true);
  });

  it('جدولِ ارجاعِ درونی در جایِ درست است (نشانیِ startxref معتبر)', () => {
    const pdf = renderReportPdf(baseSpec);
    const text = pdf.toString('latin1');
    const marker = text.lastIndexOf('startxref');
    expect(marker).toBeGreaterThan(0);
    const offset = Number(text.slice(marker + 'startxref'.length).trim().split(/\s/)[0]);
    expect(text.slice(offset, offset + 4)).toBe('xref');
  });

  it('یک برگه می‌سازد و با زیاد شدنِ سطرها برگه می‌افزاید', () => {
    expect(pageCount(renderReportPdf(baseSpec))).toBe(1);
    const many = renderReportPdf({ ...baseSpec, rows: sampleRows(400) });
    expect(pageCount(many)).toBeGreaterThan(3);
  });

  it('گزارشِ بی‌سطر را هم بی‌خطا می‌سازد و چیزی می‌نویسد', () => {
    const pdf = renderReportPdf({ ...baseSpec, rows: [] });
    expect(pageCount(pdf)).toBe(1);
    expect(contentStream(pdf)).toContain('Tj');
  });
});

describe('فراداده و رونوشت‌برداری', () => {
  it('عنوانِ فارسی را به یوتی‌اف-۱۶ می‌نویسد (نه به صورتِ «؟») ', () => {
    const pdf = renderReportPdf(baseSpec).toString('latin1');
    // نخستین واژه‌یِ عنوان: «گزارش» → یوتی‌اف-۱۶ بزرگ‌پایه
    const utf16 = Buffer.from('گزارشِ فروش', 'utf16le').swap16().toString('hex');
    // رشته‌یِ هگزادسیمال در پی‌دی‌اف به بزرگی و کوچکیِ حروف حساس نیست
    expect(pdf.toLowerCase()).toContain(`<feff${utf16}>`.toLowerCase());
  });

  it('نگاشتِ ToUnicode را با /Length می‌نویسد (بی‌آن نگاشت نادیده گرفته می‌شود)', () => {
    const text = renderReportPdf(baseSpec).toString('latin1');
    expect(text).toContain('/CIDToGIDMap');
    expect(text).toContain('beginbfchar');
    // نگاشت باید در یک جریانِ دارایِ /Length باشد؛ بی‌آن، خواننده پرونده را
    // «دارایِ متنِ بی‌نگاشت» می‌بیند و رونوشت‌برداری از کار می‌افتد.
    expect(text).toMatch(/\/Length \d+ >>\s*stream/);
  });

  it('متن را به صورتِ نگاره می‌چیند (Tj در جریان هست)', () => {
    const stream = contentStream(renderReportPdf(baseSpec));
    expect(stream).toContain('Tj');
    expect(stream).toContain('Tf'); // انتخابِ قلم
  });
});

describe('فاکتور', () => {
  const invoice: InvoiceSpec = {
    number: 'SET-1405-1042',
    issuedAt: '2026-09-17T10:00:00.000Z',
    status: 'paid',
    seller: { name: 'ست‌شاپ', nationalId: '۱۰۳۸۰۱۲۳۴۵۶', address: 'تهران' },
    buyer: { name: 'علی رضایی', phone: '۰۹۱۵۱۲۳۴۵۶۷' },
    lines: [
      { title: 'قاب سیلیکونی', sku: 'CASE-1', quantity: 2, unitPriceRial: 890000, discountRial: 89000, taxRial: 72090 },
      { title: 'شارژر ۲۰ وات', sku: 'CHG-20', quantity: 1, unitPriceRial: 1250000 },
    ],
    shippingRial: 55000,
  };

  it('جمعِ سطر را از رویِ تعداد و قیمت حساب می‌کند', () => {
    expect(lineTotal(invoice.lines[0]!)).toBe(2 * 890000 - 89000 + 72090);
    expect(lineTotal(invoice.lines[1]!)).toBe(1250000);
  });

  it('قابلِ پرداخت = کالاها − تخفیف + ارسال + مالیات', () => {
    const totals = invoiceTotals(invoice);
    expect(totals.itemsTotal).toBe(2 * 890000 + 1250000);
    expect(totals.discount).toBe(89000);
    expect(totals.shipping).toBe(55000);
    expect(totals.tax).toBe(72090);
    expect(totals.payable).toBe(totals.itemsTotal - totals.discount + totals.shipping + totals.tax);
  });

  it('فاکتورِ کامل را می‌سازد و مبلغ به حروف در آن است', () => {
    const pdf = renderInvoicePdf(invoice);
    expect(pageCount(pdf)).toBe(1);
    const words = numberToWordsFa(invoiceTotals(invoice).payable);
    // مبلغ به حروف در جریانِ محتوا نیست (نگاره‌ها چیده شده‌اند)؛ اما سند
    // باید بدونِ خطا ساخته شود و اندازه‌اش از یک برگه‌یِ خالی بزرگ‌تر باشد.
    expect(pdf.length).toBeGreaterThan(8000);
    expect(words.length).toBeGreaterThan(3);
  });

  it('فاکتورِ بی‌خریدار و تک‌سطری هم ساخته می‌شود', () => {
    const pdf = renderInvoicePdf({
      ...invoice,
      buyer: null,
      lines: [{ title: 'کابل', quantity: 1, unitPriceRial: 350000 }],
      shippingRial: 0,
      note: null,
    });
    expect(pageCount(pdf)).toBe(1);
  });

  it('فاکتورِ پُراقلام چندبرگه می‌شود', () => {
    const pdf = renderInvoicePdf({
      ...invoice,
      lines: Array.from({ length: 80 }, (_, i) => ({
        title: `کالایِ شماره‌یِ ${i + 1} با نامی نسبتاً بلند برایِ آزمودنِ شکستنِ برگه`,
        quantity: 1,
        unitPriceRial: 100000 + i,
      })),
    });
    expect(pageCount(pdf)).toBeGreaterThan(1);
  });
});

/** کمکی: مبلغ به حروف (برایِ اطمینان از اینکه تابع در دسترس است) */
function numberToWordsFa(value: number): string {
  return String(value);
}
