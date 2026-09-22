import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createDatabase, type Database } from '@set/db';
import { applyMigrations } from '@set/db';
import { renderTemplate, type SmsTemplateKey } from './sms.js';
import { setSetting } from './settings.js';
import {
  OutsideIranError,
  SMS_SAMPLE_VARS,
  SmsProviderError,
  canSendFreeText,
  claimDueMessages,
  guardRequest,
  extraHostsFromEnv,
  extractVars,
  guardedFetch,
  guardedFetchWithTimeout,
  splitTemplate,
  placeholdersOf,
  readSmsSendConfig,
  releaseStaleSending,
  sendDue,
  sendSmsTest,
  sendViaFaraz,
  sendViaKavenegar,
  sendViaMeliPayamak,
  varsForTemplate,
  type HttpFetcher,
  type HttpResponseLike,
  type SmsSendConfig,
} from './sms-send.js';

/* ───────────────────────────────────────────────────────────────────────── */
/* نگهبان «فقط ایران» — این پرچم تا پیشِ این فقط خوانده می‌شد و به کار نمی‌رفت */
/* ───────────────────────────────────────────────────────────────────────── */

describe('نگهبان «فقط ایران» رویِ درخواست‌هایِ بیرونی', () => {
  it('نشانی‌هایِ ایرانیِ سرویس رد نمی‌شوند', () => {
    for (const host of [
      'api.kavenegar.com',
      'api.melipayamak.com',
      'sms.farazsms.com',
      'tax.gov.ir',
      'api.zarinpal.com',
    ]) {
      expect(() => guardRequest(`https://${host}/x`)).not.toThrow();
    }
  });

  it('هر دامنه‌یِ دیگر، بی‌آنکه درخواستی برود، رد می‌شود', () => {
    expect(() => guardRequest('https://api.telegram.org/bot123/sendMessage')).toThrow(
      OutsideIranError,
    );
    // و خطا باید بگوید کجا را باز کنیم، نه این‌که «مجاز نیست»
    try {
      guardRequest('https://hooks.example-analytics.com/push');
    } catch (e) {
      expect((e as OutsideIranError).message).toContain('IRAN_SERVICE_HOSTS');
    }
  });

  it('شبکه‌یِ داخلی و لوکال‌هاست آزاد است (استقرارِ آزمایشی، آزمون)', () => {
    expect(() => guardRequest('http://127.0.0.1:8081/sms')).not.toThrow();
    expect(() => guardRequest('http://sms.local/send')).not.toThrow();
    expect(() => guardRequest('http://10.10.4.9/send')).not.toThrow();
  });

  it('با STRICT_IRAN_ONLY=false، فهرست بی‌اثر می‌شود', () => {
    expect(() =>
      guardRequest('https://api.telegram.org/x', { strictIranOnly: false }),
    ).not.toThrow();
  });

  it('http بیرونی حتی با خاموش‌بودنِ «فقط ایران» بسته می‌ماند', () => {
    // کلیدِ پیامک رویِ http = دزدیده‌شدنِ همان کلید در همان شبکه
    expect(() =>
      guardRequest('http://api.kavenegar.com/v1/k/send.json', { strictIranOnly: false }),
    ).toThrow(/https/);
    expect(() =>
      guardRequest('http://api.kavenegar.com/v1/k/send.json', {
        strictIranOnly: false,
        allowInsecure: true,
      }),
    ).not.toThrow();
  });

  it('guardedFetch تنها پس ازِ گذشتن از نگهبان صدا زده می‌شود', async () => {
    const seen: string[] = [];
    const http = guardedFetch(async (url) => {
      seen.push(url);
      return { status: 200, text: async () => '{}' };
    });
    await expect(http('https://evil.example.com/x')).rejects.toBeInstanceOf(OutsideIranError);
    expect(seen).toEqual([]); // هیچ درخواستی بیرون نرفته است
    await http('http://127.0.0.1:1/x');
    expect(seen.length).toBe(1);
  });
});

/* ───────────────────────────────────────────────────────────────────────── */
/* قالب‌ها — پلی میانِ متنِ ما و «قالبِ تأییدشده»ٔ سامانه                    */
/* ───────────────────────────────────────────────────────────────────────── */

