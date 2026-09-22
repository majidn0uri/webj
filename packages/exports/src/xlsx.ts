/**
 * خروجیِ اکسل — همان گزارش، با قدرتِ محاسبه.
 * ============================================================================
 *
 * تفاوتِ اکسل با پی‌دی‌اف فقط قالب نیست؛ **مقصود** فرق می‌کند. پی‌دی‌اف برایِ
 * چشم است، اکسل برایِ کارِ بعدی: حسابدار باید بتواند رویِ ستونِ مبلغ جمع
 * ببندد، رویِ وضعیت صافی بگذارد، و ستون‌ها را جابه‌جا کند. پس در اینجا چند
 * تصمیمِ آگاهانه گرفته شده:
 *
 *   - **اعداد، عدد می‌مانند** (نه رشته). اگر مبلغ را رشته بنویسیم، جمع‌بستن
 *     غیرممکن می‌شود و این همان خطایی است که بیشترِ خروجی‌هایِ آماتور
 *     می‌کنند. قالبِ نمایش (#,##0) جدا است.
 *
 *   - **برگه راست‌چین است** (`rightToLeft`) و سرستون در جا منجمد می‌شود
 *     (`frozen`) تا در یک فایلِ هزارسطری، عنوانِ ستون‌ها از بالا نپرد.
 *
 *   - **صافیِ خودکار** رویِ سرستون گذاشته می‌شود: نخستین کاری که هر کسی با
 *     یک فایلِ گزارش می‌کند، جدا کردنِ سطرهاست.
 *
 *   - **تاریخ‌ها شمسی‌اند** و به صورتِ متن نوشته می‌شوند. چرا متن و نه
 *     تاریخِ اکسل؟ چون اکسل تقویمِ شمسی نمی‌فهمد و «۱۴۰۵/۰۶/۲۶» را یا تاریخِ
 *     میلادیِ اشتباه نشان می‌دهد یا ردیف را خراب می‌کند. متنِ شمسی، چون با
 *     صفرِ پیشین کامل است (۱۴۰۵/۰۶/۰۲)، درست مرتب می‌شود.
 *
 *   - **تنظیماتِ چاپ** هم آماده می‌شود: A4، کشیده‌شده در پهنا، با حاشیه‌یِ کم
 *     — تا کسی که فایل را چاپ می‌گیرد، ستونی را نبُرد.
 */

import ExcelJS from 'exceljs';
import { formatJalali } from '@set/shared-kernel';
import { jalaliOf, numericValue } from './format.js';
import type { CellValue, ColumnType, ReportRow, ReportSpec } from './types.js';

/* ------------------------------- ابزارها --------------------------------- */

/** نامِ برگه را برایِ اکسل پاک می‌کند: اکسل چند نویسه را در نام نمی‌پذیرد */
function safeSheetName(input: string): string {
  const cleaned = input.replace(/[\\/?*[\]:]/g, ' ').trim();
  return (cleaned === '' ? 'گزارش' : cleaned).slice(0, 31);
}

/** پهنایِ تقریبیِ یک رشته برایِ اکسل (واحدِ پهنا ≈ یک نویسه) */
function displayWidth(value: string): number {
  // نویسه‌هایِ پهن (فارسی/عربی) جایِ بیشتری می‌گیرند
  let width = 0;
  for (const ch of value) {
    const code = ch.codePointAt(0) ?? 0;
    width +=
      (code >= 0x0600 && code <= 0x06ff) || (code >= 0xfb50 && code <= 0xfdff)
        ? 1.15
        : code >= 0x0300
          ? 0.4
          : 1;
  }
  return width;
}

function columnWidthFor(title: string, values: string[], type: ColumnType): number {
  const widest = values.reduce((max, v) => Math.max(max, displayWidth(v)), displayWidth(title));
  const factor = type === 'money' ? 1.05 : type === 'text' ? 1.12 : 1;
  return Math.min(46, Math.max(9, Math.round(widest * factor) + 3));
}

/** مقدارِ یک سلول برایِ اکسل: عدد اگر عدد است، وگرنه رشته */
function excelValue(value: CellValue, type: ColumnType): string | number | null {
  if (value === null || value === undefined || value === '') return null;

  switch (type) {
    case 'money':
    case 'number': {
      const num = numericValue(value);
      return num === null ? String(value) : num;
    }
    case 'percent': {
      const num = numericValue(value);
      return num === null ? String(value) : num;
    }
    case 'date':
      return jalaliOf(value as Date | string, false);
    case 'datetime':
      return jalaliOf(value as Date | string, true);
    case 'boolean':
      return value === true || value === 'true' ? 'بله' : 'خیر';
    default:
      return String(value);
  }
}

const MONEY_FORMAT = '#,##0;[Red]-#,##0';
const NUMBER_FORMAT = '#,##0';
const PERCENT_FORMAT = '0"٪"';

/* --------------------------------- رندرر --------------------------------- */

