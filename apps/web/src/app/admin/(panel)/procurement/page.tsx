import { redirect } from 'next/navigation';
import { adminGet, AdminApiError } from '@/lib/admin';
import { getSessionToken } from '@/lib/admin-session';
import { ProcurementPanel } from '@/components/admin/procurement-panel';

export const dynamic = 'force-dynamic';

interface Supplier {
  id: string;
  code: string;
  name: string;
  national_id: string | null;
  mobile: string | null;
  city: string | null;
  settlement_terms: string;
  lead_time_days: number;
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

interface VariantRow {
  variant_id: string;
  sku: string | null;
  product_title: string;
  on_hand: number;
}

/**
 * صفحه‌ی تأمین و خرید.
 *
 * چرا داده‌ها همه در یک بارگیری می‌آیند؟ چون انباردار برای ثبتِ یک رسید به
 * هر سه فهرست نیاز دارد: کالاها، تأمین‌کننده‌ها و انبارها. اگر هر کدام جدا
 * بارگیری می‌شد، فرم تا رسیدنِ آخری نیمه‌کاره می‌ماند.
 */
export default async function ProcurementPage() {
  const token = await getSessionToken();
  if (!token) redirect('/admin/login');

  const [reqRes, recRes, supRes, stockRes] = await Promise.allSettled([
    adminGet<{ items: RequestRow[] }>('/admin/procurement/requests', token),
    adminGet<{ items: ReceiptRow[] }>('/admin/procurement/receipts', token),
    adminGet<{ items: Supplier[] }>('/admin/procurement/suppliers', token),
    adminGet<{ items: VariantRow[] }>('/inventory/stock', token),
  ]);

  // نبودِ دسترسی نباید کلِ صفحه را از کار بیندازد؛ هر بخش که مجاز نبود خالی می‌ماند
  const forbidden = [reqRes, recRes, supRes].some(
    (r) => r.status === 'rejected' && r.reason instanceof AdminApiError && r.reason.status === 401,
  );
  if (forbidden) redirect('/admin/login');

  const requests = reqRes.status === 'fulfilled' ? reqRes.value.items : [];
  const receipts = recRes.status === 'fulfilled' ? recRes.value.items : [];
  const suppliers = supRes.status === 'fulfilled' ? supRes.value.items : [];
  const variants = stockRes.status === 'fulfilled' ? stockRes.value.items : [];

  // انبارها از اندپوینتِ موجودی می‌آید (پاسخ: { warehouses: [...] })
  const warehouses = await adminGet<{ warehouses: Array<{ id: string; name: string }> }>(
    '/inventory/warehouses',
    token,
  ).catch(() => ({ warehouses: [{ id: '', name: 'انبارِ اصلی' }] }));

  const pending = requests.filter((r) => r.status === 'pending_approval').length;
  const withDiscrepancy = receipts.filter((r) => r.status === 'discrepancy').length;

  return (
    <>
      <header className="head">
        <h1 className="head__title">تأمین و خرید</h1>
        <p className="head__sub">
          <span className="num">{requests.length}</span> درخواست ·{' '}
          <span className="num">{pending}</span> در انتظارِ تأیید ·{' '}
          <span className="num">{receipts.length}</span> رسید ·{' '}
          <span className="num">{withDiscrepancy}</span> مغایرت
        </p>
      </header>

      <ProcurementPanel
        requests={requests}
        receipts={receipts}
        suppliers={suppliers}
        variants={variants}
        warehouses={
          warehouses.warehouses.length ? warehouses.warehouses : [{ id: '', name: 'انبارِ اصلی' }]
        }
      />
    </>
  );
}
