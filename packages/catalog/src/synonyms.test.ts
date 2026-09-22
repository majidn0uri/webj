import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { applyMigrations, createDatabase, seedCatalog, type Database } from '@set/db';
import { searchKey } from '@set/shared-kernel';

import {
  CatalogService,
  deleteSynonym,
  getSynonym,
  listSynonyms,
  setSynonymActive,
  upsertSynonym,
  zeroResultSuggestions,
} from './index.js';

/**
 * فرهنگِ مترادف‌ها: نوشتن از پنل، و اثرِ همان نوشتن رویِ جستجو.
 *
 * چرا این آزمون‌ها «رفتاری‌اند» و نه فقط «CRUD»؟ چون جدول از سه نوبت پیش بود و
 * موتورِ جستجو هم از همان اول می‌خواندش — چیزی که نبود، این بود که نوشته
 * شود. پس چیزی که باید ثابت شود دو تاست: (۱) کلیدها دقیقاً همان‌جوری ساخته
 * می‌شوند که موتورِ جستجو می‌بیند، وگرنه داده هست و رفتار نیست؛ (۲) هر
 * نوشتن، کش‌هایِ میانی را بی‌اعتبار می‌کند، وگرنه فروشنده چیزی را عوض
 * می‌کند و تا عمرِ کش هیچ اتفاقی نمی‌افتد — که دقیقاً همان «سیستم کار نکرد» است.
 */

let db: Database;
let catalog: CatalogService;

beforeEach(async () => {
  db = createDatabase('memory://');
  await applyMigrations(db);
  await seedCatalog(db);
  catalog = new CatalogService(db);
}, 240_000);

afterEach(async () => db.close());

/**
 * یک کالایِ ساخگی با دو واژهٔ بی‌معنی: «زربوف» در عنوانِ کالا هست و «زلبلوف»
 * هیچ‌جا نیست. چرا واژه‌هایِ ساختگی؟ چون فرهنگِ مترادفِ داخلیِ موتورِ جستجو
 * پر ازِ جفت‌هایِ واقعی است («شارجر→شارژر»، «سیمی→کابل»…) و اگر با آن‌ها
 * بیازماییم، نمی‌فهمیم مترادفِ جدول اثر کرده یا همان فرهنگِ داخلی. با
 * زربوف/زلبلوف هر تغییری که ببینیم کارِ همین جدول است.
 */
async function zerbofProduct(): Promise<void> {
  const created = await catalog.createProduct({
    typeKey: 'cable',
    title: 'کابلِ زربوف ویژه',
    variants: [{ sku: `SYN-${Math.random().toString(36).slice(2, 8)}`, priceRial: 20_000n }],
  });
  await db.query(`UPDATE products SET status = 'active' WHERE id = $1`, [created.id]);
}

describe('نرمال‌سازیِ کلیدها', () => {
  it('همزادِ پایگاه است — `searchKey()` در JS و `setshop_search_key()` در SQL یکی‌اند', async () => {
    const tricky = [
      'شارژر',
      'كابل', // ك عربی
      'موبايل', // ي عربی
      'آی-فون',
      'A1-B2',
      '  کابل   تایپ‌سی  ',
      'کابلـ', // کشیده
      'مؤسف',
      'ئینه',
      'هاتف١٢',
      'گلس ۹D',
      'Q&Go',
    ];
    const { rows } = await db.query<{ term: string; inSql: string }>(
      `SELECT t AS term, setshop_search_key(t) AS "inSql" FROM unnest($1::text[]) AS t`,
      [tricky],
    );
    expect(rows).toHaveLength(tricky.length);
    for (const row of rows) {
      expect({ term: row.term, key: row.inSql }).toEqual({ term: row.term, key: searchKey(row.term) });
    }
  });

  it('«واژه‌ای که از نگاهِ سامانه با خودش یکی است» ثبت نمی‌شود', async () => {
    // ك عربی و ک فارسی پس ازِ یکسان‌سازی یک کلیدند؛ مترادفِ این دو، هیچ کاری
    // نمی‌کند و فقط فهرست را شلوغ می‌کند — پس رد می‌شود.
    await expect(upsertSynonym(db, { term: 'كابل', canonical: 'کابل' })).rejects.toMatchObject({
      key: 'VALIDATION',
    });
    await expect(upsertSynonym(db, { term: 'شارژر', canonical: 'شارژر' })).rejects.toMatchObject({
      key: 'VALIDATION',
    });
    await expect(upsertSynonym(db, { term: '   ', canonical: 'شارژر' })).rejects.toMatchObject({
      key: 'VALIDATION',
    });
    const list = await listSynonyms(db);
    expect(list.rows.some((r) => r.termKey === r.canonicalKey)).toBe(false);
  });
});

