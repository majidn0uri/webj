import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { applyMigrations, createDatabase, type Database } from '@set/db';

import { BannerService } from './banners.js';

/**
 * آزمونِ بنرها.
 *
 * آنچه اینجا می‌سنجد «ذخیره و بازیابی» نیست — آن را هر کدی بلد است. موضوع،
 * **قاعده‌یِ نمایش** است: چه چیزی، کی، روی سایت دیده می‌شود. اشتباه در این
 * قاعده یعنی یا کمپینِ فروشنده اجرا نمی‌شود (زیانِ مالی) یا بنرِ منقضی روی
 * سایت می‌ماند (تعهدِ حقوقی به مشتری).
 */

const NOW = new Date('2026-09-17T12:00:00Z');
const hours = (n: number) => new Date(NOW.getTime() + n * 3_600_000);

let db: Database;
let banners: BannerService;

/**
 * یک پایگاه برایِ همه‌یِ آزمون‌ها.
 *
 * چرا؟ هر نمونه‌یِ پایگاهِ درون‌حافظه همه‌یِ مهاجرت‌ها را در خود نگه می‌دارد؛
 * با ۱۲ آزمون یعنی ۱۲ پایگاهِ کامل، و در این محیطِ ۲ گیگابایتی کارگرِ آزمون در
 * میانه کشته می‌شد — چیزی که به‌اشتباه «تستِ ناپایدار» دیده می‌شود. پس یک بار
 * می‌سازیم و پس از هر آزمون بنرها را پاک می‌کنیم.
 */
beforeAll(async () => {
  db = createDatabase('memory://');
  await applyMigrations(db);
  banners = new BannerService(db);
});

afterAll(async () => {
  await db.close();
});

/** بازگشت به نقطه‌یِ آغاز — هر آزمون از فهرستی تازه آغاز می‌کند */
afterEach(async () => {
  await db.query(`DELETE FROM store_banners`);
});

describe('نوارِ اعلان', () => {
  it('بنرِ بی‌بازه همیشه دیده می‌شود', async () => {
    await banners.create({ kind: 'announcement', title: 'ارسال رایگان بالای ۵۰۰ هزار تومان' });
    const shown = await banners.visible('announcement', NOW);
    expect(shown).toHaveLength(1);
    expect(shown[0]!.title).toContain('ارسال رایگان');
  });

  it('بنری که هنوز آغاز نشده، دیده نمی‌شود', async () => {
    await banners.create({ kind: 'announcement', title: 'جمعه‌یِ سیاه', startsAt: hours(2) });
    expect(await banners.visible('announcement', NOW)).toHaveLength(0);
    expect(await banners.visible('announcement', hours(3))).toHaveLength(1);
  });

  it('بنری که پایان یافته، دیده نمی‌شود — اما روزِ پایان هنوز هست', async () => {
    await banners.create({ kind: 'announcement', title: 'تا پایانِ شهریور', endsAt: hours(5) });
    expect(await banners.visible('announcement', hours(5))).toHaveLength(1);
    expect(await banners.visible('announcement', hours(6))).toHaveLength(0);
  });

  it('بنرِ خاموش هرگز دیده نمی‌شود، حتی در بازه', async () => {
    await banners.create({ kind: 'announcement', title: 'پیش‌نویس', isActive: false });
    expect(await banners.visible('announcement', NOW)).toHaveLength(0);
    // اما در پنل دیده می‌شود تا فروشنده بتواند ویرایشش کند
    expect(await banners.listByKind('announcement')).toHaveLength(1);
  });

  it('چند پیام، به ترتیبِ دستی', async () => {
    await banners.create({ kind: 'announcement', title: 'دوم', sortOrder: 2 });
    await banners.create({ kind: 'announcement', title: 'نخست', sortOrder: 1 });
    const all = await banners.visible('announcement', NOW);
    expect(all.map((b) => b.title)).toEqual(['نخست', 'دوم']);
  });
});

describe('بنرِ تصویری', () => {
  it('بنرِ اصلی بی‌تصویر پذیرفته نمی‌شود', async () => {
    await expect(banners.create({ kind: 'hero', title: 'بی‌تصویر' })).rejects.toThrow(/تصویر/);
    await expect(banners.create({ kind: 'middle', title: 'بی‌تصویر' })).rejects.toThrow(/تصویر/);
  });

  it('نوارِ اعلان متنی است و نیازی به تصویر ندارد', async () => {
    const bar = await banners.create({ kind: 'announcement', title: 'خوش آمدید' });
    expect(bar.imageUrl).toBeNull();
  });

  it('جاهایِ گوناگون از هم جدا هستند', async () => {
    await banners.create({ kind: 'hero', title: 'اصلی', imageUrl: '/media/a-full.jpg' });
    await banners.create({ kind: 'middle', title: 'میانی', imageUrl: '/media/b-full.jpg' });
    expect(await banners.visible('hero', NOW)).toHaveLength(1);
    expect(await banners.visible('middle', NOW)).toHaveLength(1);
    expect(await banners.visible('announcement', NOW)).toHaveLength(0);
  });

  it('برداشتنِ تصویر از بنرِ اصلی هنگامِ ویرایش خطا می‌دهد', async () => {
    const hero = await banners.create({ kind: 'hero', title: 'کمپین', imageUrl: '/media/a-full.jpg' });
    await expect(banners.update(hero.id, { imageUrl: null })).rejects.toThrow(/تصویر/);
  });
});

describe('پنجره‌یِ نامعتبر', () => {
  it('پایان پیش از آغاز، از سویِ پایگاه رد می‌شود', async () => {
    await expect(
      banners.create({ kind: 'announcement', title: 'وارونه', startsAt: hours(5), endsAt: hours(1) }),
    ).rejects.toThrow();
  });
});

describe('گردشِ کارِ فروشنده', () => {
  it('ساخت ← ویرایش ← بازچینی ← برداشتن', async () => {
    const a = await banners.create({ kind: 'announcement', title: 'الف', sortOrder: 1 });
    const b = await banners.create({ kind: 'announcement', title: 'ب', sortOrder: 2 });

    const edited = await banners.update(a.id, { title: 'الفِ ویراسته', isActive: false });
    expect(edited?.title).toBe('الفِ ویراسته');
    expect(await banners.visible('announcement', NOW)).toHaveLength(1);

    await banners.reorder([b.id, a.id]);
    const all = await banners.listByKind('announcement');
    expect(all.map((x) => x.title)).toEqual(['ب', 'الفِ ویراسته']);

    expect(await banners.remove(b.id)).toBe(true);
    expect(await banners.remove(b.id)).toBe(false); // دوباره‌برداشتن، «نه» است نه خطا
    expect(await banners.get(b.id)).toBeNull();
  });

  it('بنری که نیست، ویرایش نمی‌شود — و این خطا نیست', async () => {
    expect(await banners.update('00000000-0000-0000-0000-000000000000', { title: '…' })).toBeNull();
  });
});
