'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  approveReturn,
  loadReturnDetail,
  loadReturns,
  loadReturnsReference,
  loadWarranties,
  markReturnInTransit,
  payRefund,
  receiveReturnItems,
  rejectReturn,
  type ReturnDetail,
  type ReturnListItem,
  type ReturnsReference,
  type WarrantyItem,
} from '@/lib/return-actions';

/**
 * پنلِ مرجوعی و گارانتی.
 *
 * یک اصل در این صفحه: **هر دکمه، یک تصمیم است که باید بشود آن را فهمید**.
 * برای همین:
 *   • رد کردن بدونِ نوشتنِ دلیل اصلاً ممکن نیست (مشتری آن را می‌خواند)؛
 *   • بازگشتِ وجه تنها پس از بازرسی فعال می‌شود، و تا پیش از آن غیرفعال
 *     است — نه پنهان. کارمند می‌بیند که چرا نمی‌تواند؛
 *   • وضعیتِ کالا پس از بازرسی (سالم/آسیب‌دیده) مستقیماً رویِ مبلغ اثر
 *     می‌گذارد و همان‌جا نوشته شده است.
 */

type StatusFilter = 'open' | 'requested' | 'refund_pending' | 'refunded' | 'rejected' | 'all';

const STATUS_TONE: Record<string, string> = {
  requested: 'pill pill--warn',
  approved: 'pill pill--info',
  rejected: 'pill pill--danger',
  in_transit: 'pill pill--info',
  received: 'pill pill--info',
  inspecting: 'pill pill--warn',
  refund_pending: 'pill pill--warn',
  refunded: 'pill pill--ok',
  closed: 'pill',
  cancelled: 'pill',
};

