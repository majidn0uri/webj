import { BannerPanel } from '@/components/admin/banner-panel';

export const dynamic = 'force-dynamic';

export const metadata = { title: 'ویترین — پنلِ ست‌شاپ' };

/**
 * ویترینِ فروشگاه.
 *
 * تا پیش از این، نوشتنِ یک پیام در بالایِ سایت یا گذاشتنِ یک بنرِ تبلیغاتی
 * یعنی تغییر در کد — یعنی باید توسعه‌دهنده صدا زده می‌شد. این صفحه همان
 * کار را به دستِ فروشنده می‌دهد: می‌نویسد، زمان می‌دهد، خاموش و روشن
 * می‌کند، و نتیجه را همان لحظه روی سایت می‌بیند.
 */
export default function BannersPage() {
  return (
    <div className="page">
      <header className="page__head">
        <h1 className="page__title">ویترین</h1>
        <p className="page__sub">
          پیامِ بالایِ سایت، بنرِ اصلیِ صفحه‌یِ نخست، و بنرهایِ میانی — هرچه اینجا
          می‌نویسید همان لحظه روی فروشگاه می‌آید.
        </p>
      </header>

      <BannerPanel />
    </div>
  );
}
