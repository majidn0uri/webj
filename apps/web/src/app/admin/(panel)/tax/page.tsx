import { redirect } from 'next/navigation';
import { getIdentity, can } from '@/lib/admin-me';
import { TaxPanel } from '@/components/admin/tax-panel';

export const dynamic = 'force-dynamic';

/**
 * صفحه‌یِ مالیات و سامانه‌یِ مؤدیان.
 *
 * چرا وضعیتِ ارسال در نخستین بارگیری می‌آید؟ چون کسی که واردِ این صفحه می‌شود،
 * معمولاً یا پایانِ ماه است یا از دارایی پیام گرفته است؛ در هر دو حالت
 * «الان چند صورتحساب مانده؟» نخستین پرسش است و نباید پشتِ یک کلیک بماند.
 *
 * و چرا اجازه‌یِ ارسال اینجا (سمتِ سرور) تعیین می‌شود؟ تا دکمه‌ای که برایِ
 * این کاربر کار نمی‌کند اصلاً ساخته نشود: دیدنِ وضعیت با ارسال کردن فرق دارد
 * (`tax.read` در برابرِ `tax.send`) و نشان‌دادنِ دکمه‌یِ ناکارآمد، وعده‌ای است
 * که شکسته می‌شود.
 */
export default async function TaxPage() {
  const identity = await getIdentity();
  if (!identity) redirect('/admin/login');

  if (!can(identity, 'tax.read')) {
    return (
      <div className="alert alert--danger">
        شما اجازه‌ی دیدنِ وضعیتِ مالیاتی را ندارید. از مدیرِ سامانه دسترسیِ
        <code className="code"> tax.read </code>
        را درخواست کنید. ارسالِ صورتحساب دسترسیِ جداگانه‌ای دارد (
        <code className="code">tax.send</code>) که معمولاً در اختیارِ حسابداری
        و مدیر است.
      </div>
    );
  }

  return <TaxPanel canSend={can(identity, 'tax.send')} />;
}
