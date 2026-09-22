'use client';

import { Fragment, useState } from 'react';
import {
  accountTypeLabel,
  referenceLabel,
  type AccountingReference,
  type AccountingSummary,
  type BalanceSheet,
  type InventoryValue,
  type JournalList,
  type ProfitLoss,
  type PurchaseList,
  type TrialBalance,
} from '@/lib/admin';
import { JournalForm } from './journal-form';
import { PurchaseForm } from './purchase-form';
import { ReverseEntry } from './reverse-entry';
import { InvoiceSettlement } from './invoice-settlement';

/**
 * پنلِ حسابداری.
 *
 * چرا تب (Tab) و نه چهار صفحه؟ چون حسابدار هنگامِ بستنِ یک فاکتور مدام
 * میانِ «دفتر روزنامه»، «تراز» و «ارزشِ موجودی» جابه‌جا می‌شود؛ رفت‌وبرگشتِ
 * صفحه برای هر نگاه، تمرکز را از بین می‌برد. داده‌ی همه‌ی تب‌ها یک‌بار
 * در سرور خوانده شده و اینجا فقط جابه‌جا می‌شود — بدون درخواستِ تازه.
 *
 * چرا تب‌ها در مرورگر و نه در نشانی (URL)؟ چون قرار نیست کاربر این نما را
 * برایِ دیگری بفرستد؛ هزینه‌ی رفت‌وبرگشتِ سرور برای یک تغییرِ نمایِ محلی
 * بی‌فایده است.
 */

type TabKey = 'overview' | 'journal' | 'purchases' | 'stock';

const TABS: Array<{ key: TabKey; label: string; hint: string }> = [
  { key: 'overview', label: 'نمای کلّی', hint: 'تراز، ترازنامه، سود و زیان' },
  { key: 'journal', label: 'دفتر روزنامه', hint: 'اسناد و ثبتِ دستی' },
  { key: 'purchases', label: 'فاکتورِ خرید', hint: 'شارژِ انبار و بدهی' },
  { key: 'stock', label: 'ارزشِ موجودی', hint: 'بهای میانگینِ موزون' },
];

export interface AccountingPanelData {
  summary: AccountingSummary | null;
  trialBalance: TrialBalance | null;
  balanceSheet: BalanceSheet | null;
  profitLoss: ProfitLoss | null;
  journal: JournalList | null;
  purchases: PurchaseList | null;
  stock: InventoryValue | null;
  reference: AccountingReference | null;
}

