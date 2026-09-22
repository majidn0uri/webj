import { redirect } from 'next/navigation';
import { getSessionToken } from '@/lib/admin-session';
import { QuestionsPanel } from '@/components/admin/questions-panel';

export const dynamic = 'force-dynamic';

export default async function QuestionsPage() {
  const token = await getSessionToken();
  if (!token) redirect('/admin/login');
  return <QuestionsPanel />;
}