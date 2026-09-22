'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { IconUser } from '../store/icons';

/**
 * پیوندِ حساب در هدر — سمتِ کاربر.
 *
 * چرا سمتِ کاربر؟ چون صفحه‌هایِ فروشگاه باید ایستا بمانند تا پشتِ کش و CDN
 * هم جواب بدهند (هزاران خریدارِ همزمان). اگر نامِ مشتری را در سرور می‌خواندیم،
 * هر صفحه به‌خاطرِ خواندنِ کوکی پویا می‌شد و کش از دست می‌رفت.
 *
 * راهِ درست: صفحه ایستا می‌ماند، و این یک مؤلفه پس از بارگذاری نشست را
 * می‌پرسد. نتیجه برایِ کاربر یکی است، با این تفاوت که هزینه‌اش فقط یک
 * درخواستِ کوچک است، نه پویا شدنِ کلِ سایت.
 */
export function AccountLink() {
  const [name, setName] = useState<string | null>(null);
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    let alive = true;
    fetch('/api/shop/me', { credentials: 'same-origin' })
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { fullName?: string | null } | null) => {
        if (!alive) return;
        setName(data?.fullName ?? null);
      })
      .catch(() => undefined)
      .finally(() => {
        if (alive) setChecked(true);
      });
    return () => {
      alive = false;
    };
  }, []);

  // رندرِ نخست باید رویِ سرور و کاربر یکسان باشد (وگرنه نکست از ناهم‌خوانی
  // شکایت می‌کند)؛ برای همین برچسبِ آغازین ثابت است و پس از پاسخ تغییر می‌کند.
  const label = !checked ? 'ورود' : name ? name.split(' ')[0] : 'حسابِ من';

  return (
    <Link
      href="/account"
      className="iconbtn"
      aria-label={checked && name ? `حسابِ ${name}` : 'ورود به حساب'}
    >
      <IconUser size={19} />
      <span style={{ fontSize: '1.25rem' }}>{label}</span>
    </Link>
  );
}