export function ReturnsPanel({ canManage }: { canManage: boolean }) {
  const [reference, setReference] = useState<ReturnsReference | null>(null);
  const [items, setItems] = useState<ReturnListItem[]>([]);
  const [status, setStatus] = useState<StatusFilter>('open');
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<ReturnDetail | null>(null);
  const [message, setMessage] = useState<{ tone: 'ok' | 'bad'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    const ref = await loadReturnsReference();
    if (ref.ok) setReference(ref.data);
    const list = await loadReturns({ status: status === 'all' ? undefined : status, q: query || undefined });
    if (list.ok) setItems(list.data);
    else setMessage({ tone: 'bad', text: list.message });
  }, [status, query]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!selectedId) {
      setDetail(null);
      return;
    }
    void loadReturnDetail(selectedId).then((result) => {
      if (result.ok) setDetail(result.data);
      else setMessage({ tone: 'bad', text: result.message });
    });
  }, [selectedId]);

  const act = useCallback(
    async (fn: () => Promise<{ ok: boolean; message?: string }>, okText: string) => {
      setBusy(true);
      setMessage(null);
      const result = await fn();
      setBusy(false);
      if (result.ok) {
        setMessage({ tone: 'ok', text: okText });
        await refresh();
        if (selectedId) {
          const fresh = await loadReturnDetail(selectedId);
          if (fresh.ok) setDetail(fresh.data);
        }
      } else {
        setMessage({ tone: 'bad', text: result.message ?? 'ناموفق بود' });
      }
    },
    [refresh, selectedId],
  );

  const summary = reference?.summary;
  const conditions = reference?.conditions ?? [];
  const refundMethods = reference?.refundMethods ?? [];

  return (
    <div className="stack">
      {message ? (
        <div className={message.tone === 'ok' ? 'alert alert--ok' : 'alert alert--danger'}>{message.text}</div>
      ) : null}

      {/* ── کارتابل ─────────────────────────────────────────────────── */}
      <section className="stats">
        <div className="stat">
          <span className="stat__label">در انتظارِ تصمیم</span>
          <span className="stat__value">{summary?.awaitingDecision ?? '—'}</span>
          <span className="stat__hint">درخواستی که هنوز بررسی نشده</span>
        </div>
        <div className="stat">
          <span className="stat__label">در جریان</span>
          <span className="stat__value">{summary?.awaitingRefund ?? '—'}</span>
          <span className="stat__hint">تأیید تا پیش از بازگشتِ وجه</span>
        </div>
        <div className="stat">
          <span className="stat__label">بازگشت‌داده‌شده</span>
          <span className="stat__value">{summary?.refundedCount ?? '—'}</span>
          <span className="stat__hint">{summary?.refundedToman ?? '۰'} تومان</span>
        </div>
        <div className="stat">
          <span className="stat__label">میانگینِ زمانِ بازگشت</span>
          <span className="stat__value">
            {summary?.averageDaysToRefund === null || summary?.averageDaysToRefund === undefined
              ? '—'
              : `${summary.averageDaysToRefund}`}
          </span>
          <span className="stat__hint">روز، از درخواست تا واریز</span>
        </div>
      </section>

      {/* ── فهرست ───────────────────────────────────────────────────── */}
      <section className="panel panel--flush panel--flush">
        <div className="panel__head">
          <h2 className="panel__title">درخواست‌هایِ مرجوعی</h2>
          <div className="filters">
            <select value={status} onChange={(e) => setStatus(e.target.value as StatusFilter)}>
              <option value="open">باز (در جریان)</option>
              <option value="requested">در انتظارِ تصمیم</option>
              <option value="refund_pending">در انتظارِ بازگشتِ وجه</option>
              <option value="refunded">انجام‌شده</option>
              <option value="rejected">ردشده</option>
              <option value="all">همه</option>
            </select>
            <input
              type="search"
              placeholder="جستجو: شماره، سفارش، موبایل"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
        </div>

        {items.length === 0 ? (
          <p className="empty">درخواستی با این فیلتر نیست.</p>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>شماره</th>
                <th>سفارش</th>
                <th>مشتری</th>
                <th>انگیزه</th>
                <th>وضعیت</th>
                <th>کالا</th>
                <th>مبلغ</th>
                <th>تاریخ</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id}>
                  <td className="num">{item.returnNo}</td>
                  <td className="num">{item.orderNo}</td>
                  <td>{item.customerName ?? '—'}</td>
                  <td>{item.kindLabel}</td>
                  <td>
                    <span className={STATUS_TONE[item.status] ?? 'pill'}>{item.statusLabel}</span>
                  </td>
                  <td className="num">{item.itemCount}</td>
                  <td className="num">{item.refundToman}</td>
                  <td className="num">{item.requestedAtJalali}</td>
                  <td>
                    <button className="btn btn--ghost" onClick={() => setSelectedId(item.id)}>
                      جزئیات
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {/* ── جزئیات ──────────────────────────────────────────────────── */}
      {detail ? (
        <ReturnDetailCard
          detail={detail}
          conditions={conditions}
          refundMethods={refundMethods}
          canManage={canManage}
          busy={busy}
          onClose={() => setSelectedId(null)}
          onApprove={(note) => void act(() => approveReturn(detail.return.id, note), 'درخواست تأیید شد.')}
          onReject={(note) => void act(() => rejectReturn(detail.return.id, note), 'درخواست رد شد.')}
          onTransit={(code) =>
            void act(() => markReturnInTransit(detail.return.id, code), 'در راهِ بازگشت ثبت شد.')
          }
          onReceive={(rows) =>
            void act(
              () => receiveReturnItems(detail.return.id, rows),
              'بازرسی ثبت شد؛ کالایِ سالم به موجودی برگشت و مبلغِ بازگشت قطعی شد.',
            )
          }
          onRefund={(method) =>
            void act(() => payRefund(detail.return.id, method), 'بازگشتِ وجه ثبت شد و از صندوق/بانک خارج گردید.')
          }
        />
      ) : null}

      <WarrantySection />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

function ReturnDetailCard({
  detail,
  conditions,
  refundMethods,
  canManage,
  busy,
  onClose,
  onApprove,
  onReject,
  onTransit,
  onReceive,
  onRefund,
}: {
  detail: ReturnDetail;
  conditions: Array<{ value: string; label: string }>;
  refundMethods: Array<{ value: string; label: string }>;
  canManage: boolean;
  busy: boolean;
  onClose: () => void;
  onApprove: (note: string) => void;
  onReject: (note: string) => void;
  onTransit: (code: string) => void;
  onReceive: (rows: Array<{ itemId: string; condition: string; restock: boolean; note?: string }>) => void;
  onRefund: (method: string) => void;
}) {
  const ret = detail.return;
  const [note, setNote] = useState('');
  const [tracking, setTracking] = useState(ret.trackingCode ?? '');
  const [method, setMethod] = useState(refundMethods[0]?.value ?? 'bank_transfer');
  const [rows, setRows] = useState<Record<string, { condition: string; restock: boolean; note: string }>>({});

  useEffect(() => {
    const initial: Record<string, { condition: string; restock: boolean; note: string }> = {};
    for (const item of detail.items) {
      initial[item.id] = { condition: item.condition ?? 'unknown', restock: item.restock, note: '' };
    }
    setRows(initial);
  }, [detail.items]);

  const canDecide = ret.status === 'requested';
  const canTransit = ret.status === 'approved';
  const canReceive = ret.status === 'approved' || ret.status === 'in_transit' || ret.status === 'received';
  const canRefund = ret.status === 'refund_pending';

  const reasonHint = useMemo(() => {
    if (!canRefund) return 'بازگشتِ وجه تنها پس از ثبتِ بازرسیِ کالا فعال می‌شود (وجه بی‌کالا برنمی‌گردد).';
    return 'با زدنِ این دکمه، سندِ پرداخت ثبت و مبلغ از صندوق یا بانک خارج می‌شود.';
  }, [canRefund]);

  return (
    <section className="panel panel--flush subpanel">
      <div className="panel__head">
        <h2 className="panel__title">
          {ret.returnNo} — <span className={STATUS_TONE[ret.status] ?? 'pill'}>{ret.statusLabel}</span>
        </h2>
        <button className="btn btn--ghost" onClick={onClose}>
          بستن
        </button>
      </div>

      <div className="grid3">
        <div className="hint-cell">
          <b>سفارش:</b> {ret.orderNo} — {ret.orderTotalToman} تومان
        </div>
        <div className="hint-cell">
          <b>انگیزه:</b> {ret.kindLabel}
        </div>
        <div className="hint-cell">
          <b>ثبت:</b> {ret.requestedAtJalali}
        </div>
        {ret.customerNote ? (
          <div className="hint-cell">
            <b>توضیحِ مشتری:</b> {ret.customerNote}
          </div>
        ) : null}
        {ret.decisionNote ? (
          <div className="hint-cell">
            <b>یادداشتِ تصمیم:</b> {ret.decisionNote}
          </div>
        ) : null}
        {ret.trackingCode ? (
          <div className="hint-cell">
            <b>کدِ رهگیریِ برگشتی:</b> {ret.trackingCode}
          </div>
        ) : null}
      </div>

      {/* ── کالاها ──────────────────────────────────────────────────── */}
      <table className="table table--inner">
        <thead>
          <tr>
            <th>کالا</th>
            <th>تعداد</th>
            <th>وضعیتِ پس از بازرسی</th>
            <th>به موجودی برگردد</th>
            <th>مبلغِ بازگشت</th>
          </tr>
        </thead>
        <tbody>
          {detail.items.map((item) => {
            const row = rows[item.id] ?? { condition: 'unknown', restock: true, note: '' };
            return (
              <tr key={item.id}>
                <td>
                  {item.title}
                  {item.sku ? <span className="hint-cell"> ({item.sku})</span> : null}
                </td>
                <td className="num">{item.quantity}</td>
                <td>
                  {canReceive && canManage ? (
                    <select
                      value={row.condition}
                      onChange={(e) =>
                        setRows((prev) => ({ ...prev, [item.id]: { ...row, condition: e.target.value } }))
                      }
                    >
                      {conditions.map((c) => (
                        <option key={c.value} value={c.value}>
                          {c.label}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <span>{item.conditionLabel}</span>
                  )}
                </td>
                <td>
                  {canReceive && canManage ? (
                    <input
                      type="checkbox"
                      checked={row.restock}
                      onChange={(e) =>
                        setRows((prev) => ({ ...prev, [item.id]: { ...row, restock: e.target.checked } }))
                      }
                    />
                  ) : (
                    <span>{item.restock ? 'بله' : 'خیر'}</span>
                  )}
                </td>
                <td className="num">{item.refundToman} تومان</td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {canManage ? (
        <div className="actions">
          {canDecide ? (
            <>
              <input
                className="grow"
                placeholder="یادداشت (برایِ رد کردن الزامی است)"
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
              <button className="btn" disabled={busy} onClick={() => onApprove(note)}>
                تأیید
              </button>
              <button className="btn btn--danger" disabled={busy} onClick={() => onReject(note)}>
                رد
              </button>
            </>
          ) : null}

          {canTransit ? (
            <>
              <input
                placeholder="کدِ رهگیریِ مرسوله‌ی برگشتی"
                value={tracking}
                onChange={(e) => setTracking(e.target.value)}
              />
              <button className="btn" disabled={busy} onClick={() => onTransit(tracking)}>
                در راهِ بازگشت
              </button>
            </>
          ) : null}

          {canReceive ? (
            <button
              className="btn"
              disabled={busy}
              onClick={() =>
                onReceive(
                  detail.items.map((item) => ({
                    itemId: item.id,
                    condition: rows[item.id]?.condition ?? 'unknown',
                    restock: rows[item.id]?.restock ?? true,
                  })),
                )
              }
            >
              ثبتِ بازرسی و دریافت
            </button>
          ) : null}

          {canRefund ? (
            <>
              <select value={method} onChange={(e) => setMethod(e.target.value)}>
                {refundMethods.map((m) => (
                  <option key={m.value} value={m.value}>
                    {m.label}
                  </option>
                ))}
              </select>
              <button className="btn btn--primary" disabled={busy} onClick={() => onRefund(method)}>
                بازگشتِ وجه ({ret.refundToman} تومان)
              </button>
            </>
          ) : null}
        </div>
      ) : null}

      {canManage ? <p className="hint-cell">{reasonHint}</p> : null}

      {/* ── خطِ زمان ────────────────────────────────────────────────── */}
      <h3 className="panel__title">تاریخچه</h3>
      <ul className="hints">
        {detail.timeline.map((event, index) => (
          <li key={`${event.eventType}-${index}`}>
            <b>{translateEvent(event.eventType)}</b>
            {event.createdAtJalali ? <span className="hint-cell"> — {event.createdAtJalali}</span> : null}
            {event.note ? <div className="hint-cell">{event.note}</div> : null}
          </li>
        ))}
      </ul>
    </section>
  );
}

/** برگردانِ نامِ رخداد به فارسیِ خوانا */
function translateEvent(type: string): string {
  const map: Record<string, string> = {
    requested: 'درخواست ثبت شد',
    approved: 'تأیید شد',
    rejected: 'رد شد',
    in_transit: 'در راهِ بازگشت',
    received: 'به انبار رسید',
    inspected: 'بازرسی شد و مبلغ قطعی گردید',
    refunded: 'وجه برگشت داده شد',
    cancelled: 'لغو شد',
    credit_note_queued: 'صورتحسابِ اصلاحی در صفِ ارسال قرار گرفت',
    credit_note_failed: 'صدورِ صورتحسابِ اصلاحی ناموفق بود',
  };
  return map[type] ?? type;
}

// ─────────────────────────────────────────────────────────────────────────────

function WarrantySection() {
  const [items, setItems] = useState<WarrantyItem[]>([]);
  const [status, setStatus] = useState<'all' | 'active' | 'expiring'>('expiring');

  useEffect(() => {
    void loadWarranties({
      status: status === 'expiring' ? undefined : status,
      expiringInDays: status === 'expiring' ? '30' : undefined,
    }).then((result) => {
      if (result.ok) setItems(result.data);
    });
  }, [status]);

  return (
    <section className="panel panel--flush subpanel">
      <div className="panel__head">
        <h2 className="panel__title">گارانتی</h2>
        <select value={status} onChange={(e) => setStatus(e.target.value as 'all' | 'active' | 'expiring')}>
          <option value="expiring">۳۰ روزِ آینده</option>
          <option value="active">فعال</option>
          <option value="all">همه</option>
        </select>
      </div>

      {items.length === 0 ? (
        <p className="empty">موردی در این بازه نیست.</p>
      ) : (
        <table className="table table--inner">
          <thead>
            <tr>
              <th>کالا</th>
              <th>سفارش</th>
              <th>مشتری</th>
              <th>مدت</th>
              <th>آغاز</th>
              <th>پایان</th>
              <th>وضعیت</th>
            </tr>
          </thead>
          <tbody>
            {items.map((w) => (
              <tr key={w.id}>
                <td>
                  {w.title}
                  {w.serialNo ? <span className="hint-cell"> — سریال {w.serialNo}</span> : null}
                </td>
                <td className="num">{w.orderNo}</td>
                <td>{w.customerName ?? '—'}</td>
                <td className="num">{w.months} ماه</td>
                <td className="num">{w.startsAt}</td>
                <td className="num">{w.endsAtJalali}</td>
                <td>
                  <span className={w.status === 'active' ? 'pill pill--ok' : 'pill'}>{w.status}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