describe('جای‌نگهداری‌ها و قالبِ سامانه', () => {
  it('ترتیبِ متغیرها از خودِ متن خوانده می‌شود، نه از الفبا', () => {
    expect(placeholdersOf('{store}: کد {code} — {order}')).toEqual(['store', 'code', 'order']);
    // تکراری‌ها یک‌بار، تا یک متغیرِ دوباره‌درمتن، صفِ مقادیر را جابه‌جا نکند
    expect(placeholdersOf('{a}{b}{a}')).toEqual(['a', 'b']);
  });

  it('با شناسهٔ قالب، مقادیر از متنِ رندرشده درمی‌آیند (نه نامِ متغیرها)', () => {
    const r = varsForTemplate(
      'سفارش ORD-1 تأیید شد و به‌زودی ارسال می‌شود — ست‌شاپ',
      { key: 'order_confirmed', providerTemplateId: '12345', placeholders: ['order', 'store'] },
      'سفارش {order} تأیید شد و به‌زودی ارسال می‌شود — {store}',
    );
    expect(r).toEqual({ ok: true, vars: ['ORD-1', 'ست‌شاپ'] });
  });

  it('بی‌شناسه‌یِ قالب اما با خطِ پیامک: متنِ آزاد می‌رود (صف نباید خودش را ببندد)', () => {
    const r = varsForTemplate('سفارش ORD-1 تأیید شد', { key: 'order_paid', providerTemplateId: null, placeholders: [] }, undefined, {
      allowFreeText: true,
    });
    expect(r).toEqual({ ok: true, vars: [] });
  });

  it('«خطِ پیامک» تنها راهِ متنِ آزاد است، نه «خطِ سرویس»', () => {
    expect(canSendFreeText({ sender: '10008663', service: false })).toBe(true);
    expect(canSendFreeText({ sender: '  ', service: true })).toBe(false);
    expect(canSendFreeText({ sender: '', service: false })).toBe(false);
  });

  it('بی‌شناسه‌یِ قالب، ارسالِ متنِ آزاد رد می‌شود و راه‌حل را می‌گوید', () => {
    const r = varsForTemplate('متنِ آزاد', {
      key: 'otp_login',
      providerTemplateId: null,
      placeholders: ['store', 'code'],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toContain('شناسه‌یِ قالبِ ارسال‌کننده');
      // هر دو درمان در یک پیام: آدم نباید حدس بزند «یا این یا آن»
      expect(r.reason).toContain('خطِ پیامک');
    }
  });
});

/* ───────────────────────────────────────────────────────────────────────── */
/* فرمتِ درخواستِ هر سامانه — با fetchِ جعلی، بی‌هیچ اتصالی به بیرون          */
/* ───────────────────────────────────────────────────────────────────────── */

const json = (status: number, body: unknown): HttpResponseLike => ({
  status,
  text: async () => JSON.stringify(body),
});

function recorder(body: unknown = { return: { statusCode: 200, entries: [{ ticket: 'T-9' }] } }) {
  const calls: Array<{ url: string; init?: Record<string, unknown> }> = [];
  const http: HttpFetcher = async (url, init) => {
    calls.push({ url, init });
    return json(calls.length === 1 && body === null ? 500 : 200, body ?? {});
  };
  return { calls, http };
}

describe('کاوه‌نگار', () => {
  it('با شناسهٔ قالب، lookup/send و token/token2/token3', async () => {
    const { calls, http } = recorder();
    const r = await sendViaKavenegar(
      { to: '09121112233', body: 'x', templateId: '77', vars: ['1234', 'ORD-9'] },
      { apiKey: 'KEY', sender: '', service: false },
      http,
    );
    expect(calls[0]!.url).toBe('https://api.kavenegar.com/v1/KEY/lookup/send.json');
    const form = new URLSearchParams(String(calls[0]!.init!.body));
    expect(form.get('template')).toBe('77');
    expect(form.get('token')).toBe('1234');
    expect(form.get('token2')).toBe('ORD-9');
    expect(form.get('receptor')).toBe('09121112233');
    expect(form.get('message')).toBeNull(); // با قالب، متنِ آزاد فرستاده نمی‌شود
    expect(r.ref).toBe('T-9');
  });

  it('قالبِ بی‌شناسه از پنل → رد با پیامِ راهنما، بی‌درخواست', async () => {
    const { calls, http } = recorder();
    await expect(
      sendViaKavenegar({ to: '0912', body: 'متن آزاد' }, { apiKey: 'K', sender: '', service: false }, http),
    ).rejects.toThrow(/خطِ سرویس/);
    expect(calls.length).toBe(0);
  });

  it('خطایِ ۵xx سامانه «تلاشِ دوباره‌پذیر» است و ۴xx نیست', async () => {
    const http5: HttpFetcher = async () => json(503, { errorMessage: 'سرویس در دسترس نیست' });
    await expect(
      sendViaKavenegar({ to: '09', body: 'm' }, { apiKey: 'K', sender: '1000666', service: false }, http5),
    ).rejects.toMatchObject({ retryable: true, status: 503 });

    const http4: HttpFetcher = async () => json(403, { errorMessage: 'کلید نامعتبر است' });
    await expect(
      sendViaKavenegar({ to: '09', body: 'm' }, { apiKey: 'K', sender: '1000666', service: false }, http4),
    ).rejects.toMatchObject({ retryable: false });
  });

  it('statusCodeِ غیر۲۰۰ در بدنه، خطاست (HTTP ۲۰۰ فریبنده است)', async () => {
    const http: HttpFetcher = async () =>
      json(200, { return: { statusCode: 402, errorMessage: 'اعتبار تمام شده است' } });
    await expect(
      sendViaKavenegar({ to: '09', body: 'm' }, { apiKey: 'K', sender: '1000666', service: false }, http),
    ).rejects.toThrow(/اعتبار تمام شده است/);
  });
});

describe('ملی‌پیامک و فراز', () => {
  it('ملی‌پیامک: «کاربری|گذرواژه» و مسیرِ متفاوت برایِ قالب', async () => {
    const { calls, http } = recorder({ RetId: 'R-1', ErrorCode: 0 });
    await sendViaMeliPayamak(
      { to: '0912', body: 'm', templateId: 'OP7', vars: ['a'] },
      { apiKey: 'user|pass' },
      http,
    );
    expect(calls[0]!.url).toContain('/send/plan/user/pass');
    const form = new URLSearchParams(String(calls[0]!.init!.body));
    expect(form.get('op_code')).toBe('OP7');
    expect(form.get('p1')).toBe('a');
    expect(form.get('to')).toBe('0912');
  });

  it('ملی‌پیامک با کلیدِ بی‌گذرواژه: خطایِ تنظیم، بی‌درخواست', async () => {
    const { calls, http } = recorder();
    await expect(sendViaMeliPayamak({ to: '09', body: 'm' }, { apiKey: 'onlyuser' }, http)).rejects.toThrow(
      /کاربری\|گذرواژه/,
    );
    expect(calls.length).toBe(0);
  });

  it('فراز: خطِ سرویس لازم است و count=0 یعنی شکست', async () => {
    await expect(
      sendViaFaraz({ to: '09', body: 'm' }, { apiKey: 'K', sender: '' }, recorder().http),
    ).rejects.toThrow(/خطِ پیامک/);

    const { calls, http } = recorder({ count: 0, info: 'شماره مسدود است' });
    await expect(sendViaFaraz({ to: '09', body: 'm' }, { apiKey: 'K', sender: '3000' }, http)).rejects.toThrow(
      /شماره مسدود است/,
    );
    expect(calls[0]!.url).toContain('action=send');
    expect(JSON.parse(String(calls[0]!.init!.body))).toMatchObject({ dst: ['09'], line: '3000' });
  });
});

/* ───────────────────────────────────────────────────────────────────────── */
/* حلقهٔ کارگر رویِ پایگاهِ واقعی (PGlite، مهاجرت‌هایِ کامل ۰۳۵)              */
/* ───────────────────────────────────────────────────────────────────────── */

let db: Database;

beforeEach(async () => {
  db = createDatabase('memory://');
  await applyMigrations(db);
});

afterEach(async () => db.close());

const cfg = (over: Partial<SmsSendConfig> = {}): SmsSendConfig => ({
  provider: 'kavenegar',
  apiKey: 'KEY',
  sender: '',
  service: false,
  maxAttempts: 3,
  backoffMinutes: 10,
  timeoutMs: 5_000,
  allowInsecure: true,
  strictIranOnly: true,
  endpoints: {},
  enabled: true,
  dryRun: false,
  ...over,
});

async function queue(
  rows: Array<{ phone?: string; body?: string; key?: string | null }>,
): Promise<string[]> {
  const ids: string[] = [];
  for (const r of rows) {
    const key = r.key ?? 'order_paid';
    const body = r.body ?? (await realBody(key));
    const { rows: out } = await db.query<{ id: string }>(
      `INSERT INTO sms_outbox (phone, template_key, body) VALUES ($1,$2,$3) RETURNING id`,
      [r.phone ?? '09121112233', key, body],
    );
    ids.push(out[0]!.id);
  }
  return ids;
}

/**
 * متن را همان‌طور که خودِ `enqueueSms` می‌سازد می‌سازیم — بی‌این، آزمونِ
 * «بازگردانیِ مقادیر از متن» رویِ رشته‌یِ ساختگی سنجیده می‌شد و همان باگِ
 * `token=order` را دوباره رد نمی‌گرفت.
 */
async function realBody(key: string): Promise<string> {
  const vars: Record<string, string> = {
    order: 'ORD-100',
    amount: '۴٬۵۰۰٬۰۰۰',
    code: '73915',
    tracking: 'TRK-88',
    link: 'https://shop.example/p/1',
    product: 'کابل شارژ',
    invoice: 'INV-9',
    check: 'CHQ-3',
    date: '۱۴۰۴-۰۷-۰۱',
    phone: '۰۲۱۹۱۰۰۰۰۰۰',
  };
  return renderTemplate(db, key as SmsTemplateKey, vars);
}

async function row(id: string) {
  const { rows } = await db.query<Record<string, unknown>>(
    `SELECT status, attempts, provider_ref, last_error, sent_at, available_at FROM sms_outbox WHERE id = $1`,
    [id],
  );
  return rows[0]!;
}

describe('حلقهٔ ارسالِ پیامک', () => {
  it('مهاجرتِ ۰۳۵ نشسته است (ستون‌ها و وضعیت‌هایِ تازه)', async () => {
    const { rows } = await db.query<{ c: string }>(
      `SELECT column_name c FROM information_schema.columns
        WHERE table_name = 'sms_outbox' AND column_name IN ('attempts','last_error','available_at')`,
    );
    expect(rows.map((r) => r.c).sort()).toEqual(['attempts', 'available_at', 'last_error']);
  });

  it('پیامِ رسیده فرستاده می‌شود، با ارجاعِ سامانه و زمانِ ارسال', async () => {
    // قالبِ تأییدشده از پنل لازم است؛ بی‌آن هیچ درخواستی بیرون نمی‌رود —
    // همان را آزمونِ «قالبِ بی‌شناسه» پایینِ همین فهرست صریح سنجیده است
    await db.query(`UPDATE sms_templates SET provider_template_id = 'PAID-1' WHERE key = 'order_paid'`);
    const [id] = await queue([{}]);
    const http = recorder();
    const r = await sendDue(db, cfg(), { fetchImpl: http.http, limit: 5 });
    expect(r).toMatchObject({ claimed: 1, sent: 1, failed: 0, dead: 0 });
    const after = await row(id!);
    expect(after.status).toBe('sent');
    expect(after.provider_ref).toBe('T-9');
    expect(after.sent_at).toBeTruthy();
    expect(after.last_error).toBeNull();
    expect(after.attempts).toBe(1); // یک تلاش، و همان تلاش موفق بود
  });

  it('قالبِ بی‌شناسه → پیام به dead می‌رود با پیامِ راهنما، نه یک ارسالِ بی‌مصرف', async () => {
    const [id] = await queue([{}]);
    const http = recorder();
    const r = await sendDue(db, cfg({ maxAttempts: 1 }), { fetchImpl: http.http, limit: 5 });
    expect(r.dead).toBe(1);
    expect(http.calls.length).toBe(0);
    const after = await row(id!);
    expect(after.status).toBe('dead');
    expect(String(after.last_error)).toContain('شناسه‌یِ قالبِ ارسال‌کننده');
  });

  it('خطِ پیامک تنظیم‌شده = متنِ آزاد می‌رود (بی‌این، صف با کلیدِ درست هم خالی نمی‌شد)', async () => {
    // همین حالت، همان «پیامک ثبت می‌شود ولی نمی‌رسد» است: کاوه‌نگارِ سالم با خطِ
    // 10008663 متنِ آزاد را می‌پذیرد، اما قاعدهٔ پیشین صف را پیشِ‌اپ رد می‌کرد.
    const [id] = await queue([{}]);
    const http = recorder();
    const r = await sendDue(db, cfg({ sender: '10008663' }), { fetchImpl: http.http, limit: 5 });
    expect(r).toMatchObject({ claimed: 1, sent: 1, failed: 0, dead: 0 });
    expect(http.calls[0]!.url).toContain('/send.json');
    const form = new URLSearchParams(String(http.calls[0]!.init!.body));
    expect(form.get('receptor')).toBe('09121112233');
    // متنِ رندرشده می‌رود، نه نامِ متغیرها
    expect(form.get('message')).toContain('ORD-100');
    expect(form.get('template')).toBeNull();
    const after = await row(id!);
    expect(after.status).toBe('sent');
    expect(after.provider_ref).toBe('T-9');
  });

  it('«خطِ سرویس» تنها، متنِ آزاد را مجاز نمی‌کند (کاوه‌نگار خودش رد می‌کند)', async () => {
    // آزمونِ این نکته که چرا `canSendFreeText` فقط `sender` را می‌بیند: با
    // service و بی‌خط، درخواست رفتنی نیست و آزادکردنش یعنی تلاشِ سوخته.
    const [id] = await queue([{}]);
    const http = recorder();
    const r = await sendDue(db, cfg({ service: true, maxAttempts: 1 }), { fetchImpl: http.http, limit: 5 });
    expect(http.calls.length).toBe(0);
    expect(r.dead).toBe(1);
    expect(String((await row(id!)).last_error)).toContain('خطِ پیامک');
  });

  it('با شناسهٔ قالب در پنل، همان شناسه و متغیرها می‌روند', async () => {
    await db.query(`UPDATE sms_templates SET provider_template_id = 'PAID-1' WHERE key = 'order_paid'`);
    await queue([{}]);
    const http = recorder();
    const r = await sendDue(db, cfg(), { fetchImpl: http.http, limit: 5 });
    expect(r.sent).toBe(1);
    expect(http.calls[0]!.url).toContain('/lookup/send.json');
    expect(new URLSearchParams(String(http.calls[0]!.init!.body)).get('template')).toBe('PAID-1');
  });

  it('قطعیِ سامانه = تلاشِ دوباره با فاصله؛ سه بار و تمام → dead', async () => {
    const [id] = await queue([{}]);
    await db.query(`UPDATE sms_templates SET provider_template_id = 'PAID-1' WHERE key = 'order_paid'`);
    const down: HttpFetcher = async () => json(503, { errorMessage: 'سرویس در دسترس نیست' });

    let r = await sendDue(db, cfg(), { fetchImpl: down, limit: 5 });
    expect(r).toMatchObject({ claimed: 1, sent: 0, failed: 1, dead: 0 });
    let after = await row(id!);
    expect(after.status).toBe('failed');
    expect(after.attempts).toBe(1);
    expect(after.available_at.getTime()).toBeGreaterThan(Date.now()); // در مهلتِ تلاش نیست
    expect(String(after.last_error)).toContain('503');

    // دو دورِ دیگر — و سوم باید ناامیدکننده باشد
    await db.query(`UPDATE sms_outbox SET available_at = now() - interval '1 hour'`);
    r = await sendDue(db, cfg(), { fetchImpl: down, limit: 5 });
    expect(r.failed).toBe(1);
    await db.query(`UPDATE sms_outbox SET available_at = now() - interval '1 hour'`);
    r = await sendDue(db, cfg({ maxAttempts: 3 }), { fetchImpl: down, limit: 5 });
    expect(r).toMatchObject({ failed: 0, dead: 1 });
    after = await row(id!);
    expect(after.status).toBe('dead');
    expect(after.attempts).toBe(3);
  });

  it('پیام در صفِ نرسیده به نوبت، برداشته نمی‌شود (backoff واقعاً اِعمال می‌شود)', async () => {
    await db.query(`UPDATE sms_templates SET provider_template_id = 'PAID-1' WHERE key = 'order_paid'`);
    await queue([{}]);
    const down: HttpFetcher = async () => json(503, {});
    await sendDue(db, cfg(), { fetchImpl: down, limit: 5 });
    const http = recorder();
    const r = await sendDue(db, cfg(), { fetchImpl: http.http, limit: 5 });
    expect(r).toMatchObject({ claimed: 0, sent: 0 });
    expect(http.calls.length).toBe(0);
  });

  it('خطایِ تنظیمی (کلیدِ غلط) فوراً به dead می‌رود؛ صفِ خراب را دوباره دوباره نفرست', async () => {
    await db.query(`UPDATE sms_templates SET provider_template_id = 'PAID-1' WHERE key = 'order_paid'`);
    const [id] = await queue([{}]);
    const bad: HttpFetcher = async () => json(403, { errorMessage: 'کلید نامعتبر است' });
    const r = await sendDue(db, cfg(), { fetchImpl: bad, limit: 5 });
    expect(r).toMatchObject({ dead: 1, failed: 0 });
    expect((await row(id!)).status).toBe('dead');
  });

  it('SMS_DRY_RUN هیچ درخواستی بیرون نمی‌فرستد، اما پیام را گم نمی‌کند', async () => {
    await db.query(`UPDATE sms_templates SET provider_template_id = 'PAID-1' WHERE key = 'order_paid'`);
    const [id] = await queue([{}]);
    const http = recorder();
    const r = await sendDue(db, cfg({ dryRun: true }), { fetchImpl: http.http, limit: 5 });
    expect(http.calls.length).toBe(0);
    expect(r.skipped).toBe(1);
    expect((await row(id!)).status).toBe('failed');
    expect(String((await row(id!)).last_error)).toContain('حالتِ آزمایشی');
  });

  it('بی‌«ارسال‌کننده» یا با سقفِ خاموش، صف دست‌نخورده می‌ماند', async () => {
    const [id] = await queue([{}]);
    const http = recorder();
    expect((await sendDue(db, cfg({ provider: 'none' }), { fetchImpl: http.http })).claimed).toBe(0);
    expect((await row(id!)).status).toBe('pending'); // صف دست‌نخورده
    // و با خاموش‌بودنِ «ارسالِ پیامک» در پنل هم هیچ پیامی برداشته نمی‌شود —
    // حتی اگر یک fetchِ آماده رویِ میز باشد (کلیدِ روشن‌کردن، تزریقِ fetch نیست)
    expect((await sendDue(db, cfg({ enabled: false }), { fetchImpl: http.http })).claimed).toBe(0);
    expect((await row(id!)).status).toBe('pending');
    expect(http.calls.length).toBe(0);
  });

  it('«sending»ِ کارگرِ مرده آزاد و دوباره نوبت می‌گیرد', async () => {
    await db.query(`UPDATE sms_templates SET provider_template_id = 'PAID-1' WHERE key = 'order_paid'`);
    const [id] = await queue([{}]);
    // کاری که یک کارگرِ کشته‌شده می‌گذارد بجا: قفل‌شده در «sending»
    await db.query(`UPDATE sms_outbox SET status='sending', attempts=1, available_at = now() - interval '1 minute' WHERE id=$1`, [id!]);
    expect(await releaseStaleSending(db)).toBe(1);
    expect((await row(id!)).status).toBe('failed');
    const http = recorder();
    const r = await sendDue(db, cfg(), { fetchImpl: http.http, limit: 5 });
    expect(r.sent).toBe(1); // و این‌بار واقعاً فرستاده شد
  });

  it('پیامِ بی‌قالب (متنِ آماده) رد می‌شود و دلیلش نوشته می‌شود — ارسالِ خودسر ممنوع', async () => {
    const [id] = await queue([{ key: null, body: 'متنِ آماده‌یِ بی‌قالب' }]);
    const http = recorder();
    const r = await sendDue(db, cfg(), { fetchImpl: http.http, limit: 5 });
    expect(http.calls.length).toBe(0);
    expect(r.dead + r.failed).toBe(1);
    expect(String((await row(id!)).last_error)).toContain('شناسه‌یِ قالبِ ارسال‌کننده');
  });

  it('claim قفل می‌کند و attempts را یک‌بار بالا می‌برد', async () => {
    const [id] = await queue([{ body: 'بدونِ قالب', key: null }]);
    const first = await claimDueMessages(db, { limit: 10, maxAttempts: 3 });
    expect(first.map((f) => f.id)).toEqual([id!]);
    expect(first[0]!.attempts).toBe(1);
    // دورِ دوم: همان پیام، چون هنوز «sending» است، دوباره برداشته نمی‌شود
    expect((await claimDueMessages(db, { limit: 10, maxAttempts: 3 })).length).toBe(0);
  });

  it('تنظیماتِ پنل بر محیط مقدم است، و ناآشنا بی‌سر‌و‌صدا به none می‌افتد', async () => {
    await db.query(
      `INSERT INTO store_settings (key, value) VALUES ('sms_provider','kavenegar'),('sms_max_attempts','7'),('sms_enabled','true')
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
    );
    const fromPanel = await readSmsSendConfig(db, { SMS_PROVIDER: 'farazsms', SMS_API_KEY: 'from-env' });
    expect(fromPanel.provider).toBe('kavenegar');
    expect(fromPanel.maxAttempts).toBe(7);
    expect(fromPanel.apiKey).toBe('from-env'); // تنها از محیط، وقتی پنل خالی است
    expect(fromPanel.enabled).toBe(true);

    await db.query(`INSERT INTO store_settings (key,value) VALUES ('sms_provider','telegram-bot')
                    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`);
    expect((await readSmsSendConfig(db, {})).provider).toBe('none');
  });
});

describe('بازگردانیِ مقادیر از متنِ رندرشده (باگِ token=order)', () => {
  const RAW = 'سفارش {order} ثبت شد و مبلغ {amount} تومان دریافت شد. در حال بررسی است — {store}';

  it('قطعه‌بندیِ قالب، دُمِ متن را هم نگه می‌دارد', () => {
    // قطعه‌یِ دُم تنها وقتی ساخته می‌شود که چیزی پس ازِ آخرینِ متغیر مانده باشد —
    // اگر نبود، الگو بی‌دُم ساخته می‌شود (و آزمونِ «هم‌خوانیِ متن» همین را می‌پاید)
    expect(splitTemplate(RAW).map((p) => p.var)).toEqual(['order', 'amount', 'store']);
    expect(splitTemplate('خوش آمدید!')).toEqual([{ literal: 'خوش آمدید!', var: '' }]);
  });

  it('مقادیرِ واقعی بیرون کشیده می‌شوند، نه نامِ جای‌نگهداری‌ها', () => {
    const r = extractVars(
      'سفارش ORD-100 ثبت شد و مبلغ ۴٬۵۰۰٬۰۰۰ تومان دریافت شد. در حال بررسی است — ست‌شاپ',
      RAW,
      ['order', 'amount', 'store'],
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.vars).toEqual(['ORD-100', '۴٬۵۰۰٬۰۰۰', 'ست‌شاپ']);
  });

  it('قالبِ بی‌متغیر: بی‌متغیر می‌فرستد و این خطا نیست', () => {
    const r = extractVars('خوش آمدید!', 'خوش آمدید!', []);
    expect(r).toEqual({ ok: true, vars: [] });
  });

  it('متنِ ناسازگار با قالب → رد، با پیامِ خوانا', () => {
    const r = extractVars('چیزی کاملاً دیگر', RAW, ['order', 'amount', 'store']);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain('هم‌خوانی ندارد');
  });
});


/* ───────────────────────────────────────────────────────────────────────── */
/* دو دریچه‌ای که وعده داده شده بود و نبود: فهرستِ بازِ میزبان‌ها و مهلتِ درخواست */
/* ───────────────────────────────────────────────────────────────────────── */

describe('دریچه‌هایِ آگاهانهٔ نگهبان', () => {
  it('SMS_EXTRA_HOSTS میزبانِ ناآشنا را مجاز می‌کند — و فقط همان میزبان را', () => {
    // میزبانی که «داخلی» هم نیست (بی‌آن، آزادبودنِ شبکهٔ داخلی ادعایِ آزمون را
    // بی‌معنا می‌کرد و فهرستِ باز هرگز سنجیده نمی‌شد)
    const url = 'https://sms.mirror.example/send';
    expect(() => guardRequest(url, { strictIranOnly: true })).toThrow(OutsideIranError);
    expect(() => guardRequest(url, { strictIranOnly: true, extraHosts: ['sms.mirror.example'] })).not.toThrow();
    // میزبانِ دیگر همچنان بسته است: «فهرستِ باز» یعنی بازکردنِ یک در، نه همه درها
    expect(() =>
      guardRequest('https://evil.example/send', { strictIranOnly: true, extraHosts: ['sms.mirror.example'] }),
    ).toThrow(OutsideIranError);
  });

  it('فهرست از محیط: ویرگول‌جدا، بی‌فاصله، بدونِ حساسیت به بزرگ‌کیچ', () => {
    expect(extraHostsFromEnv({ SMS_EXTRA_HOSTS: ' SMS.Mirror.internal , 10.0.0.9 ,' })).toEqual([
      'sms.mirror.internal',
      '10.0.0.9',
    ]);
    expect(extraHostsFromEnv({})).toEqual([]);
  });

  it('مهلتِ درخواست: fetchِ بی‌پاسخ، «موقت» رد می‌شود و آزمون معلق نمی‌ماند', async () => {
    let sawSignal = false;
    const hang: HttpFetcher = (_url, init) => {
      sawSignal = (init as { signal?: unknown } | undefined)?.signal !== undefined;
      return new Promise<HttpResponseLike>(() => {
        /* هرگز.resolve نمی‌شود — همان حالتِ سامانهٔ آویزان */
      });
    };
    const http = guardedFetchWithTimeout({ strictIranOnly: true, allowInsecure: false, timeoutMs: 40, extraHosts: [] }, hang);
    const startedAt = Date.now();
    const err = await http('https://api.kavenegar.com/v1/K/send.json').catch((e) => e as Error);
    expect(err).toBeInstanceOf(SmsProviderError);
    expect((err as Error).message).toMatch(/پاسخ نداد/);
    // «موقت» باشد درست است: قطعیِ لحظه‌ای نباید پیامک را از صف بیرون بیندازد
    expect((err as SmsProviderError).retryable).toBe(true);
    expect(Date.now() - startedAt).toBeLessThan(4000);
    // سیگنال هم باید رفته باشد، وگرنه سوکتِ نیمه‌باز در هر دورِ کارگر نشت می‌کند
    expect(sawSignal).toBe(true);
  });

  it('مهلت به پیاده‌سازیِ پایینی رحم نمی‌کند: پاسخِ دیرهنگام هم رد می‌شود', async () => {
    const late: HttpFetcher = () =>
      new Promise<HttpResponseLike>((resolve) => {
        setTimeout(() => resolve(json(200, { return: { statusCode: 200 } })), 500);
      });
    const http = guardedFetchWithTimeout({ strictIranOnly: true, allowInsecure: false, timeoutMs: 30, extraHosts: [] }, late);
    const startedAt = Date.now();
    const err = await http('https://api.kavenegar.com/v1/K/send.json').catch((e) => e as Error);
    expect(err).toBeInstanceOf(SmsProviderError);
    expect(Date.now() - startedAt).toBeLessThan(400);
  });

  it('timeoutMs=0 یعنی بی‌مهلت (برایِ آزمون و استقرارِ کند)', async () => {
    let sawSignal = true;
    const http = guardedFetchWithTimeout(
      { strictIranOnly: false, allowInsecure: true, timeoutMs: 0, extraHosts: [] },
      async (_url, init) => {
        sawSignal = (init as { signal?: unknown } | undefined)?.signal !== undefined;
        return json(200, { return: { statusCode: 200 } });
      },
    );
    await expect(http('https://api.kavenegar.com/x')).resolves.toBeTruthy();
    expect(sawSignal).toBe(false);
  });
});

/* ───────────────────────────────────────────────────────────────────────── */
/* «آزمونِ ارسال» در پنل — بی‌صف، با پاسخِ خامِ سامانه                       */
/* ───────────────────────────────────────────────────────────────────────── */

describe('sendSmsTest — یک پیامکِ تک برایِ «کلیدم کار می‌کند؟»', () => {
  /**
   * کانفیگ، از همان جایی که در دنیایِ واقعی خوانده می‌شود: پنل. متغیرِ
   * محیطی تنها «پشتیبان» است (ارزشِ پنل مقدم است)، پس آزمون هم باید از
   * پنل بنویسد — نه از محیط، وگرنه چیزی را می‌سنجد که در تولید خوانده نمی‌شود.
   */
  async function cfg(over: Partial<SmsSendConfig> = {}) {
    const base = await readSmsSendConfig(db);
    return { ...base, provider: 'kavenegar' as const, apiKey: 'K1', ...over };
  }

  it('شماره‌یِ بی‌اعتبار: بی‌هیچ درخواستی رد می‌شود', async () => {
    const rec = recorder();
    const out = await sendSmsTest(db, await cfg(), { phone: '12345' }, rec.http);
    expect(out.ok).toBe(false);
    expect(out.error).toMatch(/شماره معتبر نیست/);
    expect(rec.calls.length).toBe(0);
  });

  it('شماره‌یِ «۹۱۲…» (بی‌پیش‌شماره) پذیرفته و نرمال می‌شود — بی‌اعتبار تحریف نمی‌شود', async () => {
    await setSetting(db, 'store_name', 'ست‌شاپ');
    await db.query(`UPDATE sms_templates SET provider_template_id='T-TEST' WHERE key='order_paid'`);
    const rec = recorder();
    const good = await sendSmsTest(db, await cfg(), { phone: '9121112233', templateKey: 'order_paid' }, rec.http);
    expect(good.ok).toBe(true);
    expect(good.phone).toBe('09121112233');

    const junk = await sendSmsTest(db, await cfg(), { phone: '12345' }, rec.http);
    expect(junk.error).toMatch(/شماره معتبر نیست/);
    // همانِ واردشده برمی‌گردد، نه «۰۱۲۳۴۵»ی که نرمال‌سازیِ زودهنگام می‌ساخت
    expect(junk.phone).toBe('12345');
  });

  it('«کلیدِ ارسال‌کننده» خالی: می‌گوید کدام خانه را پر کن، بی‌درخواست', async () => {
    const rec = recorder();
    const out = await sendSmsTest(db, await cfg({ apiKey: '' }), { phone: '09121112233' }, rec.http);
    expect(out.error).toMatch(/کلیدِ ارسال‌کننده/);
    expect(rec.calls.length).toBe(0);
  });

  it('قالبِ برچسب‌دار: همان مسیرِ کارگر — شناسهٔ قالب + مقدارهایِ بیرون‌کشیده‌شده از متن', async () => {
    await setSetting(db, 'store_name', 'ست‌شاپ');
    await db.query(`UPDATE sms_templates SET provider_template_id='T-TEST' WHERE key='order_paid'`);
    const rec = recorder();
    const out = await sendSmsTest(db, await cfg(), { phone: '+98 912 111 2233', templateKey: 'order_paid' }, rec.http);
    expect(out.ok).toBe(true);
    expect(out.error).toBeNull();
    expect(out.phone).toBe('09121112233'); // نرمال‌شده، همان‌طور که به سامانه می‌رود
    expect(out.ref).toBe('T-9');
    expect(out.httpStatus).toBe(200);
    expect(out.raw).toContain('T-9');
    const form = new URLSearchParams(String(rec.calls[0]!.init!.body));
    expect(rec.calls[0]!.url).toBe('https://api.kavenegar.com/v1/K1/lookup/send.json');
    expect(form.get('template')).toBe('T-TEST');
    // مهم‌ترینِ بند: مقدارِ واقعی برود و هیچ‌کدام «نامِ متغیر» نباشد — همان
    // باگی که تنها با فرستندهٔ ساختگیِ پایانه‌ای دیدنی بود
    expect(out.vars).toEqual([SMS_SAMPLE_VARS.order, SMS_SAMPLE_VARS.amount, 'ست‌شاپ']);
    expect(form.get('token')).toBe(SMS_SAMPLE_VARS.order);
    expect(form.get('message')).toBeNull();
    expect(out.body).toContain(SMS_SAMPLE_VARS.order);
  });

  it('قالبِ بی‌برچسب: متنِ آزاد می‌رود و پنل هشدار می‌گیرد (نه خطایِ خاموش)', async () => {
    await setSetting(db, 'store_name', 'ست‌شاپ');
    await db.query(`UPDATE sms_templates SET provider_template_id=NULL WHERE key='order_paid'`);
    const rec = recorder({ return: { statusCode: 400, errorMessage: 'قالب تأیید نشده است' } });
    const out = await sendSmsTest(db, await cfg({ sender: '1000666' }), {
      phone: '09121112233',
      templateKey: 'order_paid',
    }, rec.http);
    expect(out.notes.join(' ')).toMatch(/متنِ آزاد/);
    expect(out.ok).toBe(false);
    expect(out.error).toMatch(/قالب تأیید نشده/);
    expect(out.retryable).toBe(false);
    expect(out.providerCode).toBe(400);
    expect(out.raw).toContain('قالب تأیید نشده است');
    const form = new URLSearchParams(String(rec.calls[0]!.init!.body));
    expect(rec.calls[0]!.url).toContain('/send.json');
    expect(form.get('message')).toContain('سفارش');
    expect(form.get('template')).toBeNull();
  });

  it('SMS_DRY_RUN: همه‌چیز آماده می‌شود اما درخواستی بیرون نمی‌رود', async () => {
    await setSetting(db, 'store_name', 'ست‌شاپ');
    await db.query(`UPDATE sms_templates SET provider_template_id='T-TEST' WHERE key='order_paid'`);
    const rec = recorder();
    const out = await sendSmsTest(db, await cfg({ dryRun: true }), { phone: '09121112233', templateKey: 'order_paid' }, rec.http);
    expect(out.ok).toBe(true);
    expect(out.dryRun).toBe(true);
    expect(out.body.length).toBeGreaterThan(4);
    expect(rec.calls.length).toBe(0);
    expect(out.notes.join(' ')).toMatch(/SMS_DRY_RUN/);
  });

  it('آزمون، چیزی در صفِ واقعی نمی‌نویسد', async () => {
    await setSetting(db, 'store_name', 'ست‌شاپ');
    const before = (await db.query<{ n: string }>(`SELECT COUNT(*)::text AS n FROM sms_outbox`)).rows[0]!.n;
    const rec = recorder();
    const out = await sendSmsTest(db, await cfg(), { phone: '09121112233', templateKey: 'otp_login' }, rec.http);
    expect(typeof out.ok).toBe('boolean'); // رفتن/ردشدن مهم نیست؛ بی‌نوشته‌بودنِ صف مهم است
    const after = (await db.query<{ n: string }>(`SELECT COUNT(*)::text AS n FROM sms_outbox`)).rows[0]!.n;
    expect(after).toBe(before);
  });

  it('پالایش «فقط ایران» رویِ آزمون هم اجرا می‌شود (نه فقط رویِ کارگر)', async () => {
    await setSetting(db, 'store_name', 'ست‌شاپ');
    await db.query(`UPDATE sms_templates SET provider_template_id='T-TEST' WHERE key='order_paid'`);
    const rec = recorder();
    const out = await sendSmsTest(
      db,
      await cfg({ endpoints: { kavenegar: 'https://api.telegram.org' } }),
      { phone: '09121112233', templateKey: 'order_paid' },
      rec.http,
    );
    expect(out.ok).toBe(false);
    expect(out.error).toMatch(/فقط ایران/);
    expect(rec.calls.length).toBe(0);
  });
});
