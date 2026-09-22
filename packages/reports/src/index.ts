/**
 * @set/reports — گزارش‌هایِ مدیریتی
 *
 * سه گزارش، هر سه روی همان داده‌ای که فروشگاه هر روز می‌نویسد (نه روی یک
 * انبارِ داده‌یِ جدا که باید شبانه پُر شود):
 *
 *   • سودِ ناخالص    → از هر کالا/برند/نوع/روز چقدر سود بردیم؟
 *   • گردشِ موجودی  → کدام کالا سرمایه را خوابانده و کدام زود تمام می‌شود؟
 *   • سنِ بدهی      → چه کسی، چقدر، چقدر دیر بدهکار است؟ و ما به کی بدهکاریم؟
 *
 * قاعده‌یِ مشترکِ هر سه: هیچ عددی در گزارش «تخمینِ خوش‌بینانه» نیست. اگر
 * بخشی از داده ثبت نشده باشد (مثلاً بهایِ تمام‌شده‌یِ فروش‌هایِ قدیمی)،
 * گزارش در warnings می‌گوید — مخفی‌اش نمی‌کند. مدیر باید بتواند به عدد
 * اعتماد کند، یا دست‌کم بداند به کدام بخش نمی‌تواند اعتماد کرد.
 */

export {
  grossProfit,
  GROSS_PROFIT_GROUPINGS,
  type GrossProfitGrouping,
  type GrossProfitInput,
  type GrossProfitReport,
  type GrossProfitRow,
  type GrossProfitTotals,
  type GrossProfitLedgerCheck,
} from './gross-profit.js';

export {
  stockTurnover,
  TURNOVER_THRESHOLDS,
  type StockTurnoverInput,
  type StockTurnoverReport,
  type StockTurnoverRow,
  type StockStatus,
} from './stock-turnover.js';

export {
  debtors,
  type DebtorsInput,
  type DebtorsReport,
  type DebtorRow,
  type PayableRow,
} from './debtors.js';

export {
  cachedReport,
  invalidateReport,
  REPORT_TTL_MS,
  type CachedResult,
} from './cache.js';
