'use client';

import { useCallback, useEffect, useMemo, useState, useTransition } from 'react';
import { toman } from '@/lib/format';
import { ShamsiDatePicker } from '@/components/shamsi-date-picker';
import {
  loadDebtors,
  loadGrossProfit,
  loadStockTurnover,
  type DebtorsReportView,
  type GrossProfitReportView,
  type StockTurnoverReportView,
} from '@/lib/report-actions';

/**
 * پنلِ گزارش‌هایِ مدیریتی.
 *
 * سه قانونِ نمایش در این صفحه:
 *
 *   ۱) عددِ بد، پنهان نمی‌شود. اگر بخشی از داده ثبت نشده (مثلاً بهایِ
 *      تمام‌شده‌یِ فروش‌هایِ قدیمی) یا دفترکل با ردیف‌هایِ فروش جور نیست،
 *      بالایِ جدول هشدار می‌آید. مدیری که به عددِ غلط اعتماد کند، تصمیمِ
 *      غلط می‌گیرد — و بدتر از بی‌خبری است.
 *   ۲) هر گزارش می‌گوید عدد از کی است (زمانِ ساخت) و آیا از میانگیر آمده یا
 *      تازه ساخته شده؛ و دکمه‌یِ «بازسازی» هست تا مدیر بتواند نتیجه‌یِ
 *      کهنه را دور بیندازد.
 *   ۳) مبالغ همیشه تومان و با ارقامِ فارسی‌اند (پایگاه ریال نگه می‌دارد)،
 *      و خروجیِ CSV با BOM است تا در اکسلِ ویندوز فارسی خراب نشود.
 */

type Tab = 'profit' | 'turnover' | 'debtors';

const TABS: Array<{ key: Tab; label: string; hint: string }> = [
  { key: 'profit', label: 'سودِ ناخالص', hint: 'چقدر سود بردیم؟' },
  { key: 'turnover', label: 'گردشِ موجودی', hint: 'کدام کالا پول را خوابانده؟' },
  { key: 'debtors', label: 'سنِ بدهی', hint: 'چه کسی چقدر دیر بدهکار است؟' },
];

const GROUP_LABEL: Record<string, string> = {
  variant: 'کالا',
  brand: 'برند',
  product_type: 'نوعِ کالا',
  day: 'روز',
};

const STATUS_LABEL: Record<string, { text: string; tone: string }> = {
  fast: { text: 'تند‌گردش', tone: 'pill pill--ok' },
  normal: { text: 'عادی', tone: 'pill pill--muted' },
  slow: { text: 'کند‌گردش', tone: 'pill pill--warn' },
  dead: { text: 'راکد', tone: 'pill pill--danger' },
};

const RISK_LABEL: Record<string, { text: string; tone: string }> = {
  none: { text: 'سالم', tone: 'pill pill--ok' },
  watch: { text: 'نیاز به پیگیری', tone: 'pill pill--warn' },
  high: { text: 'خطرِ بدحسابی', tone: 'pill pill--danger' },
};

/** تبدیلِ جدول به CSV با BOM (بدان اکسل در ویندوز فارسی را درست باز می‌کند) */
function downloadCsv(name: string, header: string[], rows: Array<Array<string | number>>): void {
  const escape = (v: string | number) => {
    const s = String(v ?? '');
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = [header.map(escape).join(','), ...rows.map((r) => r.map(escape).join(','))].join('\r\n');
  const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${name}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="stat">
      <span className="stat__label">{label}</span>
      <span className="stat__value stat__value--money">{value}</span>
      {hint ? <span className="stat__hint">{hint}</span> : null}
    </div>
  );
}

function Warnings({ items }: { items: string[] }) {
  if (items.length === 0) return null;
  return (
    <div className="alert alert--warn" role="status">
      <strong>پیش از اعتماد به این عدد بخوانید:</strong>
      <ul className="report-list">
        {items.map((w) => (
          <li key={w}>{w}</li>
        ))}
      </ul>
    </div>
  );
}

