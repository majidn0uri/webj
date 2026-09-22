import { mkdir, rm, utimes, writeFile } from 'node:fs/promises';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { applyMigrations, createDatabase, type Database } from '@set/db';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  MEDIA_POLICY_DEFAULTS,
  MEDIA_POLICY_KEYS,
  formatMediaBytes,
  mediaHygiene,
  readBool,
  readMediaPolicy,
} from './media-hygiene.js';
import { publicUrl } from '@set/media';

/**
 * سنجشِ سیاستِ رسانه.
 *
 * دو چیزِ متفاوت اینجا مهم است: «صفرِ مدیر یعنی صفر» (نه پیش‌فرض، نه «همه‌چیز
 * را بریز دور») و «هر دورِ کارگر نباید ردِّ عملیات بنویسد». و چون پایگاهِ
 * آزمون PGlite است، دیسک هم واقعی است: فایل‌ها واقعاً نوشته و واقعاً پاک
 * می‌شوند — آزمونِ «فایل ماند/نماند» با mock معنا ندارد.
 */

const DAY = 86_400_000;
let db: Database;
let mediaDir: string;

async function putFile(daysAgo: number, index = 0): Promise<string> {
  const hash = index.toString(16).padStart(64, '0');
  const dir = path.join(mediaDir, hash.slice(0, 2));
  await mkdir(dir, { recursive: true });
  const file = path.join(dir, `${hash}-full.jpg`);
  await writeFile(file, Buffer.alloc(2048, 3));
  if (daysAgo > 0) {
    const when = new Date(Date.now() - daysAgo * DAY);
    await utimes(file, when, when);
  }
  return publicUrl(path.join(hash.slice(0, 2), `${hash}-full.jpg`));
}