export function AccountingPanel({ data }: { data: AccountingPanelData }) {
  const [tab, setTab] = useState<TabKey>('overview');
  const [openEntry, setOpenEntry] = useState<string | null>(null);

  const { summary, trialBalance, balanceSheet, profitLoss, journal, purchases, stock, reference } = data;
  const canWrite = reference !== null;

  const cards = summary
    ? [
        { label: 'نقد و بانک', value: summary.display.cash, hint: 'موجودیِ صندوق و حساب‌ها' },
        { label: 'ارزشِ موجودیِ کالا', value: summary.display.inventory, hint: `${summary.stock.quantity} عدد در انبار` },
        { label: 'اعتبارِ مالیاتی', value: summary.display.vatCredit, hint: 'ارزش افزوده‌ی خرید — کسر از مالیاتِ فروش' },
        { label: 'بدهی به تأمین‌کنندگان', value: summary.display.payables, hint: 'فاکتورهایِ خریدِ پرداخت‌نشده' },
        { label: 'سود (زیان)ِ دوره', value: summary.display.net, hint: 'درآمد منهایِ بهای کالا و هزینه‌ها' },
      ]
    : [];

  return (
    <>
      {summary ? (
        <section className="stats">
          {cards.map((c) => (
            <article className="stat" key={c.label}>
              <p className="stat__label">{c.label}</p>
              <p className="stat__value num stat__value--money">{c.value}</p>
              <p className="stat__hint">{c.hint}</p>
            </article>
          ))}
        </section>
      ) : null}

      <div className="tabs" role="tablist" aria-label="بخش‌هایِ حسابداری">
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

      {tab === 'overview' ? (
        <div className="stack">
          {trialBalance ? (
            <section className="panel panel--flush panel--flush">
              <div className="panel__head">
                <h2 className="panel__title">ترازِ آزمایشی</h2>
                <span className={`pill pill--${trialBalance.balanced ? 'ok' : 'danger'}`}>
                  {trialBalance.balanced ? 'تراز است' : 'ناتراز'}
                </span>
              </div>
              <table className="table">
                <thead>
                  <tr>
                    <th className="col-code">کد</th>
                    <th>حساب</th>
                    <th>نوع</th>
                    <th className="ta-left">بدهکار (تومان)</th>
                    <th className="ta-left">بستانکار (تومان)</th>
                  </tr>
                </thead>
                <tbody>
                  {trialBalance.accounts.map((a) => (
                    <tr key={a.code}>
                      <td className="num muted">{a.code}</td>
                      <td>{a.name}</td>
                      <td className="muted">{accountTypeLabel(a.type)}</td>
                      <td className="num ta-left">
                        {Number(a.debit) === 0 ? '—' : new Intl.NumberFormat('fa-IR').format(Number(a.debit) / 10)}
                      </td>
                      <td className="num ta-left">
                        {Number(a.credit) === 0 ? '—' : new Intl.NumberFormat('fa-IR').format(Number(a.credit) / 10)}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="table__foot">
                    <td colSpan={3}>جمع</td>
                    <td className="num ta-left">{trialBalance.display.debit}</td>
                    <td className="num ta-left">{trialBalance.display.credit}</td>
                  </tr>
                </tfoot>
              </table>
            </section>
          ) : (
            <ReadOnlyNotice />
          )}

          {balanceSheet ? (
            <section className="panel">
              <div className="panel__head">
                <h2 className="panel__title">ترازنامه</h2>
                <span className={`pill pill--${balanceSheet.balanced ? 'ok' : 'danger'}`}>
                  {balanceSheet.balanced ? 'دارایی = بدهی + حقوقِ صاحبانِ سهام' : `اختلاف: ${balanceSheet.differenceRial} ریال`}
                </span>
              </div>
              <div className="grid3">
                <BalanceGroup title="دارایی‌ها" group={balanceSheet.assets} tone="asset" />
                <BalanceGroup title="بدهی‌ها" group={balanceSheet.liabilities} tone="liability" />
                <BalanceGroup
                  title="حقوقِ صاحبانِ سهام"
                  group={balanceSheet.equity}
                  tone="equity"
                  extra={
                    balanceSheet.equity.periodNetDisplay
                      ? { label: 'سود (زیان)ِ دوره', value: balanceSheet.equity.periodNetDisplay }
                      : undefined
                  }
                />
              </div>
              <p className="panel__note">
                جمعِ بدهی و حقوقِ صاحبانِ سهام:{' '}
                <b className="num">{balanceSheet.totalLiabilitiesAndEquity.display}</b> تومان
              </p>
            </section>
          ) : null}

          {profitLoss ? (
            <section className="panel panel--flush panel--flush">
              <div className="panel__head">
                <h2 className="panel__title">سود و زیان</h2>
                <span className="panel__count">
                  {profitLoss.period === 'all' ? 'همه‌ی دوره‌ها' : `دوره‌ی ${profitLoss.period}`}
                </span>
              </div>
              <table className="table">
                <tbody>
                  <tr>
                    <td>درآمدِ فروش</td>
                    <td className="num ta-left">{profitLoss.revenue.display}</td>
                  </tr>
                  <tr>
                    <td>بهایِ تمام‌شده‌ی کالایِ فروخته‌شده</td>
                    <td className="num ta-left">{profitLoss.cogs.display}</td>
                  </tr>
                  <tr className="table__foot">
                    <td>سودِ ناخالص</td>
                    <td className="num ta-left">{profitLoss.grossProfit.display}</td>
                  </tr>
                  <tr>
                    <td>هزینه‌ها</td>
                    <td className="num ta-left">{profitLoss.expenses.display}</td>
                  </tr>
                  <tr className="table__foot table__foot--strong">
                    <td>
                      سود (زیان)ِ خالص
                      {profitLoss.revenue.rial !== '0' ? (
                        <span className="muted"> — حاشیه‌ی سود {profitLoss.marginPercent}٪</span>
                      ) : null}
                    </td>
                    <td className={`num ta-left ${Number(profitLoss.netProfit.rial) < 0 ? 'bad' : 'ok'}`}>
                      {profitLoss.netProfit.display}
                    </td>
                  </tr>
                </tbody>
              </table>
            </section>
          ) : null}
        </div>
      ) : null}

      {tab === 'journal' ? (
        <div className="stack">
          {canWrite && reference ? (
            <section className="panel panel--pad">
              <h2 className="panel__title">ثبتِ سندِ دستی</h2>
              <p className="panel__note">
                سندِ ثبت‌شده هرگز حذف نمی‌شود؛ اصلاحِ اشتباه با «برگشت» است.
              </p>
              <JournalForm accounts={reference.accounts} />
            </section>
          ) : (
            <div className="alert alert--danger">
              شما اجازه‌ی ثبتِ سند ندارید. دسترسیِ
              <code className="code"> accounting.write </code>
              لازم است.
            </div>
          )}

          <section className="panel panel--flush panel--flush">
            <div className="panel__head">
              <h2 className="panel__title">دفترِ روزنامه</h2>
              <span className="panel__count num">{journal?.total ?? 0} سند</span>
            </div>

            {!journal || journal.items.length === 0 ? (
              <p className="empty">هنوز سندی ثبت نشده است.</p>
            ) : (
              <table className="table">
                <thead>
                  <tr>
                    <th className="col-code">شماره</th>
                    <th>شرح</th>
                    <th>منشأ</th>
                    <th className="ta-left">مبلغ (تومان)</th>
                    <th>تاریخ</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {journal.items.map((entry) => {
                    const open = openEntry === entry.id;
                    return (
                      <Fragment key={entry.id}>
                        <tr className={entry.status === 'reversed' ? 'row--reversed' : undefined}>
                          <td className="num">
                            <button
                              type="button"
                              className="linkish"
                              onClick={() => setOpenEntry(open ? null : entry.id)}
                              aria-expanded={open}
                            >
                              {entry.entryNo}
                            </button>
                          </td>
                          <td>{entry.description}</td>
                          <td>
                            <span className="pill pill--muted">{referenceLabel(entry.referenceType)}</span>
                            {entry.status === 'reversed' ? (
                              <span className="pill pill--danger">برگشت‌خورده</span>
                            ) : null}
                          </td>
                          <td className="num ta-left">{entry.display.total}</td>
                          <td className="num muted">{entry.postedAtFa ?? '—'}</td>
                          <td>{canWrite && entry.status !== 'reversed' ? <ReverseEntry entryId={entry.id} entryNo={entry.entryNo} /> : null}</td>
                        </tr>
                        {open ? (
                          <tr className="row--lines">
                            <td colSpan={6}>
                              <table className="table table--inner">
                                <thead>
                                  <tr>
                                    <th>حساب</th>
                                    <th>شرح</th>
                                    <th className="ta-left">بدهکار</th>
                                    <th className="ta-left">بستانکار</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {entry.lines.map((l, i) => (
                                    <tr key={`${l.accountCode}-${i}`}>
                                      <td>
                                        <span className="num muted">{l.accountCode}</span> {l.accountName}
                                      </td>
                                      <td className="muted">{l.description ?? '—'}</td>
                                      <td className="num ta-left">{Number(l.debitRial) ? l.debit : '—'}</td>
                                      <td className="num ta-left">{Number(l.creditRial) ? l.credit : '—'}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </td>
                          </tr>
                        ) : null}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            )}
          </section>
        </div>
      ) : null}

      {tab === 'purchases' ? (
        <div className="stack">
          {canWrite && reference ? (
            <section className="panel panel--pad">
              <h2 className="panel__title">فاکتورِ خریدِ تازه</h2>
              <p className="panel__note">
                با ثبتِ فاکتور، کالا به انبار می‌آید، بهای میانگینِ موزون به‌روز می‌شود و سندِ
                حسابداری به‌طورِ خودکار صادر می‌گردد.
              </p>
              <PurchaseForm variants={reference.variants} warehouses={reference.warehouses} />
            </section>
          ) : (
            <div className="alert alert--danger">
              شما اجازه‌ی ثبتِ فاکتورِ خرید ندارید. دسترسیِ
              <code className="code"> accounting.write </code>
              لازم است.
            </div>
          )}

          <section className="panel panel--flush panel--flush">
            <div className="panel__head">
              <h2 className="panel__title">فاکتورهایِ خرید</h2>
              <span className="panel__count num">{purchases?.total ?? 0} فاکتور</span>
            </div>

            {!purchases || purchases.items.length === 0 ? (
              <p className="empty">هنوز فاکتورِ خریدی ثبت نشده است.</p>
            ) : (
              <table className="table">
                <thead>
                  <tr>
                    <th className="col-code">شماره</th>
                    <th>تأمین‌کننده</th>
                    <th>شناسه‌ی ملی</th>
                    <th>شماره‌ی فاکتور</th>
                    <th className="ta-left">بهای کالا</th>
                    <th className="ta-left">ارزش افزوده</th>
                    <th className="ta-left">قابلِ پرداخت</th>
                    <th>تسویه</th>
                  </tr>
                </thead>
                <tbody>
                  {purchases.items.map((p) => (
                    <tr key={p.id}>
                      <td className="num">{p.invoiceNo}</td>
                      <td>
                        {p.supplierName}
                        <span className="muted"> — {p.warehouse ?? '—'}</span>
                        {p.createdAtFa ? <span className="muted"> · {p.createdAtFa}</span> : null}
                      </td>
                      <td className="num muted">{p.supplierNationalId ?? '—'}</td>
                      <td className="num muted">{p.supplierInvoiceNo ?? '—'}</td>
                      <td className="num ta-left">{p.display.total}</td>
                      <td className="num ta-left">{p.display.vat}</td>
                      <td className="num ta-left">
                        <b>{p.display.payable}</b>
                      </td>
                      <td>
                        <InvoiceSettlement invoiceId={p.id} payableRial={p.payableRial} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        </div>
      ) : null}

      {tab === 'stock' ? (
        <section className="panel panel--flush panel--flush">
          <div className="panel__head">
            <h2 className="panel__title">ارزشِ موجودی به بهایِ میانگینِ موزون</h2>
            <span className="panel__count num">{stock?.totalQuantity ?? 0} عدد</span>
          </div>

          {!stock || stock.items.length === 0 ? (
            <p className="empty">موجودیِ ارزش‌گذاری‌شده‌ای نیست.</p>
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>کالا</th>
                  <th className="col-code">شناسه</th>
                  <th className="ta-left">تعداد</th>
                  <th className="ta-left">بهای میانگین (تومان)</th>
                  <th className="ta-left">ارزش (تومان)</th>
                </tr>
              </thead>
              <tbody>
                {stock.items.map((r) => (
                  <tr key={r.variantId}>
                    <td>{r.product}</td>
                    <td className="num muted">{r.sku}</td>
                    <td className="num ta-left">{r.quantity}</td>
                    <td className="num ta-left">{r.display.avgCost}</td>
                    <td className="num ta-left">
                      <b>{r.display.value}</b>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="table__foot table__foot--strong">
                  <td colSpan={2}>جمع</td>
                  <td className="num ta-left">{stock.totalQuantity}</td>
                  <td />
                  <td className="num ta-left">{stock.display.total}</td>
                </tr>
              </tfoot>
            </table>
          )}
        </section>
      ) : null}
    </>
  );
}

function BalanceGroup({
  title,
  group,
  tone,
  extra,
}: {
  title: string;
  group: { items: Array<{ code: string; name: string; display: string }>; display: string };
  tone: 'asset' | 'liability' | 'equity';
  extra?: { label: string; value: string };
}) {
  return (
    <div className={`bgroup bgroup--${tone}`}>
      <h3 className="bgroup__title">{title}</h3>
      {group.items.length === 0 ? (
        <p className="muted">مبلغی ندارد.</p>
      ) : (
        <ul className="bgroup__list">
          {group.items.map((i) => (
            <li key={i.code}>
              <span>
                <span className="num muted">{i.code}</span> {i.name}
              </span>
              <b className="num">{i.display}</b>
            </li>
          ))}
          {extra ? (
            <li className="bgroup__extra">
              <span>{extra.label}</span>
              <b className="num">{extra.value}</b>
            </li>
          ) : null}
        </ul>
      )}
      <p className="bgroup__total">
        <span>جمع</span>
        <b className="num">{group.display}</b>
      </p>
    </div>
  );
}

function ReadOnlyNotice() {
  return (
    <div className="alert alert--danger">
      برایِ دیدنِ گزارش‌هایِ مالی، دسترسیِ
      <code className="code"> accounting.read </code>
      لازم است.
    </div>
  );
}
