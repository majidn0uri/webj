import { ReviewsPanel } from '@/components/admin/reviews-panel';

export const dynamic = 'force-dynamic';

export const metadata = { title: 'نظرات — پنلِ ست‌شاپ' };

/**
 * مدیریتِ نظرات.
 *
 * این صفحه صفِ بررسی است: نخست آنچه در انتظار است. فروشنده اینجا منتشر
 * می‌کند، رد می‌کند، و — مهم‌تر — پاسخ می‌دهد. پاک کردنِ نظرِ بد آسان
 * است و بی‌فایده؛ پاسخ دادن زیرِ همان نظر، هم مشکلِ مشتری را می‌گوید و
 * هم به خریدارِ بعدی نشان می‌دهد فروشنده هست و پاسخ‌گو است.
 */
export default function ReviewsPage() {
  return (
    <div className="page">
      <header className="page__head">
        <h1 className="page__title">نظرات و امتیازها</h1>
        <p className="page__sub">
          نظری که اینجا منتشر می‌کنید همان لحظه روی صفحه‌یِ کالا می‌آید. نشانِ
          «خریدِ تأیید‌شده» تنها برایِ کسی است که کالا را از فروشگاه خریده و
          تحویل گرفته باشد.
        </p>
      </header>

      <ReviewsPanel />
    </div>
  );
}