/** تنظیم را بی‌ممیزی می‌نویسیم (setSetting ردِّ عملیات می‌نویسد و آزمونِ «بی‌ممیزی» را خراب می‌کند) */
async function setRaw(key: string, value: string): Promise<void> {
  await db.query(
    `INSERT INTO store_settings (key, value, updated_at) VALUES ($1,$2,now())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    [key, value],
  );
}

async function cacheRow(): Promise<string | undefined> {
  const { rows } = await db.query<{ value: string }>(
    `SELECT value FROM store_settings WHERE key = $1`,
    [MEDIA_POLICY_KEYS.lastScan],
  );
  return rows[0]?.value;
}

async function countFiles(): Promise<number> {
  const { readdir } = await import('node:fs/promises');
  let n = 0;
  for (const entry of await readdir(mediaDir, { withFileTypes: true })) {
    if (entry.isDirectory()) n += (await readdir(path.join(mediaDir, entry.name))).length;
    else n += 1;
  }
  return n;
}

beforeAll(async () => {
  mediaDir = await mkdtemp(path.join(tmpdir(), 'set-media-policy-'));
  process.env.MEDIA_DIR = mediaDir;
});

beforeEach(async () => {
  db = createDatabase('memory://');
  await applyMigrations(db);
  for (const key of Object.values(MEDIA_POLICY_KEYS)) {
    await db.query(`DELETE FROM store_settings WHERE key = $1`, [key]);
  }
  await db.query(`DELETE FROM product_images`);
  const { readdir } = await import('node:fs/promises');
  for (const entry of await readdir(mediaDir)) {
    await rm(path.join(mediaDir, entry), { recursive: true, force: true });
  }
});

afterEach(async () => {
  await db.close();
});

describe('خواندنِ سیاست از پنل', () => {
  it('بی‌هیچ کلیدی، پیش‌فرض‌ها (و پیش‌فرضِ خودکاری: خاموش)', async () => {
    const policy = await readMediaPolicy(db);
    expect(policy).toEqual({
      graceDays: MEDIA_POLICY_DEFAULTS.graceDays,
      autopurge: false,
      scanIntervalMinutes: MEDIA_POLICY_DEFAULTS.scanIntervalMinutes,
    });
  });

  it('«۰» صریح یعنی صفر — نه پیش‌فرض، نه «همه‌چیزِ کهنه را بریز دور»', async () => {
    await setRaw(MEDIA_POLICY_KEYS.graceDays, '۰');
    expect((await readMediaPolicy(db)).graceDays).toBe(0);
  });

  it('عددِ فارسی و فاصله‌دار خوانده می‌شود؛ رشتهٔ خالی و بی‌اعتبار به پیش‌فرض برمی‌گردد', async () => {
    await setRaw(MEDIA_POLICY_KEYS.graceDays, ' ۴۵ ');
    expect((await readMediaPolicy(db)).graceDays).toBe(45);
    await setRaw(MEDIA_POLICY_KEYS.graceDays, '');
    expect((await readMediaPolicy(db)).graceDays).toBe(MEDIA_POLICY_DEFAULTS.graceDays);
    await setRaw(MEDIA_POLICY_KEYS.graceDays, 'هفته‌ای');
    expect((await readMediaPolicy(db)).graceDays).toBe(MEDIA_POLICY_DEFAULTS.graceDays);
    await setRaw(MEDIA_POLICY_KEYS.graceDays, '-3');
    expect((await readMediaPolicy(db)).graceDays).toBe(MEDIA_POLICY_DEFAULTS.graceDays);
  });

  it('readBool هر سه شکلی که در عمل می‌بینیم را می‌فهمد', () => {
    expect([readBool('true', false), readBool('1', false), readBool('۱', false), readBool('بله', false)]).toEqual([
      true,
      true,
      true,
      true,
    ]);
    expect([readBool('false', true), readBool('0', true), readBool('خیر', true), readBool('', true)]).toEqual([
      false,
      false,
      false,
      true,
    ]);
    expect(readBool('شاید', false)).toBe(false);
  });

  it('فاصلهٔ پویشِ صفر/منفی، مهار می‌شود (نه پویشِ بی‌مقطع در هر درخواست)', async () => {
    await setRaw(MEDIA_POLICY_KEYS.scanIntervalMinutes, '0');
    expect((await readMediaPolicy(db)).scanIntervalMinutes).toBe(1);
  });
});

describe('مهلتِ صفر', () => {
  it('پوشه پویش هم نمی‌شود و کشی نوشته نمی‌شود', async () => {
    await putFile(400);
    await setRaw(MEDIA_POLICY_KEYS.graceDays, '0');
    const report = await mediaHygiene(db, { mode: 'run' });
    expect(report.files).toBe(0);
    expect(report.orphans).toBe(0);
    expect(report.removed).toBe(0);
    expect(report.notes.join(' ')).toContain('هرگز پاک نشود');
    expect(await cacheRow()).toBeUndefined();
    expect(await countFiles()).toBe(1); // فایلِ بی‌صاحب هم جایش ماند
  });
});

describe('پویش، کش، و پیش‌نمایش', () => {
  it('گزارشِ نخست پویش می‌کند و کش می‌گذارد؛ گزارشِ دوم از کش می‌خواند', async () => {
    await putFile(400);
    const first = await mediaHygiene(db, { mode: 'report' });
    expect(first.cached).toBe(false);
    expect(first.orphans).toBe(1);
    expect(first.orphanBytes).toBeGreaterThan(0);
    expect(await cacheRow()).toBeTruthy();

    await putFile(400, 1); // یک بی‌صاحبِ تازه رویِ دیسک
    const second = await mediaHygiene(db, { mode: 'report' });
    expect(second.cached).toBe(true);
    expect(second.orphans).toBe(1); // هنوز عددِ کش — پویشِ دوباره نکردیم

    const fresh = await mediaHygiene(db, { mode: 'report', fresh: true });
    expect(fresh.cached).toBe(false);
    expect(fresh.orphans).toBe(2);
  });

  it('اجرا فقط بی‌صاحب‌هایِ کهنه را می‌بَرَد و نتیجه را به کش می‌نویسد', async () => {
    const gone = await putFile(400);
    const keptYoung = await putFile(0, 1);
    const report = await mediaHygiene(db, { mode: 'run' });
    expect(report.ran).toBe(true);
    expect(report.removed).toBe(1);
    expect(report.removedBytes).toBeGreaterThan(0);
    expect(report.notes.join(' ')).toContain('پاک شد');

    const { access } = await import('node:fs/promises');
    await expect(access(path.join(mediaDir, gone.replace('/media/', '')))).rejects.toBeTruthy();
    await expect(access(path.join(mediaDir, keptYoung.replace('/media/', '')))).resolves.toBeUndefined();

    const cached = JSON.parse((await cacheRow())!) as { orphans: number };
    expect(cached.orphans).toBe(0);
  });

  it('کشِ ردِّ عملیات نمی‌نویسد (وگرنه هر دورِ کارگر یک سطرِ ممیزی است)', async () => {
    await putFile(400);
    await mediaHygiene(db, { mode: 'run' });
    await mediaHygiene(db, { mode: 'report', fresh: true });
    const { rows } = await db.query<{ n: string }>(`SELECT COUNT(*)::text AS n FROM audit_logs`);
    expect(rows[0]!.n).toBe('0');
  });

  it('تصویرِ شکسته در یادداشت‌ها می‌آید، با رقمِ فارسی', async () => {
    const type = await db.query<{ id: string }>(
      `INSERT INTO product_types (key, name) VALUES ('media-test-type', 'تستِ رسانه')
       ON CONFLICT (key) DO UPDATE SET name = EXCLUDED.name RETURNING id`,
    );
    const product = await db.query<{ id: string }>(
      `INSERT INTO products (type_id, title, slug, status) VALUES ($1, 'قابِ آزمون', 'media-hygiene-case', 'active') RETURNING id`,
      [type.rows[0]!.id],
    );
    await db.query(`INSERT INTO product_images (product_id, url, role) VALUES ($1,$2,'main')`, [
      product.rows[0]!.id,
      `/media/ab/${'7'.repeat(64)}-full.jpg`,
    ]);
    const report = await mediaHygiene(db, { mode: 'report', fresh: true });
    expect(report.missingTotal).toBe(1);
    expect(report.notes.join(' ')).toMatch(/رویِ دیسک نیست/);
    expect(report.notes.join(' ')).not.toMatch(/[0-9]/);
  });

  it('چک‌برِ «غیرعادی است» با جملهٔ فارسی توضیح می‌دهد، نه با عددِ صفرِ بی‌دلیل', async () => {
    for (let i = 0; i < 26; i++) await putFile(400, i);
    const report = await mediaHygiene(db, { mode: 'run' });
    expect(report.refuseCode).toBe('no-references');
    expect(report.removed).toBe(0);
    expect(report.notes[0]).toContain('بی‌«اجباری»');
    expect(await countFiles()).toBe(26);

    const forced = await mediaHygiene(db, { mode: 'run', force: true, fresh: true });
    expect(forced.refuseCode).toBeNull();
    expect(forced.removed).toBe(26);
    expect(await countFiles()).toBe(0);
  });

  it('خاموش‌بودنِ خودکاری در یادداشت گفته می‌شود تا «چرا خودش پاک نکرد؟» بی‌جواب نماند', async () => {
    await putFile(400);
    const report = await mediaHygiene(db, { mode: 'report', fresh: true });
    expect(report.policy.autopurge).toBe(false);
    expect(report.notes.join(' ')).toContain('خاموش');
    await setRaw(MEDIA_POLICY_KEYS.autopurge, 'true');
    expect((await mediaHygiene(db, { mode: 'report', fresh: true })).notes.join(' ')).not.toContain('خاموش');
  });
});

describe('سقفِ زمان: پیش‌نمایش نباید صفحهٔ کالا را منتظرِ دیسک بگذارد', () => {
  /**
   * رقمِ «چند فایلِ بی‌صاحب» کنارِ هر بارگذاریِ تصویر پرسیده می‌شود. اگر
   * پاسخ‌دادن به آن یعنی شمردنِ کلِ پوشه، رویِ انبارِ بزرگِ تصویر همان
   * «سنگین شدنِ سرور» می‌شود که کاربر احساس می‌کند. پس پیش‌نمایش سقفِ زمان
   * دارد — و دو چیز باید در پیِ آن درست بماند: عددِ ناقص باید رویش نوشته
   * شود، و عددِ ناقص نباید کش شود (وگرنه شش ساعت، همان کم‌گفته می‌ماند).
   */
  it('با سقفِ صفر: می‌گوید «کامل نشد» و کش نمی‌شود؛ بی‌سقف: کش می‌شود', async () => {
    for (let i = 0; i < 6; i++) await putFile(400, i);
    const partial = await mediaHygiene(db, { mode: 'report', fresh: true, budgetMs: 0 });
    expect(partial.incomplete).toBe(true);
    expect(partial.files).toBeGreaterThanOrEqual(1);
    expect(partial.files).toBeLessThan(6);
    expect(partial.notes.join(' ')).toContain('کامل نشد');
    expect(await cacheRow()).toBeUndefined();

    const full = await mediaHygiene(db, { mode: 'report', fresh: true });
    expect(full.incomplete).toBe(false);
    expect(full.files).toBe(6);
    expect(full.notes.join(' ')).not.toContain('کامل نشد');
    expect(await cacheRow()).toBeDefined();

    // کشِ تازه یعنی پرسشِ بعدی هیچ `stat`ی رویِ دیسک نمی‌زند
    const cached = await mediaHygiene(db, { mode: 'report' });
    expect(cached.cached).toBe(true);
    expect(cached.files).toBe(6);
  });

  it('کشِ بی‌فیلدِ `incomplete` (نسخهٔ پیشین) «کامل» خوانده می‌شود، نه «نیمه»', async () => {
    await putFile(400, 7);
    await setRaw(
      MEDIA_POLICY_KEYS.lastScan,
      JSON.stringify({
        scannedAt: new Date().toISOString(),
        root: mediaDir,
        files: 1,
        bytes: 2048,
        referencedUrls: 0,
        referencedFiles: 0,
        orphans: 1,
        orphanBytes: 2048,
        youngSkipped: 0,
        unmanaged: 0,
        unmanagedBytes: 0,
        tempStale: 0,
        tempStaleBytes: 0,
        tempSkipped: 0,
        deepSkipped: 0,
        missingTotal: 0,
        orphansList: [],
        unmanagedList: [],
        missing: [],
      }),
    );
    const report = await mediaHygiene(db, { mode: 'report' });
    expect(report.cached).toBe(true);
    expect(report.incomplete).toBe(false);
    expect(report.notes.join(' ')).not.toContain('کامل نشد');
  });
});

describe('قلمِ حجم', () => {
  it('بایت، کیلوبایت و مگابایت با رقمِ فارسی', () => {
    expect(formatMediaBytes(512)).toBe('۵۱۲ بایت');
    expect(formatMediaBytes(2048)).toBe('۲ کیلوبایت');
    expect(formatMediaBytes(5 * 1024 * 1024)).toBe('۵٫۰ مگابایت');
    expect(formatMediaBytes(-9)).toBe('۰ بایت');
  });
});
