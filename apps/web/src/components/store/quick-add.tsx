'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { addToCart } from '@/lib/cart-actions';
import { IconCheck, IconPlus } from './icons';

/**
 * «افزودن به سبدِ سریع» روی کارتِ کالا.
 *
 * چرا کنشِ سروری و نه درخواستِ مستقیم از مرورگر؟
 *   چون شناسه‌ی سبد در یک کوکیِ httpOnly است و مرورگر حقِ خواندنش را ندارد؛
 *   کنشِ سروری آن را می‌خواند، فراخوانیِ API را انجام می‌دهد و مسیر را
 *   تازه‌سازی می‌کند — پس شمارنده‌ی سبد در نوارِ بالا بی‌درنگ درست می‌شود.
 *
 * حالتِ «انجام شد» دو ثانیه می‌ماند: بازخوردِ فوری، بدون پیامِ مزاحم.
 */
export function QuickAdd({ variantId, title }: { variantId: string; title: string }) {
  const [pending, startTransition] = useTransition();
  const [done, setDone] = useState(false);
  const router = useRouter();

  function add() {
    const data = new FormData();
    data.set('variantId', variantId);
    data.set('quantity', '1');
    startTransition(async () => {
      await addToCart(data);
      setDone(true);
      router.refresh();
      setTimeout(() => setDone(false), 2000);
    });
  }

  return (
    <button
      type="button"
      className="card-p__quick"
      onClick={add}
      disabled={pending}
      aria-label={`افزودنِ ${title} به سبدِ خرید`}
      style={done ? { background: 'var(--st-ok)', borderColor: 'var(--st-ok)' } : undefined}
    >
      {done ? <IconCheck size={16} /> : <IconPlus size={16} />}
    </button>
  );
}
