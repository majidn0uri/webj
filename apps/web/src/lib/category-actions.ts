'use server';

import { revalidatePath } from 'next/cache';

import { adminPost, adminPatch, AdminApiError } from '@/lib/admin';
import { getSessionToken } from '@/lib/admin-session';

/**
 * کنش‌هایِ دسته‌بندی — سمتِ سرور.
 *
 * دو نکته:
 *   الف) درختِ عمومی را «فقط-خواندنی» و با نهان‌سازی می‌خوانیم: منو در هر
 *       صفحه هست، پس اگر برایِ هر بازدید به کارساز سر بزند، همان چیزی است
 *       که در بارِ واقعی فروشگاه را زمین می‌اندازد.
 *   ب) هر تغییر در پنل، منو را باطل می‌کند — چون منو در هدرِ همه‌یِ
 *       صفحات است، باید کلِ درخت باطل شود نه یک صفحه.
 */

export type ActionResult<T> = { ok: true; data: T } | { ok: false; message: string };

export interface Category {
  id: string;
  key: string;
  name: string;
  slug: string;
  parentId: string | null;
  depth: number;
  path: string;
  sortOrder: number;
  isActive: boolean;
  description: string | null;
  imageUrl: string | null;
  ownCount: number;
  totalCount: number;
}

export interface CategoryNode extends Category {
  children: CategoryNode[];
}

const ORIGIN = process.env.API_BASE ?? 'http://127.0.0.1:3000';

function messageOf(error: unknown): string {
  if (error instanceof AdminApiError) return error.message;
  if (error instanceof Error && error.message) return error.message;
  return 'ارتباط با سامانه برقرار نشد؛ دوباره تلاش کنید.';
}

/**
 * درخت برایِ منو.
 *
 * اگر کارساز در دسترس نباشد، تهی برمی‌گردانیم: منویِ بی‌دسته، صفحه را
 * نمی‌شکند — خریدار هنوز جستجو و برندها را دارد.
 */
export async function loadCategoryTree(): Promise<CategoryNode[]> {
  try {
    const res = await fetch(`${ORIGIN}/categories`, { next: { revalidate: 120 } });
    if (!res.ok) return [];
    const data = (await res.json()) as { items?: CategoryNode[] };
    return data.items ?? [];
  } catch {
    return [];
  }
}

/** یک دسته با نیاکان، فرزندان و کالاهایش */
export async function loadCategoryDetail(slug: string): Promise<{
  category: Category | null;
  ancestors: Category[];
  children: Category[];
  /** همان قالبِ «خلاصه‌یِ کالا» یِ کارساز (ProductSummary) — با میانگینِ امتیاز */
  products: Array<{
    id: string;
    title: string;
    slug: string;
    brand: string | null;
    priceRial: string;
    price: string;
    imageUrl?: string | null;
    imageCardUrl?: string | null;
    imagePlaceholder?: string | null;
    variantId?: string | null;
    ratingAverage?: number;
    ratingCount?: number;
  }>;
  total: number;
}> {
  const empty = { category: null, ancestors: [], children: [], products: [], total: 0 };
  try {
    const res = await fetch(`${ORIGIN}/categories/${encodeURIComponent(slug)}?limit=24`, {
      next: { revalidate: 60 },
    });
    if (!res.ok) return empty;
    const data = (await res.json()) as never;
    return data;
  } catch {
    return empty;
  }
}

/* ────────────────────────────────────────────────────────────────────────────
 * پنل
 * ────────────────────────────────────────────────────────────────────────── */

