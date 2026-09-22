import { can, getIdentity } from '@/lib/admin-me';
import { redirect } from 'next/navigation';
import { ReturnsPanel } from '@/components/admin/returns-panel';

/**
 * صفحه‌یِ مرجوعی و گارانتی.
 *
 * دسترسی دو سطح دارد و این تفاوت در رابط هم دیده می‌شود: کسی که فقط
 * `returns.read` دارد پنل را می‌بیند اما دکمه‌هایِ تغییر را نه — پنهان‌کاری
 * بهتر از آن است که دکمه‌ای باشد که با زدنش خطایِ دسترسی بگیرد.
 */
export default async function ReturnsPage() {
  const identity = await getIdentity();
  if (!identity) redirect('/admin/login');

  if (!can(identity, 'returns.read')) {
    return (
      <div className="alert alert--danger">
        دسترسیِ «مشاهده‌یِ مرجوعی» (<code>returns.read</code>) برایِ نقشِ شما فعال نیست.
      </div>
    );
  }

  return (
    <div className="stack">
      <header className="panel__head">
        <h1 className="panel__title">مرجوعی و گارانتی</h1>
        <p className="hint-cell">
          از درخواستِ مشتری تا بازگشتِ کالا به قفسه و برگشتِ وجه — با سندِ حسابداری و صورتحسابِ اصلاحی.
        </p>
      </header>
      <ReturnsPanel canManage={can(identity, 'returns.manage')} />
    </div>
  );
}
