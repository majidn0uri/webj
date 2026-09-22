'use client';

import { useState } from 'react';
import {
  createGoodsReceipt,
  createPurchaseRequest,
  createSupplier,
  createSupplierReturn,
  decidePurchaseRequest,
} from '@/lib/procurement-actions';

/**
 * پنلِ تأمین و خرید — چهار صف که پشتِ یک نوارِ تب نشسته‌اند.
 */

type Tab = 'requests' | 'receipts' | 'suppliers' | 'returns';

interface Supplier {
  id: string;
  code: string;
  name: string;
  store_name?: string | null;
  national_id?: string | null;
  mobile?: string | null;
  city?: string | null;
  settlement_terms?: string;
  lead_time_days?: number;
}

interface RequestItem {
  variant_id: string;
  sku: string | null;
  product_title: string;
  quantity: number;
  received_quantity: number;
  last_cost_rial: string | null;
  on_hand: number;
}

interface RequestRow {
  id: string;
  request_no: string;
  status: string;
  priority: string;
  source: string;
  supplier_id: string | null;
  reason: string | null;
  created_at: string;
  items: RequestItem[];
}

interface ReceiptRow {
  id: string;
  receipt_no: string;
  status: string;
  supplier_name: string | null;
  warehouse_name: string | null;
  total_received_qty: number;
  total_damaged_qty: number;
  discrepancy_note: string | null;
  received_at: string;
}

interface Variant {
  variant_id: string;
  sku: string | null;
  product_title: string;
  on_hand: number;
  warehouse_id?: string;
  warehouse_name?: string | null;
}

interface Props {
  requests: RequestRow[];
  receipts: ReceiptRow[];
  suppliers: Supplier[];
  variants: Variant[];
  warehouses: Array<{ id: string; name: string }>;
}

const STATUS_LABEL: Record<string, string> = {
  pending_approval: 'در انتظارِ تأیید',
  approved: 'تأییدشده',
  rejected: 'رد شده',
  ordered: 'سفارش‌داده‌شده',
  partially_received: 'دریافتِ ناقص',
  received: 'دریافت‌شده',
  cancelled: 'لغو شده',
  confirmed: 'تأییدشده',
  discrepancy: 'دارای مغایرت',
  draft: 'پیش‌نویس',
};

const PRIORITY_LABEL: Record<string, string> = {
  low: 'کم',
  normal: 'عادی',
  high: 'زیاد',
  urgent: 'فوری',
};

export function ProcurementPanel({ requests, receipts, suppliers, variants, warehouses }: Props) {
  const [tab, setTab] = useState<Tab>('requests');

  return (
    <div>
      <div className="tabs" role="tablist">
        {(
          [
            ['requests', `درخواست‌ها (${requests.length})`],
            ['receipts', `رسیدها (${receipts.length})`],
            ['suppliers', `تأمین‌کنندگان (${suppliers.length})`],
            ['returns', 'برگشت به تأمین‌کننده'],
          ] as Array<[Tab, string]>
        ).map(([key, label]) => (
          <button
            key={key}
            role="tab"
            aria-selected={tab === key}
            onClick={() => setTab(key)}
            className={`tab${tab === key ? ' tab--active' : ''}`}
            type="button"
          >
            <span className="tab__label">{label}</span>
          </button>
        ))}
      </div>

      {tab === 'requests' && <RequestsTab requests={requests} suppliers={suppliers} variants={variants} warehouses={warehouses} />}
      {tab === 'receipts' && <ReceiptsTab receipts={receipts} suppliers={suppliers} variants={variants} warehouses={warehouses} />}
      {tab === 'suppliers' && <SuppliersTab suppliers={suppliers} />}
      {tab === 'returns' && <ReturnsTab suppliers={suppliers} variants={variants} warehouses={warehouses} />}
    </div>
  );
}

/* =========================================================================
   ۱) درخواست‌های خرید
   ========================================================================= */