describe('نوشتن، و بی‌اعتبارکردنِ کش‌ها', () => {
  it('افزودن، کلیدهایِ نرمال را هم می‌سازد و دوباره‌کاری نمی‌کند', async () => {
    const first = await upsertSynonym(db, { term: 'موبايل', canonical: 'گوشی' });
    expect(first.termKey).toBe(searchKey('موبايل'));
    expect(first.canonicalKey).toBe(searchKey('گوشی'));
    expect(first.isActive).toBe(true);

    const again = await upsertSynonym(db, { term: 'موبايل ', canonical: ' گوشی' });
    expect(again.id).toBe(first.id); // سطرِ دوم ساخته نشد
    const list = await listSynonyms(db, { q: 'موبایل' });
    expect(list.rows.filter((r) => r.termKey === first.termKey)).toHaveLength(1);
  });

  it('مترادفِ تازه **همان لحظه** در جستجو اثر می‌کند (کشِ سرویس سرِ راه نمی‌ایستد)', async () => {
    await zerbofProduct();

    const cold = await catalog.search({ query: 'زلبلوف', log: false });
    expect(cold.total).toBe(0);
    expect(cold.cached).toBe(false);

    // یک جستجوی تکراری باید از کش بیاید — و همین شرطِ تست است، چون اگر کش
    // کار نکند، «بعد ازِ افزودنِ مترادف نتیجه آمد» چیزی را ثابت نمی‌کند.
    const repeated = await catalog.search({ query: 'زلبلوف', log: false });
    expect(repeated.cached).toBe(true);
    expect(repeated.total).toBe(0);

    await upsertSynonym(db, { term: 'زلبلوف', canonical: 'زربوف' });

    const after = await catalog.search({ query: 'زلبلوف', log: false });
    expect(after.cached).toBe(false); // نوشتن، کشِ پاسخ را ریخت
    expect(after.total).toBe(1);
    expect(after.applied.length).toBeGreaterThan(0); // «این مترادف اعمال شد» هم گفته می‌شود
  });

  it('عبارتِ **چندواژه** هم اثر می‌کند (جایگزینی پیش از شکستن به واژه)', async () => {
    // دو واژهٔ ساختگی که **هیچ‌کدام** در کاتالوگ نیستند («زبلوف»، «قلقوف») —
    // چرا هر دو بیگانه؟ چون اگر یکی‌شان کالایی را پیدا کند، موتورِ جستجو
    // جستجو را «شُل» می‌کند (relaxed: میانِ واژه‌ها «یا») و نتیجه صفر نمی‌شود؛
    // آزمونِ ما باید اول «هیچ» را ببیند تا بفهمیم مترادف کلِ عبارت را عوض کرده.
    // تا پیش از این فرهنگِ پنل تنها واژه‌به‌واژه اعمال می‌شد و سطرِ چندواژه،
    // بی‌صدا بی‌اثر می‌ماند.
    await zerbofProduct();
    const cold = await catalog.search({ query: 'زبلوف قلقوف', log: false });
    expect(cold.total).toBe(0);

    await upsertSynonym(db, { term: 'زبلوف قلقوف', canonical: 'کابل زربوف' });

    const warm = await catalog.search({ query: 'زبلوف قلقوف', log: false });
    expect(warm.total).toBe(1);
    expect(warm.applied.some((a) => a.input.includes(' '))).toBe(true);
  });

  it('خاموش‌کردن اثر را برمی‌دارد و حذف هم همین‌طور', async () => {
    await zerbofProduct();
    const row = await upsertSynonym(db, { term: 'زلبلوف', canonical: 'زربوف' });
    expect((await catalog.search({ query: 'زلبلوف', log: false })).total).toBe(1);

    const off = await setSynonymActive(db, row.id, false);
    expect(off?.isActive).toBe(false);
    expect((await catalog.search({ query: 'زلبلوف', log: false })).total).toBe(0);

    await upsertSynonym(db, { term: 'زلبلوف', canonical: 'زربوف', isActive: true });
    expect((await catalog.search({ query: 'زلبلوف', log: false })).total).toBe(1);

    expect(await deleteSynonym(db, row.id)).toBe(true);
    expect(await deleteSynonym(db, row.id)).toBe(false); // ردیفی که نیست، دوباره حذف نمی‌شود
  });

  it('`getSynonym` ردیف را با کلیدها می‌دهد و ردیفِ نبود، `null` است', async () => {
    const row = await upsertSynonym(db, { term: 'پاور بانك', canonical: 'پاوربانک' });
    const found = await getSynonym(db, row.id);
    expect(found?.termKey).toBe(searchKey('پاور بانك'));
    expect(await getSynonym(db, '00000000-0000-0000-0000-000000000000')).toBeNull();
  });
});

