import { redirect } from 'next/navigation';
import { getSessionToken } from '@/lib/admin-session';
import { InventoryForecastPanel } from '@/components/admin/inventory-forecast-panel';

export const dynamic = 'force-dynamic';

export default async function ForecastPage() {
  const token = await getSessionToken();
  if (!token) redirect('/admin/login');
  return <InventoryForecastPanel />;
}