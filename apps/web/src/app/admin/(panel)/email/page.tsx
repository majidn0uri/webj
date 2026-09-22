import { redirect } from 'next/navigation';
import { getSessionToken } from '@/lib/admin-session';
import { EmailPanel } from '@/components/admin/email-panel';

export const dynamic = 'force-dynamic';

export default async function EmailPage() {
  const token = await getSessionToken();
  if (!token) redirect('/admin/login');
  return <EmailPanel />;
}