function RequestsTab({
  requests,
  suppliers,
  variants,
  warehouses,
}: {
  requests: RequestRow[];
  suppliers: Supplier[];
  variants: Variant[];
  warehouses: Array<{ id: string; name: string }>;
}) {
  const [items, setItems] = useState<Array<{ variantId: string; quantity: number }>>([
    { variantId: '', quantity: 1 },
  ]);
  const [supplierId, setSupplierId] = useState('');
  const [priority, setPriority] = useState<'low' | 'normal' | 'high' | 'urgent'>('normal');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      const out = await createPurchaseRequest({
        items: items.filter((i) => i.variantId).map((i) => ({ variantId: i.variantId, quantity: i.quantity })),
        supplierId: supplierId || null,
        priority,
        source: 'manual',
        reason: reason || null,
      });
      if (!out.ok) throw new Error(out.message);
      setMessage({
        kind: 'ok',
        text: `درخواستِ ${out.data.request?.request_no ?? ''} ثبت شد؛ باید به تأییدِ مدیر برسد.`,
      });
      setItems([{ variantId: '', quantity: 1 }]);
      setReason('');
    } catch (err) {
      setMessage({ kind: 'err', text: String((err as Error).message ?? err) });
    } finally {
      setBusy(false);
    }
  }

  async function decide(id: string, approve: boolean) {
    setBusy(true);
    setMessage(null);
    try {
      const out = await decidePurchaseRequest(id, approve);
      if (!out.ok) throw new Error(out.message);
      setMessage({ kind: 'ok', text: out.message ?? (approve ? 'درخواست تأیید شد.' : 'درخواست رد شد.') });
    } catch (err) {
      setMessage({ kind: 'err', text: String((err as Error).message ?? err) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="admin-two-col">
      <section className="panel panel--pad">
        <h2 className="panel__title">درخواستِ تازه</h2>
        <form onSubmit={submit} className="admin-form">
          <label className="field">
            <span className="field__label">تأمین‌کننده (اختیاری)</span>
            <select className="field__input" value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
              <option value="">— بعداً تعیین می‌شود —</option>
              {suppliers.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} ({s.code})
                </option>
              ))}
            </select>
          </label>

          <label className="field">
            <span className="field__label">اولویت</span>
            <select className="field__input" value={priority} onChange={(e) => setPriority(e.target.value as 'low' | 'normal' | 'high' | 'urgent')}>
              {Object.entries(PRIORITY_LABEL).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </label>

          <div>
            <span className="field__label">اقلام</span>
            {items.map((row, idx) => (
              <div key={idx} className="admin-item-row">
                <div className="admin-item-row__fields">
                  <label>
                    کالا
                    <select
                      value={row.variantId}
                      onChange={(e) => {
                        const next = [...items];
                        next[idx]!.variantId = e.target.value;
                        setItems(next);
                      }}
                    >
                      <option value="">انتخابِ کالا…</option>
                      {variants.map((v) => (
                        <option key={v.variant_id} value={v.variant_id}>
                          {v.product_title} · {v.sku ?? 'بدون شناسه'} (موجود: {v.on_hand})
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="u-flex-0" style={{ flex: '0 0 80px' }}>
                    تعداد
                    <input
                      type="number"
                      min={1}
                      value={row.quantity}
                      onChange={(e) => {
                        const next = [...items];
                        next[idx]!.quantity = Number(e.target.value);
                        setItems(next);
                      }}
                    />
                  </label>
                </div>
              </div>
            ))}
            <button
              type="button"
              className="btn btn--ghost"
              onClick={() => setItems([...items, { variantId: '', quantity: 1 }])}
            >
              + قلمِ دیگر
            </button>
          </div>

          <label className="field">
            <span className="field__label">دلیل</span>
            <textarea
              className="field__input"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="مثلاً: موجودی به نقطه‌ی سفارش رسیده"
            />
          </label>

          <button className="btn btn--primary" type="submit" disabled={busy}>
            {busy ? 'در حالِ ثبت…' : 'ثبتِ درخواست'}
          </button>

          {message && (
            <div className={message.kind === 'ok' ? 'alert alert--ok' : 'alert alert--danger'}>{message.text}</div>
          )}
        </form>
      </section>

      <section className="panel panel--flush panel--flush">
        <div className="panel__head">
          <h2 className="panel__title">فهرستِ درخواست‌ها</h2>
          <span className="panel__count num">{requests.length} درخواست</span>
        </div>
        {requests.length === 0 ? (
          <p className="empty">هنوز درخواستی ثبت نشده است.</p>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>شماره</th>
                <th>وضعیت</th>
                <th>اولویت</th>
                <th className="ta-left">اقلام</th>
                <th className="ta-left">عمل</th>
              </tr>
            </thead>
            <tbody>
              {requests.map((r) => (
                <tr key={r.id}>
                  <td className="num">{r.request_no}</td>
                  <td>
                    <span
                      className={`pill pill--${
                        r.status === 'received'
                          ? 'ok'
                          : r.status === 'rejected'
                            ? 'danger'
                            : r.status === 'pending_approval'
                              ? 'warn'
                              : 'muted'
                      }`}
                    >
                      {STATUS_LABEL[r.status] ?? r.status}
                    </span>
                  </td>
                  <td>{PRIORITY_LABEL[r.priority] ?? r.priority}</td>
                  <td className="ta-left">
                    {(r.items ?? []).map((i) => (
                      <div key={i.variant_id} className="muted u-text-xs" >
                        {i.product_title} · {i.quantity} عدد (دریافت‌شده: {i.received_quantity})
                      </div>
                    ))}
                  </td>
                  <td className="ta-left">
                    {r.status === 'pending_approval' && (
                      <div className="u-flex u-gap-1">
                        <button className="btn btn--primary btn--sm" onClick={() => decide(r.id, true)} disabled={busy}>
                          تأیید
                        </button>
                        <button className="btn btn--ghost btn--sm" onClick={() => decide(r.id, false)} disabled={busy}>
                          رد
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}

/* =========================================================================
   ۲) رسیدِ انبار
   ========================================================================= */

function ReceiptsTab({
  receipts,
  suppliers,
  variants,
  warehouses,
}: {
  receipts: ReceiptRow[];
  suppliers: Supplier[];
  variants: Variant[];
  warehouses: Array<{ id: string; name: string }>;
}) {
  const [supplierId, setSupplierId] = useState('');
  const [warehouseId, setWarehouseId] = useState(warehouses[0]?.id ?? '');
  const [tracking, setTracking] = useState('');
  const [rows, setRows] = useState<
    Array<{ variantId: string; expectedQuantity: number; receivedQuantity: number; damagedQuantity: number; unitCostToman: number }>
  >([{ variantId: '', expectedQuantity: 0, receivedQuantity: 0, damagedQuantity: 0, unitCostToman: 0 }]);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{
    receiptNo: string;
    status: string;
    discrepancies: Array<{ title: string; sku: string | null; expected: number; received: number; damaged: number; kind: string | null; priceDiffToman: number | null }>;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const out = await createGoodsReceipt({
        supplierId: supplierId || null,
        warehouseId,
        trackingNo: tracking || null,
        items: rows
          .filter((r) => r.variantId)
          .map((r) => ({
            variantId: r.variantId,
            expectedQuantity: r.expectedQuantity,
            receivedQuantity: r.receivedQuantity,
            damagedQuantity: r.damagedQuantity,
            unitCostToman: r.unitCostToman,
          })),
      });
      if (!out.ok) throw new Error(out.message);
      setResult({
        receiptNo: out.data.receiptNo ?? '',
        status: out.data.status ?? '',
        discrepancies: out.data.discrepancies ?? [],
      });
    } catch (err) {
      setError(String((err as Error).message ?? err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="admin-two-col">
      <section className="panel panel--pad">
        <h2 className="panel__title">رسیدِ تازه</h2>
        <form onSubmit={submit} className="admin-form">
          <label className="field">
            <span className="field__label">تأمین‌کننده</span>
            <select className="field__input" value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
              <option value="">— انتخاب —</option>
              {suppliers.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>

          <label className="field">
            <span className="field__label">انبار</span>
            <select className="field__input" value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)}>
              {warehouses.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </select>
          </label>

          <label className="field">
            <span className="field__label">شماره‌ی پیگیری/بارنامه (اختیاری)</span>
            <input className="field__input" value={tracking} onChange={(e) => setTracking(e.target.value)} />
          </label>

          <div>
            <span className="field__label">اقلامِ دریافتی</span>
            {rows.map((row, idx) => (
              <div key={idx} className="admin-item-row">
                <select
                  className="field__input"
                  value={row.variantId}
                  onChange={(e) => {
                    const next = [...rows];
                    next[idx]!.variantId = e.target.value;
                    setRows(next);
                  }}
                >
                  <option value="">انتخابِ کالا…</option>
                  {variants.map((v) => (
                    <option key={v.variant_id} value={v.variant_id}>
                      {v.product_title} · {v.sku ?? ''}
                    </option>
                  ))}
                </select>
                <div className="admin-item-row__fields">
                  <label>
                    انتظار
                    <input
                      type="number"
                      min={0}
                      value={row.expectedQuantity}
                      onChange={(e) => {
                        const next = [...rows];
                        next[idx]!.expectedQuantity = Number(e.target.value);
                        setRows(next);
                      }}
                    />
                  </label>
                  <label>
                    دریافتی
                    <input
                      type="number"
                      min={0}
                      value={row.receivedQuantity}
                      onChange={(e) => {
                        const next = [...rows];
                        next[idx]!.receivedQuantity = Number(e.target.value);
                        setRows(next);
                      }}
                    />
                  </label>
                  <label>
                    معیوب
                    <input
                      type="number"
                      min={0}
                      value={row.damagedQuantity}
                      onChange={(e) => {
                        const next = [...rows];
                        next[idx]!.damagedQuantity = Number(e.target.value);
                        setRows(next);
                      }}
                    />
                  </label>
                  <label>
                    قیمت (تومان)
                    <input
                      type="number"
                      min={0}
                      value={row.unitCostToman}
                      onChange={(e) => {
                        const next = [...rows];
                        next[idx]!.unitCostToman = Number(e.target.value);
                        setRows(next);
                      }}
                    />
                  </label>
                </div>
              </div>
            ))}
            <button
              type="button"
              className="btn btn--ghost"
              onClick={() =>
                setRows([
                  ...rows,
                  { variantId: '', expectedQuantity: 0, receivedQuantity: 0, damagedQuantity: 0, unitCostToman: 0 },
                ])
              }
            >
              + قلمِ دیگر
            </button>
          </div>

          <button className="btn btn--primary" type="submit" disabled={busy}>
            {busy ? 'در حالِ ثبت…' : 'ثبتِ رسید و ورود به انبار'}
          </button>
          {error && <div className="alert alert--danger">{error}</div>}
        </form>

        {result && (
          <div className={`alert ${result.status === 'discrepancy' ? 'alert--warn' : 'alert--ok'} admin-result`}>
            <strong>{result.receiptNo}</strong> ثبت شد.
            {result.status === 'discrepancy' ? (
              <ul className="u-mt-2">
                {result.discrepancies.map((d, i) => (
                  <li key={i}>
                    {d.title}: انتظار {d.expected}، دریافت {d.received}
                    {d.damaged > 0 ? `، معیوب ${d.damaged}` : ''}
                    {d.priceDiffToman ? `، اختلافِ قیمت ${d.priceDiffToman.toLocaleString('fa-IR')} تومان` : ''}
                  </li>
                ))}
              </ul>
            ) : (
              <div className="u-mt-2">بدون مغایرت با فاکتور.</div>
            )}
          </div>
        )}
      </section>

      <section className="panel panel--flush panel--flush">
        <div className="panel__head">
          <h2 className="panel__title">رسیدهای پیشین</h2>
          <span className="panel__count num">{receipts.length} رسید</span>
        </div>
        {receipts.length === 0 ? (
          <p className="empty">رسیدی ثبت نشده است.</p>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>شماره</th>
                <th>تأمین‌کننده</th>
                <th>انبار</th>
                <th className="ta-left">دریافتی</th>
                <th className="ta-left">معیوب</th>
                <th>وضعیت</th>
              </tr>
            </thead>
            <tbody>
              {receipts.map((r) => (
                <tr key={r.id}>
                  <td className="num">{r.receipt_no}</td>
                  <td>{r.supplier_name ?? '—'}</td>
                  <td>{r.warehouse_name ?? '—'}</td>
                  <td className="num ta-left">{r.total_received_qty}</td>
                  <td className="num ta-left">{r.total_damaged_qty}</td>
                  <td>
                    <span className={`pill pill--${r.status === 'discrepancy' ? 'warn' : 'ok'}`}>
                      {STATUS_LABEL[r.status] ?? r.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}

/* =========================================================================
   ۳) تأمین‌کنندگان
   ========================================================================= */

function SuppliersTab({ suppliers }: { suppliers: Supplier[] }) {
  const [name, setName] = useState('');
  const [nationalId, setNationalId] = useState('');
  const [economicCode, setEconomicCode] = useState('');
  const [mobile, setMobile] = useState('');
  const [city, setCity] = useState('');
  const [sheba, setSheba] = useState('');
  const [terms, setTerms] = useState<'cash' | 'credit_15' | 'credit_30' | 'cheque'>('cash');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      const out = await createSupplier({
        name,
        nationalId: nationalId || null,
        economicCode: economicCode || null,
        mobile: mobile || null,
        city: city || null,
        sheba: sheba || null,
        settlementTerms: terms,
      });
      if (!out.ok) throw new Error(out.message);
      setMessage({ kind: 'ok', text: `تأمین‌کننده با کدِ ${out.data.supplier?.code ?? ''} ثبت شد.` });
      setName('');
      setNationalId('');
      setEconomicCode('');
      setMobile('');
      setCity('');
      setSheba('');
    } catch (err) {
      setMessage({ kind: 'err', text: String((err as Error).message ?? err) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="admin-two-col">
      <section className="panel panel--pad">
        <h2 className="panel__title">تأمین‌کننده‌ی تازه</h2>
        <form onSubmit={submit} className="admin-form">
          <label className="field">
            <span className="field__label">نام *</span>
            <input className="field__input" value={name} onChange={(e) => setName(e.target.value)} required />
          </label>
          <label className="field">
            <span className="field__label">شناسه‌ی ملی</span>
            <input className="field__input" value={nationalId} onChange={(e) => setNationalId(e.target.value)} inputMode="numeric" />
          </label>
          <label className="field">
            <span className="field__label">کدِ اقتصادی</span>
            <input className="field__input" value={economicCode} onChange={(e) => setEconomicCode(e.target.value)} inputMode="numeric" />
          </label>
          <label className="field">
            <span className="field__label">موبایل</span>
            <input className="field__input" value={mobile} onChange={(e) => setMobile(e.target.value)} inputMode="tel" />
          </label>
          <label className="field">
            <span className="field__label">شهر</span>
            <input className="field__input" value={city} onChange={(e) => setCity(e.target.value)} />
          </label>
          <label className="field">
            <span className="field__label">شِبا (با IR)</span>
            <input className="field__input" value={sheba} onChange={(e) => setSheba(e.target.value)} placeholder="IR…" />
          </label>
          <label className="field">
            <span className="field__label">شرطِ پرداخت</span>
            <select className="field__input" value={terms} onChange={(e) => setTerms(e.target.value as 'cash' | 'credit_15' | 'credit_30' | 'cheque')}>
              <option value="cash">نقد</option>
              <option value="credit_15">۱۵ روزه</option>
              <option value="credit_30">۳۰ روزه</option>
              <option value="cheque">چک</option>
            </select>
          </label>
          <button className="btn btn--primary" type="submit" disabled={busy}>
            {busy ? 'در حالِ ثبت…' : 'ثبتِ تأمین‌کننده'}
          </button>
          {message && (
            <div className={message.kind === 'ok' ? 'alert alert--ok' : 'alert alert--danger'}>{message.text}</div>
          )}
        </form>
      </section>

      <section className="panel panel--flush panel--flush">
        <div className="panel__head">
          <h2 className="panel__title">فهرستِ تأمین‌کنندگان</h2>
          <span className="panel__count num">{suppliers.length} تأمین‌کننده</span>
        </div>
        {suppliers.length === 0 ? (
          <p className="empty">تأمین‌کننده‌ای ثبت نشده است.</p>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>کد</th>
                <th>نام</th>
                <th>شناسه‌ی ملی</th>
                <th>شهر</th>
                <th>شرطِ پرداخت</th>
              </tr>
            </thead>
            <tbody>
              {suppliers.map((s) => (
                <tr key={s.id}>
                  <td className="num">{s.code}</td>
                  <td>{s.name}</td>
                  <td className="num muted">{s.national_id ?? '—'}</td>
                  <td>{s.city ?? '—'}</td>
                  <td>
                    <span className="pill pill--muted">
                      {s.settlement_terms === 'cash'
                        ? 'نقد'
                        : s.settlement_terms === 'credit_15'
                          ? '۱۵ روزه'
                          : s.settlement_terms === 'credit_30'
                            ? '۳۰ روزه'
                            : 'چک'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}

/* =========================================================================
   ۴) برگشت به تأمین‌کننده
   ========================================================================= */

function ReturnsTab({
  suppliers,
  variants,
  warehouses,
}: {
  suppliers: Supplier[];
  variants: Variant[];
  warehouses: Array<{ id: string; name: string }>;
}) {
  const [supplierId, setSupplierId] = useState('');
  const [warehouseId, setWarehouseId] = useState(warehouses[0]?.id ?? '');
  const [variantId, setVariantId] = useState('');
  const [quantity, setQuantity] = useState(1);
  const [unitCostToman, setUnitCostToman] = useState(0);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      const out = await createSupplierReturn({
        supplierId,
        warehouseId,
        reason,
        items: [{ variantId, quantity, unitCostToman }],
      });
      if (!out.ok) throw new Error(out.message);
      setMessage({
        kind: 'ok',
        text: `برگشتِ ${out.data.returnNo ?? ''} ثبت شد و از موجودی کم شد.`,
      });
    } catch (err) {
      setMessage({ kind: 'err', text: String((err as Error).message ?? err) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel panel--pad u-max-w-320" >
      <h2 className="panel__title">برگشتِ کالا به تأمین‌کننده</h2>
      <p className="field__help u-mb-3" >
        این برگشت بلافاصله از موجودیِ انبار کم می‌شود و با شماره‌ی BS در دفتر می‌ماند.
      </p>
      <form onSubmit={submit} className="admin-form">
        <label className="field">
          <span className="field__label">تأمین‌کننده</span>
          <select className="field__input" value={supplierId} onChange={(e) => setSupplierId(e.target.value)} required>
            <option value="">— انتخاب —</option>
            {suppliers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span className="field__label">انبار</span>
          <select
            className="field__input"
            value={warehouseId}
            onChange={(e) => {
              setWarehouseId(e.target.value);
              setVariantId('');
            }}
            required
          >
            {warehouses.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span className="field__label">کالا</span>
          <select
            className="field__input"
            value={variantId}
            onChange={(e) => setVariantId(e.target.value)}
            required
          >
            <option value="">— انتخاب —</option>
            {variants
              .filter((v) => !warehouseId || v.warehouse_id === warehouseId)
              .map((v) => (
                <option key={`${v.warehouse_id}:${v.variant_id}`} value={v.variant_id}>
                  {v.product_title} · {v.sku ?? ''} (موجود: {v.on_hand})
                </option>
              ))}
          </select>
        </label>
        <div className="admin-form-row">
          <label className="field">
            <span className="field__label">تعداد</span>
            <input className="field__input" type="number" min={1} value={quantity} onChange={(e) => setQuantity(Number(e.target.value))} />
          </label>
          <label className="field">
            <span className="field__label">بهای واحد (تومان)</span>
            <input className="field__input" type="number" min={0} value={unitCostToman} onChange={(e) => setUnitCostToman(Number(e.target.value))} />
          </label>
        </div>
        <label className="field">
          <span className="field__label">دلیل</span>
          <textarea className="field__input" value={reason} onChange={(e) => setReason(e.target.value)} required />
        </label>
        <button className="btn btn--primary" type="submit" disabled={busy}>
          {busy ? 'در حالِ ثبت…' : 'ثبتِ برگشت'}
        </button>
        {message && (
          <div className={message.kind === 'ok' ? 'alert alert--ok' : 'alert alert--danger'}>{message.text}</div>
        )}
      </form>
    </section>
  );
}
