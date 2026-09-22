'use client';

import { useState, useEffect, useCallback } from 'react';

interface AbcItem {
  productId: string;
  title: string;
  totalQty: number;
  totalRevenue: number;
  cumsumPct: number;
  category: 'A' | 'B' | 'C';
}

interface SlowMover {
  productId: string;
  title: string;
  stock: number;
  lastSale: string | null;
  price: number;
  daysSinceLastSale: number | null;
}

interface ReorderItem {
  productId: string;
  title: string;
  sku: string;
  currentStock: number;
  reorderPoint: number;
  avgDailySales: number;
  daysOfStock: number | null;
  urgency: 'critical' | 'warning' | 'normal' | 'unknown';
}

type Tab = 'abc' | 'slow' | 'reorder';

export function InventoryForecastPanel() {
  const [tab, setTab] = useState<Tab>('reorder');
  const [abcItems, setAbcItems] = useState<AbcItem[]>([]);
  const [abcSummary, setAbcSummary] = useState({ A: 0, B: 0, C: 0 });
  const [slowItems, setSlowItems] = useState<SlowMover[]>([]);
  const [reorderItems, setReorderItems] = useState<ReorderItem[]>([]);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setBusy(true);
    const headers = { 'Authorization': `Bearer ${localStorage.getItem('admin_token') ?? ''}` };
    try {
      if (tab === 'abc') {
        const res = await fetch('/api/admin/inventory-forecast/abc?days=90', { headers });
        if (res.ok) {
          const data = await res.json();
          setAbcItems(data.items ?? []);
          setAbcSummary(data.summary ?? { A: 0, B: 0, C: 0 });
        }
      } else if (tab === 'slow') {
        const res = await fetch('/api/admin/inventory-forecast/slow-movers?days=60', { headers });
        if (res.ok) {
          const data = await res.json();
          setSlowItems(data.items ?? []);
        }
      } else {
        const res = await fetch('/api/admin/inventory-forecast/reorder', { headers });
        if (res.ok) {
          const data = await res.json();
          setReorderItems(data.items ?? []);
        }
      }
    } finally { setBusy(false); }
  }, [tab]);

  useEffect(() => { load(); }, [load]);

  const formatRial = (v: number) => (v / 10).toLocaleString('fa-IR');

  return (
    <>
      <header className="head">
        <h1 className="head__title">پیش‌بینی موجودی</h1>
        <p className="head__sub">تحلیل ABC، کالاهای کم‌فروش، نقطه سفارش</p>
      </header>

      <nav className="filters">
        <button className={`chip${tab === 'reorder' ? ' chip--active' : ''}`} onClick={() => setTab('reorder')}>
          🔴 نقطه سفارش
        </button>
        <button className={`chip${tab === 'abc' ? ' chip--active' : ''}`} onClick={() => setTab('abc')}>
          📊 تحلیل ABC
        </button>
        <button className={`chip${tab === 'slow' ? ' chip--active' : ''}`} onClick={() => setTab('slow')}>
          🐌 کم‌فروش
        </button>
      </nav>

      {busy && <p className="muted">در حال بارگذاری…</p>}

      {/* ── نقطه سفارش ───────────────────────────────── */}
      {tab === 'reorder' && !busy && (
        <section className="panel panel--flush panel--flush">
          {reorderItems.length === 0 ? (
            <p className="empty">همه کالاها موجودی کافی دارند 🎉</p>
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>کالا</th>
                  <th>SKU</th>
                  <th>موجودی</th>
                  <th>نقطه سفارش</th>
                  <th>فروش روزانه</th>
                  <th>روز باقیمانده</th>
                  <th>وضعیت</th>
                </tr>
              </thead>
              <tbody>
                {reorderItems.map((item) => (
                  <tr key={item.productId + item.sku}>
                    <td>{item.title}</td>
                    <td className="num">{item.sku}</td>
                    <td className="num">{item.currentStock.toLocaleString('fa-IR')}</td>
                    <td className="num">{item.reorderPoint.toLocaleString('fa-IR')}</td>
                    <td className="num">{item.avgDailySales.toFixed(1)}</td>
                    <td className="num">{item.daysOfStock?.toLocaleString('fa-IR') ?? '—'}</td>
                    <td>
                      <span className={`pill pill--${item.urgency === 'critical' ? 'danger' : item.urgency === 'warning' ? 'warn' : 'muted'}`}>
                        {item.urgency === 'critical' ? 'بحرانی' : item.urgency === 'warning' ? 'هشدار' : 'عادی'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      )}

      {/* ── ABC ────────────────────────────────────────── */}
      {tab === 'abc' && !busy && (
        <section className="panel panel--flush panel--flush">
          <div className="u-flex u-gap-4 u-mb-4">
            <div className="stat-card">
              <div className="stat-card__value" style={{ color: 'var(--c-ok, #22c55e)' }}>A</div>
              <div className="stat-card__label">{abcSummary.A} کالا (۸۰٪ فروش)</div>
            </div>
            <div className="stat-card">
              <div className="stat-card__value" style={{ color: 'var(--c-warn, #f59e0b)' }}>B</div>
              <div className="stat-card__label">{abcSummary.B} کالا (۱۵٪ فروش)</div>
            </div>
            <div className="stat-card">
              <div className="stat-card__value" style={{ color: 'var(--c-danger, #ef4444)' }}>C</div>
              <div className="stat-card__label">{abcSummary.C} کالا (۵٪ فروش)</div>
            </div>
          </div>

          {abcItems.length === 0 ? (
            <p className="empty">داده‌ای برای تحلیل موجود نیست.</p>
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>کالا</th>
                  <th>دسته</th>
                  <th>تعداد فروش</th>
                  <th>درآمد</th>
                  <th>درصد تجمعی</th>
                </tr>
              </thead>
              <tbody>
                {abcItems.map((item) => (
                  <tr key={item.productId}>
                    <td>{item.title}</td>
                    <td>
                      <span className={`pill pill--${item.category === 'A' ? 'ok' : item.category === 'B' ? 'warn' : 'danger'}`}>
                        {item.category}
                      </span>
                    </td>
                    <td className="num">{item.totalQty.toLocaleString('fa-IR')}</td>
                    <td className="num">{formatRial(item.totalRevenue)} ت</td>
                    <td className="num">{item.cumsumPct}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      )}

      {/* ── Slow Movers ────────────────────────────────── */}
      {tab === 'slow' && !busy && (
        <section className="panel panel--flush panel--flush">
          {slowItems.length === 0 ? (
            <p className="empty">کالای کم‌فروشی یافت نشد 🎉</p>
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>کالا</th>
                  <th>موجودی</th>
                  <th>قیمت</th>
                  <th>آخرین فروش</th>
                  <th>روز بدون فروش</th>
                </tr>
              </thead>
              <tbody>
                {slowItems.map((item) => (
                  <tr key={item.productId}>
                    <td>{item.title}</td>
                    <td className="num">{item.stock.toLocaleString('fa-IR')}</td>
                    <td className="num">{formatRial(item.price)} ت</td>
                    <td>{item.lastSale ? new Date(item.lastSale).toLocaleDateString('fa-IR') : 'هرگز'}</td>
                    <td className="num">{item.daysSinceLastSale?.toLocaleString('fa-IR') ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      )}
    </>
  );
}