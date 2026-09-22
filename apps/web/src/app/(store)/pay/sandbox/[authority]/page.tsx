import { api } from '@/lib/api';
import { SandboxBankForm } from './form';

export const dynamic = 'force-dynamic';

/**
 * صفحه‌ی شبیه‌سازی‌شده‌ی بانک (درگاهِ آزمایشی).
 *
 * این صفحه فقط در محیطِ توسعه/آزمایش دیده می‌شود و جایگزینِ صفحه‌ی واقعیِ
 * بانک است: همان مسیرِ واقعی طی می‌شود (هدایت ← تصمیم ← بازگشت ← تأییدِ
 * سمتِ سرور)، با این تفاوت که نتیجه را خودِ کاربر انتخاب می‌کند تا بتوان
 * هر سه حالتِ موفق، انصراف و خطا را آزمود.
 */
export default async function SandboxPayPage({ params }: { params: Promise<{ authority: string }> }) {
  const { authority } = await params;

  // اطلاعاتِ تراکنش را از سامانه می‌گیریم تا مبلغ همان باشد که فروشگاه ثبت کرده
  const payment = await api.paymentByAuthority(authority).catch(() => null);

  return (
    <SandboxBankForm
      authority={authority}
      amountRial={payment?.amountRial ?? null}
      orderNo={payment?.orderNo ?? null}
      status={payment?.status ?? null}
    />
  );
}
