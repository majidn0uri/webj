'use server';

/**
 * سواچِ رنگ — بارگیری از کارساز.
 *
 * چرا نهان‌سازی (revalidate) دارد؟ چون رنگ‌ها با هر بازدید عوض نمی‌شوند،
 * امّا فروشنده ممکن است رنگی را تمام کند یا تصویرش را عوض کند؛ با این
 * زمان، تغییر او نهایتاً یک دقیقه دیر می‌رسد، و در عوض برگه برایِ صدها
 * بازدید از حافظه خوانده می‌شود نه از پایگاه.
 *
 * و اگر کارساز در دسترس نباشد، تهی برمی‌گردانیم: بی‌سواچ، کالا هنوز
 * فروختنی است — برگه نباید به‌خاطرِ رنگ بشکند.
 */

const ORIGIN = process.env.API_BASE ?? 'http://127.0.0.1:3000';

export interface Swatch {
  name: string;
  hex: string;
  variantId: string;
  variantIds: string[];
  sku: string | null;
  priceRial: number;
  available: number;
  imageUrl: string | null;
  imageCardUrl: string | null;
  imageThumbUrl: string | null;
  placeholder: string | null;
  hasOwnImage: boolean;
  outOfStock: boolean;
}

export async function loadColourSwatches(slug: string): Promise<Swatch[]> {
  try {
    const res = await fetch(`${ORIGIN}/products/${encodeURIComponent(slug)}/colours`, {
      next: { revalidate: 60 },
    });
    if (!res.ok) return [];
    const data = (await res.json()) as { items?: Swatch[] };
    return data.items ?? [];
  } catch {
    return [];
  }
}
