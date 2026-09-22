import { CategoriesPanel } from '@/components/admin/categories-panel';

export const dynamic = 'force-dynamic';

export const metadata = { title: 'دسته‌بندی — پنلِ ست‌شاپ' };

/**
 * مدیریتِ درختِ دسته‌بندی.
 *
 * تا پیش از این، دسته‌ها در کد نوشته شده بودند: برایِ افزودنِ یک دسته باید
 * توسعه‌دهنده صدا زده می‌شد. اینجا فروشنده خودش درخت می‌سازد، جابه‌جا
 * می‌کند، پنهان می‌کند و پاک می‌کند — و منویِ فروشگاه همان لحظه عوض می‌شود.
 *
 * سقفِ ژرفا سه سطح است: ریشه، گروه، برگ. سطحِ چهارم در منویِ آبشاری جایی
 * ندارد و کالایش تنها از مسیرِ فیلتر پیدا می‌شود.
 */
export default function CategoriesPage() {
  return (
    <div className="page">
      <header className="page__head">
        <h1 className="page__title">دسته‌بندی</h1>
        <p className="page__sub">
          درختِ دسته‌ها، همان که منویِ فروشگاه از آن ساخته می‌شود. دسته‌ای که در
          خودش و زیردسته‌هایش کالا نداشته باشد، در منویِ خریدار نمی‌آید.
        </p>
      </header>

      <CategoriesPanel />
    </div>
  );
}
