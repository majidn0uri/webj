'use server';

import { revalidatePath } from 'next/cache';

import { adminDelete, adminGet, adminPatch, adminPost, AdminApiError } from '@/lib/admin';
import { getSessionToken } from '@/lib/admin-session';

/**
 * کنش‌هایِ «جستجو و مترادف‌ها» — سمتِ سرور.
 *
 * چرا سمتِ سرور و نه fetchِ مستقیم از مرورگر؟ چون توکنِ نشست در کوکیِ HttpOnly
 * است و هرگز به جاوااسکریپتِ صفحه داده نمی‌شود؛ پس نوشتنِ مترادف هم — مثلِ
 * بقیهٔ کارهایِ پنل — از کنشِ سروری می‌گذرد و دسترسی در همان‌جا سنجیده می‌شود.
 *
 * یک چیز که در این مسیر عمدی است: پس از هر نوشتن، `revalidatePath('/search')`
 * می‌زنیم. کشِ پاسخِ صفحهٔ نتایج ۱۵ ثانیه عمر دارد؛ اگر مترادفی را عوض کنی و
 * همان نتیجهٔ کهنه را ببینی، داری همین الان یاد می‌گیری که به هیچ عددی در این
 * پنل اعتماد نکنی. پس «تازه‌شدنِ همان‌جا» بخشی از کار است، نه جزئیاتِ زیبایی.
 */

export type ActionResult<T> = { ok: true; data: T } | { ok: false; message: string };

export interface Synonym {
  id: string;
  term: string;
  termKey: string;
  canonical: string;
  canonicalKey: string;
  isActive: boolean;
  createdAt: string;
}

export interface SynonymSuggestion {
  normalized: string;
  sample: string;
  searches: number;
  lastSeenAt: string;
  mapped: boolean;
}

export interface SynonymList {
  rows: Synonym[];
  total: number;
}

async function requireToken(): Promise<string> {
  const token = await getSessionToken();
  if (!token) throw new Error('نشست پایان یافته است؛ دوباره وارد شوید.');
  return token;
}

function messageOf(error: unknown): string {
  if (error instanceof AdminApiError) return error.message;
  if (error instanceof Error && error.message) return error.message;
  return 'ارتباط با سامانه برقرار نشد؛ دوباره تلاش کنید.';
}

function touch(): void {
  // صفحهٔ پنل و خودِ نتایجِ فروشگاه — هر دو باید تازه شوند
  revalidatePath('/admin/search');
  revalidatePath('/search');
}

export async function loadSynonyms(
  q = '',
  onlyInactive = false,
): Promise<ActionResult<SynonymList>> {
  try {
    const token = await requireToken();
    const params = new URLSearchParams();
    if (q.trim()) params.set('q', q.trim());
    if (onlyInactive) params.set('onlyInactive', '1');
    params.set('limit', '100');
    const data = await adminGet<SynonymList>(`/admin/catalog/synonyms?${params.toString()}`, token);
    return { ok: true, data };
  } catch (error) {
    return { ok: false, message: messageOf(error) };
  }
}

/** «مردم چه جستجو کردند و چیزی پیدا نشد» — سوختِ همین صفحه */
export async function loadSuggestions(days = 30): Promise<ActionResult<{ days: number; rows: SynonymSuggestion[] }>> {
  try {
    const token = await requireToken();
    const data = await adminGet<{ days: number; rows: SynonymSuggestion[] }>(
      `/admin/catalog/synonyms/suggestions?days=${days}&limit=12`,
      token,
    );
    return { ok: true, data };
  } catch (error) {
    return { ok: false, message: messageOf(error) };
  }
}

export async function saveSynonym(input: {
  term: string;
  canonical: string;
  isActive?: boolean;
}): Promise<ActionResult<Synonym>> {
  try {
    const token = await requireToken();
    const data = await adminPost<Synonym>('/admin/catalog/synonyms', token, input);
    touch();
    return { ok: true, data };
  } catch (error) {
    return { ok: false, message: messageOf(error) };
  }
}

export async function toggleSynonym(
  id: string,
  isActive: boolean,
  current: { term: string; canonical: string },
): Promise<ActionResult<Synonym>> {
  try {
    const token = await requireToken();
    // واژه‌ها هم فرستاده می‌شوند تا مسیرِ ویرایشِ همه‌چیز یک‌شکل باشد
    const data = await adminPatch<Synonym>(`/admin/catalog/synonyms/${id}`, token, {
      term: current.term,
      canonical: current.canonical,
      isActive,
    });
    touch();
    return { ok: true, data };
  } catch (error) {
    return { ok: false, message: messageOf(error) };
  }
}

export async function deleteSynonymAction(id: string): Promise<ActionResult<{ removed: boolean }>> {
  try {
    const token = await requireToken();
    const data = await adminDelete<{ removed: boolean }>(`/admin/catalog/synonyms/${id}`, token);
    touch();
    return { ok: true, data };
  } catch (error) {
    return { ok: false, message: messageOf(error) };
  }
}

/** کشِ پاسخِ پرسش‌هایِ جستجو را در همین فرآیند خالی می‌کند */
export async function clearSearchCache(): Promise<ActionResult<{ cleared: boolean }>> {
  try {
    const token = await requireToken();
    const data = await adminPost<{ cleared: boolean }>('/admin/catalog/search-cache/clear', token, {});
    touch();
    return { ok: true, data };
  } catch (error) {
    return { ok: false, message: messageOf(error) };
  }
}
