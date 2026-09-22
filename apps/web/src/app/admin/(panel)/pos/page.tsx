import { redirect } from 'next/navigation';
import { adminGet, AdminApiError } from '@/lib/admin';
import { getSessionToken } from '@/lib/admin-session';
import { getIdentity, can } from '@/lib/admin-me';
import { PosTerminal, type ShiftInfo, type StockOption } from '@/components/admin/pos-terminal';

export const dynamic = 'force-dynamic';

interface ShiftList {
  count: number;
  items: ShiftInfo[];
}

interface WarehouseList {
  warehouses: Array<{ id: string; name: string; is_default: boolean }>;
}

export default async function PosPage() {
  const token = await getSessionToken();
  if (!token) redirect('/admin/login');

  const [identity, shiftResult, stockResult, warehouseResult] = await Promise.allSettled([
    getIdentity(),
    adminGet<ShiftList>('/pos/shifts?status=open', token),
    adminGet<{ items: StockOption[] }>('/inventory/stock', token),
    adminGet<WarehouseList>('/inventory/warehouses', token),
  ]);

  // ۴۰۳ یعنی این نقش به صندوق دسترسی ندارد — پیامِ روشن، نه صفحه‌ای خالی
  if (shiftResult.status === 'rejected') {
    const err = shiftResult.reason;
    if (err instanceof AdminApiError && err.status === 401) redirect('/admin/login');
    if (err instanceof AdminApiError && err.status === 403) {
      return (
        <div className="empty-state">
          <h1 className="head__title">صندوقِ حضوری</h1>
          <p className="empty">
            نقشِ شما به صندوق دسترسی ندارد. برای دیدنِ شیفت‌ها دسترسیِ
            <code className="code"> pos.read </code>
            و برای ثبتِ فروش
            <code className="code"> pos.sell </code>
            لازم است. از مدیرِ کل بخواهید این دسترسی را به نقشِ شما بیفزاید.
          </p>
        </div>
      );
    }
    return <div className="alert alert--danger">صندوق در دسترس نیست: {String(err)}</div>;
  }

  const me = identity.status === 'fulfilled' ? identity.value : null;
  // حسابدار صندوق را می‌بیند تا نقد را مغایرت‌گیری کند؛ فروش فقط با pos.sell
  const canSell = can(me, 'pos.sell');

  const shift = shiftResult.value.items[0] ?? null;
  const stock =
    stockResult.status === 'fulfilled' ? (stockResult.value.items ?? []) : [];
  const warehouses =
    warehouseResult.status === 'fulfilled' ? (warehouseResult.value.warehouses ?? []) : [];

  return (
    <>
      <header className="head">
        <h1 className="head__title">صندوقِ حضوری</h1>
        <p className="head__sub">
          {!canSell
            ? 'شما فقط مشاهده می‌کنید (دسترسیِ ثبتِ فروش ندارید)'
            : shift
              ? 'شیفت باز است — فروش ثبت کنید'
              : 'شیفتی باز نیست'}
        </p>
      </header>

      <PosTerminal shift={shift} stock={stock} warehouses={warehouses} canSell={canSell} />
    </>
  );
}