function CacheNote({
  meta,
  onRebuild,
  pending,
}: {
  meta: { cached: boolean; generatedAt: string; buildMs: number } | null;
  onRebuild: () => void;
  pending: boolean;
}) {
  if (!meta) return null;
  const time = new Date(meta.generatedAt).toLocaleTimeString('fa-IR', { hour: '2-digit', minute: '2-digit' });
  const build =
    meta.buildMs < 1000
      ? `${meta.buildMs} میلی‌ثانیه`
      : `${(meta.buildMs / 1000).toFixed(1)} ثانیه`;
  return (
    <div className="panel__note">
      <span>
        {meta.cached ? 'از میانگیر' : 'تازه ساخته شده'} — ساعت {time}، زمانِ ساخت {build}
      </span>
      <button type="button" className="btn btn--ghost btn--xs" onClick={onRebuild} disabled={pending}>
        {pending ? 'در حالِ ساخت…' : 'بازسازی'}
      </button>
    </div>
  );
}

export function ReportsPanel({
  initialProfit,
  initialTurnover,
  initialDebtors,
  todayJalali,
}: {
  initialProfit: GrossProfitReportView | null;
  initialTurnover: StockTurnoverReportView | null;
  initialDebtors: DebtorsReportView | null;
  todayJalali: string;
}) {
  const [tab, setTab] = useState<Tab>('profit');
  const [pending, startTransition] = useTransition();

  // --- سودِ ناخالص
  const [from, setFrom] = useState(initialProfit?.fromJalali ?? todayJalali);
  const [to, setTo] = useState(initialProfit?.toJalali ?? todayJalali);
  const [groupBy, setGroupBy] = useState(initialProfit?.groupBy ?? 'variant');
  const [channel, setChannel] = useState('');
  const [profit, setProfit] = useState(initialProfit);
  const [profitMeta, setProfitMeta] = useState<{
    cached: boolean;
    generatedAt: string;
    buildMs: number;
  } | null>(null);
  const [profitError, setProfitError] = useState<string | null>(null);

  // --- گردشِ موجودی
  const [windowDays, setWindowDays] = useState(initialTurnover?.windowDays ?? 90);
  const [turnover, setTurnover] = useState(initialTurnover);
  const [turnoverMeta, setTurnoverMeta] = useState<{
    cached: boolean;
    generatedAt: string;
    buildMs: number;
  } | null>(null);

  // --- سنِ بدهی
  const [term, setTerm] = useState(initialDebtors?.creditTermDays ?? 30);
  const [debtors, setDebtors] = useState(initialDebtors);
  const [debtorsMeta, setDebtorsMeta] = useState<{
    cached: boolean;
    generatedAt: string;
    buildMs: number;
  } | null>(null);

  const runProfit = useCallback(
    (rebuild = false) => {
      setProfitError(null);
      startTransition(async () => {
        const res = await loadGrossProfit({ from, to, groupBy, channel, rebuild });
        if (res.ok) {
          setProfit(res.report);
          setProfitMeta(res.meta);
        } else {
          setProfitError(res.message);
        }
      });
    },
    [from, to, groupBy, channel],
  );

  const runTurnover = useCallback(
    (rebuild = false) => {
      startTransition(async () => {
        const res = await loadStockTurnover({ windowDays, rebuild });
        if (res.ok) {
          setTurnover(res.report);
          setTurnoverMeta(res.meta);
        }
      });
    },
    [windowDays],
  );

  const runDebtors = useCallback(
    (rebuild = false) => {
      startTransition(async () => {
        const res = await loadDebtors({ creditTermDays: term, rebuild });
        if (res.ok) {
          setDebtors(res.report);
          setDebtorsMeta(res.meta);
        }
      });
    },
    [term],
  );

  // تغییرِ فیلتر، گزارش را دوباره می‌خواند (بدونِ نیاز به دکمه)
  useEffect(() => {
    runProfit(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [from, to, groupBy, channel]);

  useEffect(() => {
    if (!turnover) runTurnover(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [windowDays]);

  useEffect(() => {
    if (!debtors) runDebtors(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [term]);

  const profitRows = useMemo(() => profit?.rows ?? [], [profit]);

  return (
    <div className="page">
      <div className="head">
        <h1 className="head__title">گزارش‌هایِ مدیریتی</h1>
        <p className="head__sub">
          سه عدد که تصمیمِ ماهانه را می‌سازند: چقدر سود بردیم، کدام کالا سرمایه را
          خوابانده، و چه کسی دیر پرداخت می‌کند.
        </p>
      </div>

      <div className="tabs" role="tablist">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={tab === t.key}
            className={`tab${tab === t.key ? ' tab--active' : ''}`}
            onClick={() => setTab(t.key)}
          >
            <span className="tab__label">{t.label}</span>
            <span className="tab__hint">{t.hint}</span>
          </button>
        ))}
      </div>

      {tab === 'profit' ? (
        <section className="panel panel--pad">
          <div className="panel__head">
            <h2 className="panel__title">سودِ ناخالص</h2>
            <CacheNote meta={profitMeta} pending={pending} onRebuild={() => runProfit(true)} />
          </div>

          <div className="filters">
            <label className="field">
              <span className="field__label">از تاریخ (شمسی)</span>
              <ShamsiDatePicker value={from} onChange={setFrom} format="jalali" placeholder="۱۴۰۵/۰۱/۰۱" />
            </label>
            <label className="field">
              <span className="field__label">تا تاریخ (شمسی)</span>
              <ShamsiDatePicker value={to} onChange={setTo} format="jalali" placeholder="۱۴۰۵/۰۱/۳۱" />
            </label>
            <label className="field">
              <span className="field__label">گروه‌بندی</span>
              <select
                className="field__input field__input--sm"
                value={groupBy}
                onChange={(e) => setGroupBy(e.target.value)}
              >
                {Object.entries(GROUP_LABEL).map(([key, label]) => (
                  <option key={key} value={key}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span className="field__label">کانال</span>
              <select
                className="field__input field__input--sm"
                value={channel}
                onChange={(e) => setChannel(e.target.value)}
              >
                <option value="">همه</option>
                <option value="web">فروشِ اینترنتی</option>
                <option value="pos">فروشِ حضوری</option>
              </select>
            </label>
            <button
              type="button"
              className="btn btn--ghost btn--xs"
              onClick={() =>
                downloadCsv(
                  `سود-ناخالص-${from.replace(/\//g, '-')}-${to.replace(/\//g, '-')}`,
                  ['ردیف', 'تعداد', 'فروش (تومان)', 'بهای کالا (تومان)', 'سود (تومان)', 'حاشیه (٪)'],
                  profitRows.map((r) => [
                    r.label,
                    r.quantity,
                    toman(r.revenueRial),
                    toman(r.cogsRial),
                    toman(r.grossProfitRial),
                    r.marginPercent,
                  ]),
                )
              }
            >
              خروجیِ اکسل
            </button>
          </div>

          {profitError ? <div className="alert alert--danger">{profitError}</div> : null}

          {profit ? (
            <>
              <Warnings items={profit.warnings} />

              <div className="stats">
                <Stat label="فروشِ خالص (بی‌ارزش افزوده)" value={toman(profit.totals.revenueRial)} />
                <Stat label="بهایِ کالای فروخته‌شده" value={toman(profit.totals.cogsRial)} />
                <Stat
                  label="سودِ ناخالص"
                  value={toman(profit.totals.grossProfitRial)}
                  hint={`حاشیه: ${profit.totals.marginPercent}٪`}
                />
                <Stat
                  label="درآمدِ ارسال"
                  value={toman(profit.totals.shippingRial)}
                  hint="در محاسبه‌یِ سودِ کالا نیست"
                />
              </div>

              <div
                className={`alert ${profit.ledger.matches ? 'alert--ok' : 'alert--danger'}`}
                role="status"
              >
                {profit.ledger.matches
                  ? 'دفترکل با ردیف‌هایِ فروش هم‌خوان است: هیچ فروشی بی‌سند نمانده است.'
                  : `دفترکل با ردیف‌هایِ فروش ${toman(profit.ledger.differenceRial)} تومان اختلاف دارد؛ سندِ دستی یا فروشِ بی‌سند در این دوره هست.`}
              </div>

              <table className="table">
                <thead>
                  <tr>
                    <th>{GROUP_LABEL[profit.groupBy] ?? 'ردیف'}</th>
                    <th className="ta-left">تعداد</th>
                    <th className="ta-left">فروش (تومان)</th>
                    <th className="ta-left">بهای کالا (تومان)</th>
                    <th className="ta-left">سود (تومان)</th>
                    <th className="ta-left">حاشیه</th>
                  </tr>
                </thead>
                <tbody>
                  {profitRows.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="empty">
                        در این بازه فروشی ثبت نشده است.
                      </td>
                    </tr>
                  ) : (
                    profitRows.map((r) => (
                      <tr key={r.key}>
                        <td>{r.label}</td>
                        <td className="num">{r.quantity}</td>
                        <td className="num">{toman(r.revenueRial)}</td>
                        <td className="num">{toman(r.cogsRial)}</td>
                        <td className="num ok">{toman(r.grossProfitRial)}</td>
                        <td className="num">
                          <span
                            className={
                              r.marginPercent < 0
                                ? 'pill pill--danger'
                                : r.marginPercent < 10
                                  ? 'pill pill--warn'
                                  : 'pill pill--ok'
                            }
                          >
                            {r.marginPercent}٪
                          </span>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
                <tfoot className="table__foot table__foot--strong">
                  <tr>
                    <td>جمع</td>
                    <td className="num">{profit.totals.quantity}</td>
                    <td className="num">{toman(profit.totals.revenueRial)}</td>
                    <td className="num">{toman(profit.totals.cogsRial)}</td>
                    <td className="num">{toman(profit.totals.grossProfitRial)}</td>
                    <td className="num">{profit.totals.marginPercent}٪</td>
                  </tr>
                </tfoot>
              </table>
            </>
          ) : (
            <div className="empty-state">در حالِ بارگیری…</div>
          )}
        </section>
      ) : null}

      {tab === 'turnover' ? (
        <section className="panel panel--pad">
          <div className="panel__head">
            <h2 className="panel__title">گردشِ موجودی</h2>
            <CacheNote meta={turnoverMeta} pending={pending} onRebuild={() => runTurnover(true)} />
          </div>

          <div className="filters">
            <label className="field">
              <span className="field__label">پنجره‌ی بررسی</span>
              <select
                className="field__input field__input--sm"
                value={windowDays}
                onChange={(e) => setWindowDays(Number(e.target.value))}
              >
                <option value={30}>۳۰ روز</option>
                <option value={90}>۹۰ روز</option>
                <option value={180}>۱۸۰ روز</option>
                <option value={365}>یک سال</option>
              </select>
            </label>
            <button
              type="button"
              className="btn btn--ghost btn--xs"
              onClick={() =>
                downloadCsv(
                  `گردش-موجودی-${windowDays}-روز`,
                  [
                    'کالا',
                    'شناسه',
                    'فروش (تعداد)',
                    'بهای کالای فروخته‌شده (تومان)',
                    'موجودی (تعداد)',
                    'ارزشِ موجودی (تومان)',
                    'گردش در سال',
                    'روزهایِ گردش',
                    'وضعیت',
                  ],
                  (turnover?.rows ?? []).map((r) => [
                    r.title,
                    r.sku,
                    r.soldQuantity,
                    toman(r.cogsRial),
                    r.closingQuantity,
                    toman(r.closingValueRial),
                    r.turnoverPerYear ?? '—',
                    r.daysOfInventory ?? '—',
                    STATUS_LABEL[r.status]?.text ?? r.status,
                  ]),
                )
              }
            >
              خروجیِ اکسل
            </button>
          </div>

          {turnover ? (
            <>
              <Warnings items={turnover.warnings} />

              <div className="stats">
                <Stat
                  label="ارزشِ موجودی"
                  value={toman(turnover.totals.inventoryValueRial)}
                  hint="بهایِ میانگینِ موزون"
                />
                <Stat
                  label="سرمایه‌ی خوابیده در کالایِ راکد"
                  value={toman(turnover.totals.deadStockValueRial)}
                  hint={`${turnover.totals.deadStockCount} کالا در این پنجره فروش نداشته است`}
                />
                <Stat
                  label="گردشِ کل در سال"
                  value={turnover.totals.turnoverPerYear === null ? '—' : `${turnover.totals.turnoverPerYear} بار`}
                />
                <Stat
                  label="دوامِ موجودی"
                  value={turnover.totals.daysOfInventory === null ? '—' : `${turnover.totals.daysOfInventory} روز`}
                />
              </div>

              <table className="table">
                <thead>
                  <tr>
                    <th>کالا</th>
                    <th className="ta-left">فروش</th>
                    <th className="ta-left">موجودی</th>
                    <th className="ta-left">ارزشِ موجودی (تومان)</th>
                    <th className="ta-left">گردش در سال</th>
                    <th className="ta-left">دوام (روز)</th>
                    <th>وضعیت</th>
                  </tr>
                </thead>
                <tbody>
                  {turnover.rows.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="empty">
                        کالایی برای بررسی نیست.
                      </td>
                    </tr>
                  ) : (
                    turnover.rows.map((r) => (
                      <tr key={r.variantId}>
                        <td>
                          <span className="cell__title">{r.title}</span>
                          <span className="muted"> — {r.sku}</span>
                        </td>
                        <td className="num">{r.soldQuantity}</td>
                        <td className="num">{r.closingQuantity}</td>
                        <td className="num">{toman(r.closingValueRial)}</td>
                        <td className="num">{r.turnoverPerYear ?? '—'}</td>
                        <td className="num">{r.daysOfInventory ?? '—'}</td>
                        <td>
                          <span className={STATUS_LABEL[r.status]?.tone ?? 'pill'}>
                            {STATUS_LABEL[r.status]?.text ?? r.status}
                          </span>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </>
          ) : (
            <div className="empty-state">در حالِ بارگیری…</div>
          )}
        </section>
      ) : null}

      {tab === 'debtors' ? (
        <section className="panel panel--pad">
          <div className="panel__head">
            <h2 className="panel__title">سنِ بدهی</h2>
            <CacheNote meta={debtorsMeta} pending={pending} onRebuild={() => runDebtors(true)} />
          </div>

          <div className="filters">
            <label className="field">
              <span className="field__label">مهلتِ نسیه (روز)</span>
              <input
                className="field__input field__input--sm"
                type="number"
                min={0}
                max={365}
                value={term}
                onChange={(e) => setTerm(Number(e.target.value))}
              />
              <span className="field__help">
                فروشِ نسیه سررسید ندارد؛ تأخیر با این مهلت از تاریخِ سفارش شمرده می‌شود.
              </span>
            </label>
            <button
              type="button"
              className="btn btn--ghost btn--xs"
              onClick={() =>
                downloadCsv(
                  `سن-بدهی-${debtors?.asOfJalali.replace(/\//g, '-') ?? ''}`,
                  [
                    'مشتری',
                    'موبایل',
                    'کلِ طلب (تومان)',
                    'سررسید‌نرسیده',
                    '۱–۳۰ روز',
                    '۳۱–۶۰ روز',
                    '۶۱–۹۰ روز',
                    'بالای ۹۰ روز',
                    'کهن‌ترین سررسید',
                    'وضعیت',
                  ],
                  (debtors?.rows ?? []).map((r) => [
                    r.name,
                    r.mobile ?? '',
                    toman(r.totalRial),
                    toman(r.notDueRial),
                    toman(r.bucket1Rial),
                    toman(r.bucket2Rial),
                    toman(r.bucket3Rial),
                    toman(r.bucket4Rial),
                    r.oldestDueJalali ?? '',
                    RISK_LABEL[r.risk]?.text ?? r.risk,
                  ]),
                )
              }
            >
              خروجیِ اکسل
            </button>
          </div>

          {debtors ? (
            <>
              <Warnings items={debtors.warnings} />

              <div className="stats">
                <Stat
                  label="کلِ طلب"
                  value={toman(debtors.totals.receivableRial)}
                  hint={`${debtors.totals.debtorsCount} بدهکار`}
                />
                <Stat label="سررسید‌نرسیده" value={toman(debtors.totals.notDueRial)} />
                <Stat label="۱ تا ۳۰ روز" value={toman(debtors.totals.bucket1Rial)} />
                <Stat label="۳۱ تا ۶۰ روز" value={toman(debtors.totals.bucket2Rial)} />
                <Stat label="۶۱ تا ۹۰ روز" value={toman(debtors.totals.bucket3Rial)} />
                <Stat
                  label="بالای ۹۰ روز"
                  value={toman(debtors.totals.bucket4Rial)}
                  hint={`${debtors.totals.highRiskCount} بدهکارِ پرخطر`}
                />
                <Stat
                  label="بدهیِ ما به تأمین‌کنندگان"
                  value={toman(debtors.payables.totalPayableRial)}
                  hint={`${toman(debtors.payables.overduePayableRial)} تومان از سررسید گذشته`}
                />
              </div>

              <table className="table">
                <thead>
                  <tr>
                    <th>مشتری</th>
                    <th className="ta-left">کلِ طلب (تومان)</th>
                    <th className="ta-left">سررسید‌نرسیده</th>
                    <th className="ta-left">۱–۳۰</th>
                    <th className="ta-left">۳۱–۶۰</th>
                    <th className="ta-left">۶۱–۹۰</th>
                    <th className="ta-left">۹۰+</th>
                    <th>کهن‌ترین سررسید</th>
                    <th>وضعیت</th>
                  </tr>
                </thead>
                <tbody>
                  {debtors.rows.length === 0 ? (
                    <tr>
                      <td colSpan={9} className="empty">
                        هیچ طلبِ بازی ثبت نشده است.
                      </td>
                    </tr>
                  ) : (
                    debtors.rows.map((r) => (
                      <tr key={r.customerId ?? r.mobile ?? r.name}>
                        <td>
                          <span className="cell__title">{r.name}</span>
                          {r.mobile ? <span className="muted"> — {r.mobile}</span> : null}
                          {r.bouncedChecks > 0 ? (
                            <span className="pill pill--danger"> چکِ برگشتی: {r.bouncedChecks}</span>
                          ) : null}
                        </td>
                        <td className="num">{toman(r.totalRial)}</td>
                        <td className="num">{toman(r.notDueRial)}</td>
                        <td className="num">{toman(r.bucket1Rial)}</td>
                        <td className="num">{toman(r.bucket2Rial)}</td>
                        <td className="num">{toman(r.bucket3Rial)}</td>
                        <td className="num bad">{toman(r.bucket4Rial)}</td>
                        <td>{r.oldestDueJalali ?? '—'}</td>
                        <td>
                          <span className={RISK_LABEL[r.risk]?.tone ?? 'pill'}>
                            {RISK_LABEL[r.risk]?.text ?? r.risk}
                          </span>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>

              <h3 className="panel__title u-mt-5" >
                بدهیِ ما به تأمین‌کنندگان
              </h3>
              <table className="table">
                <thead>
                  <tr>
                    <th>فاکتور</th>
                    <th>تأمین‌کننده</th>
                    <th className="ta-left">مانده (تومان)</th>
                    <th>سررسید</th>
                    <th className="ta-left">تأخیر (روز)</th>
                  </tr>
                </thead>
                <tbody>
                  {debtors.payables.rows.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="empty">
                        فاکتورِ بازی نیست.
                      </td>
                    </tr>
                  ) : (
                    debtors.payables.rows.map((p) => (
                      <tr key={p.invoiceNo}>
                        <td>{p.invoiceNo}</td>
                        <td>{p.supplierName}</td>
                        <td className="num">{toman(p.payableRial)}</td>
                        <td>{p.dueJalali}</td>
                        <td className="num">
                          {p.daysPastDue > 0 ? (
                            <span className="pill pill--danger">{p.daysPastDue}</span>
                          ) : (
                            <span className="pill pill--ok">در مهلت</span>
                          )}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </>
          ) : (
            <div className="empty-state">در حالِ بارگیری…</div>
          )}
        </section>
      ) : null}
    </div>
  );
}