/**
 * ساختنِ کارپوشه‌یِ اکسل از یک گزارش.
 *
 * خروجی یک «فایلِ آماده‌یِ کار» است، نه یک جدولِ ساده: عنوان، مشخصات، سرستونِ
 * منجمد، صافی، قالبِ عدد، سطرِ جمع، و تنظیماتِ چاپ — همان چیزی که اگر نباشد،
 * گیرنده ناچار است دستی درستش کند.
 */
export async function renderReportExcel(spec: ReportSpec): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'ست‌شاپ';
  workbook.lastModifiedBy = 'ست‌شاپ';
  workbook.created = new Date();
  workbook.company = 'ست‌شاپ';

  const worksheet = workbook.addWorksheet(safeSheetName(spec.sheetName ?? spec.title ?? 'گزارش'), {
    views: [{ rightToLeft: true }],
    pageSetup: {
      paperSize: 9, // A4
      orientation: spec.landscape ? 'landscape' : 'portrait',
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
      margins: { left: 0.4, right: 0.4, top: 0.5, bottom: 0.5, header: 0.3, footer: 0.3 },
    },
    properties: { defaultRowHeight: 16 },
  });

  const columns = spec.columns;
  const rowNumbers = spec.rowNumbers ?? true;
  const meta = spec.meta ?? [];

  // ستون‌ها: ستونِ ردیف در سمتِ راست (= نخستین ستون)
  const headers: string[] = rowNumbers ? ['ردیف', ...columns.map((c) => c.title)] : columns.map((c) => c.title);
  const columnCount = headers.length;

  let rowIndex = 1;

  /* ── عنوان ─────────────────────────────────────────────────────────── */
  const titleRow = worksheet.getRow(rowIndex);
  titleRow.getCell(1).value = spec.title;
  worksheet.mergeCells(rowIndex, 1, rowIndex, columnCount);
  titleRow.getCell(1).font = { name: 'Tahoma', size: 14, bold: true, color: { argb: 'FF17202A' } };
  titleRow.getCell(1).alignment = { horizontal: 'right', vertical: 'middle' };
  titleRow.height = 24;
  rowIndex += 1;

  if (spec.subtitle) {
    const subRow = worksheet.getRow(rowIndex);
    subRow.getCell(1).value = spec.subtitle;
    worksheet.mergeCells(rowIndex, 1, rowIndex, columnCount);
    subRow.getCell(1).font = { name: 'Tahoma', size: 10, color: { argb: 'FF6B7280' } };
    subRow.getCell(1).alignment = { horizontal: 'right', vertical: 'middle' };
    rowIndex += 1;
  }

  /* ── مشخصات ────────────────────────────────────────────────────────── */
  for (const item of meta) {
    const row = worksheet.getRow(rowIndex);
    row.getCell(1).value = item.label;
    row.getCell(1).font = { name: 'Tahoma', size: 10, color: { argb: 'FF6B7280' } };
    row.getCell(2).value = item.value;
    if (columnCount > 2) worksheet.mergeCells(rowIndex, 2, rowIndex, columnCount);
    row.getCell(2).font = { name: 'Tahoma', size: 10, bold: true, color: { argb: 'FF17202A' } };
    row.getCell(2).alignment = { horizontal: 'right' };
    rowIndex += 1;
  }

  if (meta.length > 0) rowIndex += 1;

  /* ── سرستون ────────────────────────────────────────────────────────── */
  const headerRowIndex = rowIndex;
  const headerRow = worksheet.getRow(headerRowIndex);
  headers.forEach((title, index) => {
    const cell = headerRow.getCell(index + 1);
    cell.value = title;
    cell.font = { name: 'Tahoma', size: 10, bold: true, color: { argb: 'FF17202A' } };
    cell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFE8EDF5' },
    };
    cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: false };
    cell.border = {
      top: { style: 'thin', color: { argb: 'FFB6C2D1' } },
      bottom: { style: 'medium', color: { argb: 'FF8A9BB0' } },
      left: { style: 'thin', color: { argb: 'FFB6C2D1' } },
      right: { style: 'thin', color: { argb: 'FFB6C2D1' } },
    };
  });
  headerRow.height = 22;
  rowIndex += 1;

  /* ── سطرها ─────────────────────────────────────────────────────────── */
  const firstDataRow = rowIndex;
  spec.rows.forEach((row, index) => {
    const excelRow = worksheet.getRow(rowIndex);
    const offset = rowNumbers ? 2 : 1;

    if (rowNumbers) {
      const noCell = excelRow.getCell(1);
      noCell.value = index + 1;
      noCell.numFmt = NUMBER_FORMAT;
      noCell.alignment = { horizontal: 'center' };
    }

    columns.forEach((column, columnIndex) => {
      const type = column.type ?? 'text';
      const cell = excelRow.getCell(columnIndex + offset);
      const value = excelValue(row[column.key], type);
      cell.value = value;

      if (type === 'money' || type === 'number') {
        cell.numFmt = type === 'money' ? MONEY_FORMAT : NUMBER_FORMAT;
        cell.alignment = { horizontal: 'right' };
      } else if (type === 'percent') {
        cell.numFmt = PERCENT_FORMAT;
        cell.alignment = { horizontal: 'right' };
      } else if (type === 'date' || type === 'datetime') {
        cell.alignment = { horizontal: 'right' };
      } else {
        cell.alignment = { horizontal: 'right', vertical: 'middle' };
      }
    });

    // راه‌راهِ ملایم: در یک فایلِ بلند، چشم ردیف را گم می‌کند
    if (index % 2 === 1) {
      for (let col = 1; col <= columnCount; col += 1) {
        excelRow.getCell(col).fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FFF8FAFC' },
        };
      }
    }

    rowIndex += 1;
  });
  const lastDataRow = rowIndex - 1;

  /* ── سطرِ جمع ──────────────────────────────────────────────────────── */
  const summed = columns.filter((column) => column.sum);
  if (summed.length > 0 && spec.rows.length > 0) {
    const totalRow = worksheet.getRow(rowIndex);
    const offset = rowNumbers ? 2 : 1;

    const labelCell = totalRow.getCell(1);
    labelCell.value = spec.totalsLabel ?? 'جمع';
    labelCell.font = { name: 'Tahoma', size: 10, bold: true };
    labelCell.alignment = { horizontal: 'center' };

    columns.forEach((column, columnIndex) => {
      if (!column.sum) return;
      const total = spec.rows.reduce((sum, row) => sum + (numericValue(row[column.key]) ?? 0), 0);
      const cell = totalRow.getCell(columnIndex + offset);
      cell.value = total;
      cell.numFmt = column.type === 'money' ? MONEY_FORMAT : NUMBER_FORMAT;
      cell.font = { name: 'Tahoma', size: 10, bold: true };
      cell.alignment = { horizontal: 'right' };
    });

    for (let col = 1; col <= columnCount; col += 1) {
      const cell = totalRow.getCell(col);
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE2E8F0' } };
      cell.border = {
        top: { style: 'medium', color: { argb: 'FF475569' } },
        bottom: { style: 'thin', color: { argb: 'FF94A3B8' } },
      };
      if (!cell.font?.bold) cell.font = { name: 'Tahoma', size: 10, bold: true };
    }
    rowIndex += 1;
  }

  /* ── یادداشت ───────────────────────────────────────────────────────── */
  if (spec.note) {
    rowIndex += 1;
    const noteRow = worksheet.getRow(rowIndex);
    noteRow.getCell(1).value = spec.note;
    worksheet.mergeCells(rowIndex, 1, rowIndex, columnCount);
    noteRow.getCell(1).font = { name: 'Tahoma', size: 9, color: { argb: 'FF6B7280' } };
    noteRow.getCell(1).alignment = { horizontal: 'right', wrapText: true };
  }

  /* ── پهنا، صافی، انجماد ────────────────────────────────────────────── */
  const sampleValues = (columnKey: string, type: ColumnType): string[] => {
    const values = spec.rows.slice(0, 400).map((row) => {
      const value = excelValue(row[columnKey], type);
      return value === null ? '' : String(value);
    });
    return values;
  };

  // پهنا ستون‌به‌ستون تنظیم می‌شود و نه با `worksheet.columns = [...]`:
  // آن انتساب (در exceljs) برایِ کارپوشه‌ای است که هنوز سطری ندارد و در غیرِ
  // این صورت ردیفِ نخست را با سرستون بازنویسی می‌کند — یعنی عنوانِ گزارش را
  // می‌بُرد. اینجا سطرها پیش‌تر نوشته شده‌اند، پس تنها پهنا را می‌نویسیم.
  headers.forEach((title, index) => {
    const width =
      rowNumbers && index === 0
        ? 7
        : columnWidthFor(
            title,
            sampleValues(columns[rowNumbers ? index - 1 : index]!.key, columns[rowNumbers ? index - 1 : index]!.type ?? 'text'),
            columns[rowNumbers ? index - 1 : index]!.type ?? 'text',
          );
    worksheet.getColumn(index + 1).width = width;
  });

  if (spec.rows.length > 0) {
    worksheet.autoFilter = {
      from: { row: headerRowIndex, column: 1 },
      to: { row: lastDataRow, column: columnCount },
    };
  }

  // انجمادِ سرستون: همراه با راست‌چینی، در یک نگاهِ واحد
  worksheet.views = [
    {
      rightToLeft: true,
      state: 'frozen',
      ySplit: headerRowIndex,
      xSplit: 0,
      activeCell: `A${firstDataRow}`,
      zoomScale: 100,
    } as ExcelJS.WorksheetView,
  ];

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

/** نامِ پیشنهادیِ فایل برایِ یک گزارش (با پسوند) */
export function reportFileName(spec: ReportSpec, extension: 'xlsx' | 'pdf'): string {
  // ارقامِ لاتین، نه فارسی: نامِ پرونده در سربرگِ HTTP و در خطِ فرمان رد و
  // بدل می‌شود و آن‌جا ارقامِ فارسی دردسر می‌سازد.
  const date = formatJalali(new Date(), 'yyyyMMdd', false);
  const base = (spec.fileBase ?? spec.sheetName ?? spec.title ?? 'report')
    .replace(/[^\w\-.]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return `${base || 'report'}-${date}.${extension}`;
}
