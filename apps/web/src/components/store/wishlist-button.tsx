'use client';

import { useTransition } from 'react';
import { toggleWishlist } from '@/lib/shopper-actions';

/**
 * دکمه‌ی علاقه‌مندی روی کارت کالا.
 *
 * چرا سمتِ کاربر؟ چون:
 *   ۱) وضعیتِ «آیا در علاقه‌مندی‌هاست؟» از سرور نمی‌آید (کش را خراب می‌کند)
 *   ۲) افزودن/حذف باید فوری باشد (بدون بارگیریِ دوباره‌ی صفحه)
 *   ۳) اگر کاربر وارد نشده باشد، دکمه به صفحه‌ی ورود هدایت می‌کند
 */
export function WishlistButton({ variantId }: { variantId: string }) {
  const [pending, startTransition] = useTransition();

  function handle() {
    startTransition(async () => {
      const data = new FormData();
      data.set('variantId', variantId);
      await toggleWishlist(data);
    });
  }

  return (
    <form action={handle} style={{ display: 'contents' }}>
      <button
        type="submit"
        className="card-p__quick"
        aria-label="افزودن به علاقه‌مندی‌ها"
        disabled={pending}
        title="علاقه‌مندی"
      >
        ♡
      </button>
    </form>
  );
}