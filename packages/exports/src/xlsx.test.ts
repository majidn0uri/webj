/**
 * آزمونِ خروجیِ اکسل.
 *
 * این آزمون‌ها با خواندنِ دوباره‌یِ پرونده انجام می‌شوند: یعنی همان کاری را
 * می‌کنیم که حسابدار می‌کند (فایل را در اکسل باز می‌کند). چرا؟ چون یک فایل
 * می‌تواند ساخته شود و در عین حال به کارِ بعدی نیاید — مثلاً اگر مبلغ را
 * رشته نوشته باشیم، پرونده سالم است اما رویِ ستون نمی‌شود جمع بست؛ و این
 * خطایی است که فقط با خواندنِ دوباره آشکار می‌شود.
 */

import { describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';
import { renderReportExcel, reportFileName } from './xlsx.js';
import type { ReportSpec } from './types.js';

const spec: ReportSpec = {
  title: 'گزارشِ فروش',
  subtitle: 'بازه‌یِ یک‌ماهه',
  sheetName: 'فروش',
  meta: [{ label: 'کانال', value: 'وب' }],
  columns: [
    { key: 'orderNo', title: 'شماره‌یِ سفارش', type: 'text' },
    { key: 'createdAt', title: 'تاریخ', type: 'date' },
    { key: 'quantity', title: 'تعداد', type: 'number', sum: true },
    { key: 'totalRial', title: 'مبلغ (ریال)', type: 'money', sum: true },
  ],
  rows: [
    { orderNo: 'SET-1405-1000', createdAt: '2026-09-01T10:00:00.000Z', quantity: 2, totalRial: 1780000 },
    { orderNo: 'SET-1405-1001', createdAt: '2026-09-02T10:00:00.000Z', quantity: 1, totalRial: 1250000 },
    { orderNo: 'SET-1405-1002', createdAt: '2026-09-03T10:00:00.000Z', quantity: 3, totalRial: 1050000 },
  ],
  note: 'مبالغ به ریال است.',
};

async function readBack(buffer: Buffer): Promise<ExcelJS.Worksheet> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
  return workbook.worksheets[0]!;
}

describe('کارپوشه', () => {
  it('برگه‌ای راست‌چین با سرستونِ منجمد می‌سازد', async () => {
    const sheet = await readBack(await renderReportExcel(spec));
    expect(sheet.name).toBe('فروش');
    expect(sheet.views[0]?.rightToLeft).toBe(true);
    expect(sheet.views[0]?.state).toBe('frozen');
    expect(sheet.views[0]?.ySplit).toBeGreaterThan(0);
  });

  it('صافیِ خودکار را رویِ سرستون می‌گذارد', async () => {
    const sheet = await readBack(await renderReportExcel(spec));
    // هنگامِ خواندنِ دوباره، صافی به صورتِ نشانیِ بازه برمی‌گردد (مثلِ A5:D8)
    const filter = sheet.autoFilter as unknown as string | { from?: { row?: number } } | undefined;
    expect(filter).toBeTruthy();
    const range =
      typeof filter === 'string'
        ? filter
        : filter?.from?.row
          ? `A${filter.from.row}`
          : '';
    // سرستون در ردیفِ ۵ است: عنوان (۱)، زیرعنوان (۲)، مشخصه (۳)، فاصله (۴)
    expect(range.startsWith('A5')).toBe(true);
  });

  it('مبلغ و تعداد را **عدد** می‌نویسد تا بشود روی‌شان حساب کرد', async () => {
    const sheet = await readBack(await renderReportExcel(spec));
    const dataRow = sheet.getRow(6);
    expect(typeof dataRow.getCell(4).value).toBe('number'); // تعداد
    expect(typeof dataRow.getCell(5).value).toBe('number'); // مبلغ
    expect(dataRow.getCell(5).value).toBe(1780000);
  });

  it('تاریخ را شمسی و به صورتِ رشته‌یِ مرتب‌پذیر می‌نویسد', async () => {
    const sheet = await readBack(await renderReportExcel(spec));
    const value = sheet.getRow(6).getCell(3).value;
    expect(value).toBe('۱۴۰۵/۰۶/۱۰');
  });

  it('سطرِ جمع را با مجموعِ درست می‌نویسد', async () => {
    const sheet = await readBack(await renderReportExcel(spec));
    const totals = sheet.getRow(9);
    expect(totals.getCell(1).value).toBe('جمع');
    expect(totals.getCell(4).value).toBe(6); // ۲ + ۱ + ۳
    expect(totals.getCell(5).value).toBe(4080000);
  });

  it('قالبِ نمایشِ هزارگان را رویِ ستونِ مبلغ می‌گذارد', async () => {
    const sheet = await readBack(await renderReportExcel(spec));
    expect(sheet.getRow(6).getCell(5).numFmt).toContain('#,##0');
  });

  it('گزارشِ بی‌سطر را بی‌خطا می‌سازد', async () => {
    const sheet = await readBack(await renderReportExcel({ ...spec, rows: [] }));
    expect(sheet.getRow(1).getCell(1).value).toBe('گزارشِ فروش');
  });

  /**
   * چرا نامِ پرونده لاتین است در حالی که عنوان فارسی است؟
   * چون نامِ پرونده دو جا به کار می‌رود که فارسی در آن‌ها آسیب می‌بیند:
   * سربرگِ content-disposition (که میدانِ لاتینش بی‌دردسر منتقل می‌شود) و
   * سیستم‌عامل/خطِ فرمانِ مقصد. عنوان برایِ چشمِ خواننده فارسی می‌ماند؛
   * نامِ پرونده برایِ ماشین لاتین می‌شود.
   */
  it('نامِ پرونده را لاتین و با تاریخِ شمسیِ لاتین می‌سازد', () => {
    expect(reportFileName(spec, 'xlsx')).toMatch(/^[a-z0-9-]+-\d{8}\.xlsx$/);
    expect(reportFileName(spec, 'pdf')).toMatch(/^[a-z0-9-]+-\d{8}\.pdf$/);
  });

  it('نامِ لاتینِ ویژه (fileBase) بر نامِ برگه مقدّم است', () => {
    expect(reportFileName({ ...spec, fileBase: 'gross-profit' }, 'xlsx')).toMatch(
      /^gross-profit-\d{8}\.xlsx$/,
    );
  });

  it('عنوانِ فارسی را به نامی امن می‌برد، نه به رشته‌ای از زیرخط', () => {
    // پیش از این «گزارشِ فروش» در سربرگ به «________» بدل می‌شد
    const name = reportFileName({ ...spec, fileBase: undefined, sheetName: undefined }, 'xlsx');
    expect(name).not.toMatch(/^[-_]/);
    expect(name).toMatch(/^[a-z0-9-]*-?\d{8}\.xlsx$/);
  });
});
