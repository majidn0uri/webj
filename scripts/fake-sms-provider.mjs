#!/usr/bin/env node
/**
 * «سامانهٔ پیامکِ تقلبی» — برایِ آزمودنِ **کلِ مسیرِ پیامک** بی‌خریدِ اعتبار و بی‌اینترنتِ بین‌المللی.
 *
 * چرا لازم است؟ چون «پیامک وصل است» را با خواندنِ کد نمی‌شود باور کرد: باید یک
 * درخواستِ واقعی به یک سامانه برود و ردیفِ `sms_outbox` به `sent` برسد. این
 * سرور پاسخِ کاوه‌نگار/ملی‌پیامک/فراز را بازی می‌کند و هر درخواست را در
 * `var/fake-sms.log` می‌نویسد، تا ببینی **چه چیزی** واقعاً ارسال شده است.
 *
 * اجرا:
 *   node scripts/fake-sms-provider.mjs                # روی ۱۲۷.۰.۰.۱:۸۰۹۹
 *   FAKE_SMS_PORT=9100 node scripts/fake-sms-provider.mjs
 *
 * سپس به کارگر بگو اینجا را بزن (هر سه در محیط‌اند، نه در پنل — تا نتواند به
 * اشتباه رویِ سرورِ واقعی برود):
 *   SMS_ALLOW_INSECURE=1 \
 *   SMS_KAVENEGAR_URL=http://127.0.0.1:8099/v1 \
 *   npm run worker:once
 *
 * هر سه سامانه رویِ یک شنونده جواب می‌دهند؛ مسیرِ درخواست فرقی نمی‌کند. برایِ
 * دیدنِ مسیرِ «تلاشِ دوباره با فاصله»، متنِ پیام را با `FAIL` شروع کن: ۵۰۰
 * برمی‌گردد و پیامک در صف می‌ماند تا دورِ بعد.
 */
import { appendFileSync, mkdirSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const PORT = Number(process.env.FAKE_SMS_PORT ?? 8099);
const LOG = process.env.FAKE_SMS_LOG ?? fileURLToPath(new URL('../var/fake-sms.log', import.meta.url));
mkdirSync(dirname(LOG), { recursive: true });

let counter = 0;

/** پاسخِ هر سه سامانه، به شکلی که خودِ فرستنده‌ها انتظار دارند */
function replyFor(path, provider) {
  const ticket = `FAKE-${String(++counter).padStart(4, '0')}`;
  if (provider === 'meli') {
    return JSON.stringify({ Tickets: [ticket], Status: 'OK' });
  }
  if (provider === 'faraz') {
    return JSON.stringify({ ReturnStatus: [0], MessageID: [ticket] });
  }
  return JSON.stringify({ return: { statusCode: 200, entries: [{ ticket }] } });
}

const server = createServer((req, res) => {
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    const body = Buffer.concat(chunks).toString('utf8');
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    const provider = url.pathname.includes('meli') ? 'meli' : url.pathname.includes('faraz') ? 'faraz' : 'kavenegar';
    const fail = /FAIL/.test(body);
    const line = `${new Date().toISOString()} ${req.method} ${url.pathname} receptor=${url.searchParams.get('receptor') ?? (body.match(/receptor=([^&]*)/) ?? [])[1] ?? '?'} fail=${fail}\n  body: ${body.slice(0, 400)}\n`;
    appendFileSync(LOG, line);
    console.log(line.trimEnd());

    if (fail) {
      res.writeHead(500, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ return: { statusCode: 500, errorMessage: 'خطایِ ساختگیِ سرورِ تقلبی (FAIL در متن)' } }));
      return;
    }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(replyFor(url.pathname, provider));
  });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`سامانهٔ پیامکِ تقلبی روی 127.0.0.1:${PORT} — لاگ: ${LOG}`);
});
