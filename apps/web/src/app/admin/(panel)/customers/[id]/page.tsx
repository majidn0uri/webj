import { redirect } from 'next/navigation';
import { adminGet, AdminApiError } from '@/lib/admin';
import { getSessionToken } from '@/lib/admin-session';
import { CustomerDossier } from '@/components/admin/customer-dossier';

export const dynamic = 'force-dynamic';

interface AddressRow {
  id: string;
  receiver_name: string | null;
  phone: string | null;
  province: string | null;
  city: string | null;
  address: string | null;
  postal_code: string | null;
  is_default: boolean;
}

interface WishRow {
  variant_id: string;
  title: string;
  sku: string | null;
  created_at: string;
}

interface Dossier {
  customer: {
    id: string;
    fullName: string;
    phone: string | null;
    email: string | null;
    kind: string;
    isActive: boolean;
    deactivatedReason: string | null;
    note: string | null;
    isPartner: boolean;
    nationalId: string | null;
    creditLimitToman: number | null;
    checkCeilingToman: number | null;
    mobileVerifiedAt: string | null;
    lastLoginAt: string | null;
    registeredAt: string;
  };
  stats: {
    orderCount: number;
    spentToman: number;
    spentDisplay: string;
    addressCount: number;
    wishlistCount: number;
  };
  orders: Array<{
    id: string;
    orderNo: string;
    status: string;
    totalToman: number;
    totalDisplay: string;
    at: string;
  }>;
  addresses: AddressRow[];
  wishlist: WishRow[];
}

export default async function CustomerDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const token = await getSessionToken();
  if (!token) redirect('/admin/login');

  const { id } = await params;

  let dossier: Dossier | null = null;
  let error: string | null = null;
  let forbidden = false;

  try {
    dossier = await adminGet<Dossier>(`/admin/customers/${id}`, token);
  } catch (err) {
    if (err instanceof AdminApiError && err.status === 401) redirect('/admin/login');
    if (err instanceof AdminApiError && err.status === 404) return (
      <div className="alert alert--danger">این مشتری پیدا نشد.</div>
    );
    if (err instanceof AdminApiError && err.status === 403) forbidden = true;
    else error = err instanceof AdminApiError ? err.message : 'پرونده در دسترس نیست.';
  }

  if (forbidden) {
    return (
      <div className="alert alert--danger">
        شما اجازه‌ی دیدنِ پرونده‌ی مشتری را ندارید. دسترسیِ
        <code className="code"> customer.read </code>
        لازم است.
      </div>
    );
  }

  if (error) return <div className="alert alert--danger">{error}</div>;
  if (!dossier) return null;

  return <CustomerDossier dossier={dossier} />;
}