describe('فهرست و «چی کم داریم؟»', () => {
  it('جستجو در فهرست، هر دو طرف و هر دو شکلِ نوشتن را می‌بیند', async () => {
    await upsertSynonym(db, { term: 'كابل', canonical: 'سیم' });
    await upsertSynonym(db, { term: 'هندزفری', canonical: 'هدفون' });

    expect((await listSynonyms(db, { q: 'کابل' })).rows.map((r) => r.canonical)).toContain('سیم');
    expect((await listSynonyms(db, { q: 'سیم' })).rows.map((r) => r.term)).toContain('كابل');
    expect((await listSynonyms(db, { q: 'هیچی‌چنین' })).rows).toHaveLength(0);
    expect((await listSynonyms(db)).total).toBeGreaterThanOrEqual(2);
  });

  it('«فقط خاموش‌ها» فیلتر می‌کند (خانه‌ای که یک روزِ شلوغ لازم می‌شود)', async () => {
    const a = await upsertSynonym(db, { term: 'پاوربانك', canonical: 'شارژر' });
    await setSynonymActive(db, a.id, false);
    const inactive = await listSynonyms(db, { onlyInactive: true });
    expect(inactive.rows.map((r) => r.id)).toContain(a.id);
    expect(inactive.rows.every((r) => !r.isActive)).toBe(true);
  });

  it('پیشنهادها فقط «صفر نتیجه»ها را می‌شمارند و مترادفِ داشته را علامت می‌زنند', async () => {
    await catalog.logSearch({ raw: 'دیکشنری الکترونیک', normalized: 'دیکشنری الکترونیک', results: 0, channel: 'web', deviceModelId: null });
    await catalog.logSearch({ raw: 'دیکشنری الکترونيک', normalized: 'دیکشنری الکترونیک', results: 0, channel: 'web', deviceModelId: null });
    await catalog.logSearch({ raw: 'شارژر', normalized: 'شارژر', results: 7, channel: 'web', deviceModelId: null });

    const found = await zeroResultSuggestions(db, { days: 30, limit: 10 });
    expect(found.some((s) => s.searches === 0)).toBe(false);
    const row = found.find((s) => s.normalized === 'دیکشنری الکترونیک');
    expect(row?.searches).toBe(2);
    expect(row?.mapped).toBe(false);

    await upsertSynonym(db, { term: 'دیکشنری الکترونيک', canonical: 'دیکشنری' });
    const after = await zeroResultSuggestions(db, { days: 30, limit: 10 });
    expect(after.find((s) => s.normalized === 'دیکشنری الکترونیک')?.mapped).toBe(true);
  });

  it('عمرِ پرس‌وجو (days) سطرهایِ کهنه را بیرون می‌گذارد', async () => {
    await catalog.logSearch({ raw: 'قدیمی', normalized: 'قدیمی', results: 0, channel: 'web', deviceModelId: null });
    await db.query(`UPDATE search_queries SET created_at = now() - interval '90 days'`);
    const recent = await zeroResultSuggestions(db, { days: 30, limit: 10 });
    expect(recent.some((s) => s.normalized === 'قدیمی')).toBe(false);
    const wide = await zeroResultSuggestions(db, { days: 120, limit: 10 });
    expect(wide.some((s) => s.normalized === 'قدیمی')).toBe(true);
  });
});

describe('آنچه کشِ پاسخِ جستجو مجاز نیست', () => {
  it('فیلترها در کلید فرق می‌کنند، پس «کشِ بی‌فیلتر» به نتایجِ فیلتردار نمی‌چسبد', async () => {
    const plain = await catalog.search({ query: 'کابل', log: false });
    const discounted = await catalog.search({ query: 'کابل', onlyDiscounted: true, log: false });
    expect(discounted.cached).toBe(false);
    expect((await catalog.search({ query: 'کابل', log: false })).cached).toBe(true);
    expect((await catalog.search({ query: 'کابل', onlyDiscounted: true, log: false })).cached).toBe(true);
    expect(plain.total).toBeGreaterThanOrEqual(0);
  });

  it('صفحه‌بندی کلید را عوض می‌کند — وگرنه برگهٔ دوم، برگهٔ اول را نشان می‌دهد', async () => {
    await catalog.search({ query: 'کابل', limit: 4, offset: 0, log: false });
    const second = await catalog.search({ query: 'کابل', limit: 4, offset: 4, log: false });
    expect(second.cached).toBe(false);
    expect((await catalog.search({ query: 'کابل', limit: 4, offset: 0, log: false })).cached).toBe(true);
  });
});