export async function loadAllCategories(): Promise<ActionResult<Category[]>> {
  try {
    const token = await getSessionToken();
    if (!token) return { ok: false, message: 'نشست پایان یافته است؛ دوباره وارد شوید.' };
    const res = await fetch(`${ORIGIN}/admin/categories`, {
      cache: 'no-store',
      headers: { authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      const payload = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
      return { ok: false, message: payload?.error?.message ?? 'دسته‌ها بارگیری نشد.' };
    }
    const data = (await res.json()) as { items: Category[] };
    return { ok: true, data: data.items };
  } catch (error) {
    return { ok: false, message: messageOf(error) };
  }
}

/** باطل کردنِ منو — دسته‌ها در هدرِ همه‌یِ صفحات‌اند */
function publish(): void {
  revalidatePath('/', 'layout');
}

export async function createCategory(input: {
  name: string;
  parentId?: string | null;
  slug?: string;
  description?: string;
}): Promise<ActionResult<{ message: string }>> {
  try {
    const token = await getSessionToken();
    if (!token) return { ok: false, message: 'نشست پایان یافته است؛ دوباره وارد شوید.' };
    await adminPost('/admin/categories', token, {
      name: input.name,
      parentId: input.parentId ?? null,
      slug: input.slug || undefined,
      description: input.description || undefined,
    });
    publish();
    return { ok: true, data: { message: 'دسته ساخته شد.' } };
  } catch (error) {
    return { ok: false, message: messageOf(error) };
  }
}

export async function renameCategory(
  id: string,
  name: string,
): Promise<ActionResult<{ message: string }>> {
  try {
    const token = await getSessionToken();
    if (!token) return { ok: false, message: 'نشست پایان یافته است؛ دوباره وارد شوید.' };
    await adminPatch(`/admin/categories/${id}`, token, { name });
    publish();
    return { ok: true, data: { message: 'نام به‌روز شد.' } };
  } catch (error) {
    return { ok: false, message: messageOf(error) };
  }
}

export async function moveCategory(
  id: string,
  parentId: string | null,
): Promise<ActionResult<{ message: string }>> {
  try {
    const token = await getSessionToken();
    if (!token) return { ok: false, message: 'نشست پایان یافته است؛ دوباره وارد شوید.' };
    await adminPost(`/admin/categories/${id}/move`, token, { parentId });
    publish();
    return { ok: true, data: { message: 'جابه‌جا شد.' } };
  } catch (error) {
    return { ok: false, message: messageOf(error) };
  }
}

export async function toggleCategoryActive(
  id: string,
  isActive: boolean,
): Promise<ActionResult<{ message: string }>> {
  try {
    const token = await getSessionToken();
    if (!token) return { ok: false, message: 'نشست پایان یافته است؛ دوباره وارد شوید.' };
    await adminPatch(`/admin/categories/${id}`, token, { isActive });
    publish();
    return { ok: true, data: { message: isActive ? 'دسته نمایان شد.' : 'دسته پنهان شد.' } };
  } catch (error) {
    return { ok: false, message: messageOf(error) };
  }
}

export async function deleteCategory(
  id: string,
  options: { moveProductsTo?: string; moveChildrenTo?: string } = {},
): Promise<ActionResult<{ message: string }>> {
  try {
    const token = await getSessionToken();
    if (!token) return { ok: false, message: 'نشست پایان یافته است؛ دوباره وارد شوید.' };
    const query = new URLSearchParams();
    if (options.moveProductsTo) query.set('moveProductsTo', options.moveProductsTo);
    if (options.moveChildrenTo) query.set('moveChildrenTo', options.moveChildrenTo);
    const suffix = query.toString() ? `?${query.toString()}` : '';
    const res = await fetch(`${ORIGIN}/admin/categories/${id}${suffix}`, {
      method: 'DELETE',
      headers: { authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      const payload = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
      return { ok: false, message: payload?.error?.message ?? 'دسته پاک نشد.' };
    }
    publish();
    return { ok: true, data: { message: 'دسته برداشته شد.' } };
  } catch (error) {
    return { ok: false, message: messageOf(error) };
  }
}

export async function reorderCategories(
  parentId: string | null,
  ids: string[],
): Promise<ActionResult<{ message: string }>> {
  try {
    const token = await getSessionToken();
    if (!token) return { ok: false, message: 'نشست پایان یافته است؛ دوباره وارد شوید.' };
    await adminPost('/admin/categories/order', token, { parentId, ids });
    publish();
    return { ok: true, data: { message: 'ترتیب ذخیره شد.' } };
  } catch (error) {
    return { ok: false, message: messageOf(error) };
  }
}
