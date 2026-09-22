import { redirect } from 'next/navigation';
import { adminGet, AdminApiError, type StockList } from '@/lib/admin';
import { getSessionToken } from '@/lib/admin-session';
import { StockAdjust } from '@/components/admin/stock-adjust';
import { InventoryCount } from '@/components/admin/inventory-count';
import { TransferStock } from '@/components/admin/transfer-stock';

export const dynamic = 'force-dynamic';

export default async function InventoryPage() {
  const token = await getSessionToken();
  if (!token) redirect('/admin/login');

  let data: StockList;
  try {
    data = await adminGet<StockList>('/inventory/stock', token);
  } catch (err) {
    if (err instanceof AdminApiError && err.status === 401) redirect('/admin/login');
    return <div className="alert alert--danger">موجودی در دسترس نیست: {String(err)}</div>;
  }

  let warehouses: Array<{ id: string; name: string }> = [];
  try {
    const wData = await adminGet<{ items: Array<{ id: string; name: string }> }>('/inventory/warehouses', token);
    warehouses = wData.items ?? [];
  } catch { /* */ }

  const rows = data.items ?? [];
  const lowCount = rows.filter((r) => r.available > 0 && r.available <= 3).length;
  const outCount = rows.filter((r) => r.available <= 0).length;

  // لیست تنوعات برای انتقال
  const variants = rows.map((r) => ({ id: r.variant_id, sku: r.sku, title: r.product_title }));

  return (
    <>
      <header className="head">
        <h1 className="head__title">موجودیِ انبار</h1>
        <p className="head__sub">
          <span className="num">{rows.length}</span> کالا ·{' '}
          <span className="num">{lowCount}</span> کم‌موجود ·{' '}
          <span className="num">{outCount}</span> تمام‌شده
        </p>
      </header>

      <InventoryCount warehouses={warehouses} />
      <TransferStock warehouses={warehouses} variants={variants} />

      <section className="panel panel--flush">
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>کالا</th>
                <th>شناسه</th>
                <th className="ta-left">موجود</th>
                <th className="ta-left">رزرو</th>
                <th className="ta-left">قابل‌فروش</th>
                <th className="ta-left">تعدیل</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.variant_id}>
                  <td>{r.product_title}</td>
                  <td className="num muted">{r.sku}</td>
                  <td className="num ta-left">{r.on_hand}</td>
                  <td className="num ta-left">{r.reserved}</td>
                  <td className="num ta-left">
                    <span className={`pill pill--${r.available <= 0 ? 'danger' : r.available <= 3 ? 'warn' : 'ok'}`}>
                      {r.available}
                    </span>
                  </td>
                  <td className="ta-left">
                    <StockAdjust
                      variantId={r.variant_id}
                      sku={r.sku}
                      available={r.available}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}