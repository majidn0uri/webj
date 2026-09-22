import { createHmac, randomBytes } from 'node:crypto';

/**
 * رمز یکبارمصرفِ زمان‌محور (RFC 6238) — پیاده‌سازیِ مستقیم با Node، بدون وابستگی خارجی.
 * کاربرد: ورودِ دو مرحله‌ای برای کاربرانِ پنل (مدیر، حسابدار، انباردار).
 */
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(buffer: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buffer) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(input: string): Buffer {
  const clean = input.toUpperCase().replace(/[=\s]/g, '');
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const ch of clean) {
    const idx = ALPHABET.indexOf(ch);
    if (idx === -1) throw new Error('نویسه‌ی نامعتبر در Base32');
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

export function generateSecret(bytes = 20): string {
  return base32Encode(randomBytes(bytes));
}

function hotp(secret: Buffer, counter: number, digits = 6): string {
  const buf = Buffer.alloc(8);
  buf.writeUInt32BE(Math.floor(counter / 2 ** 32), 0);
  buf.writeUInt32BE(counter % 2 ** 32, 4);
  const hmac = createHmac('sha1', secret).update(buf).digest();
  const offset = hmac[hmac.length - 1]! & 0x0f;
  const code =
    (((hmac[offset]! & 0x7f) << 24) |
      ((hmac[offset + 1]! & 0xff) << 16) |
      ((hmac[offset + 2]! & 0xff) << 8) |
      (hmac[offset + 3]! & 0xff)) %
    10 ** digits;
  return code.toString().padStart(digits, '0');
}

export function totp(secretBase32: string, at: Date = new Date(), step = 30, digits = 6): string {
  const counter = Math.floor(at.getTime() / 1000 / step);
  return hotp(base32Decode(secretBase32), counter, digits);
}

/**
 * تأیید با پنجره‌ی زمانی (پیش‌فرض ±۱ بازه‌ی ۳۰ ثانیه‌ای) برای جبرانِ ناهمزمانیِ ساعتِ دستگاه.
 * مقایسه با زمانِ ثابت انجام می‌شود تا نشتِ اطلاعات از طریقِ زمانِ پاسخ نداشته باشیم.
 */
export function verifyTotp(
  secretBase32: string,
  code: string,
  opts: { window?: number; step?: number; at?: Date } = {},
): boolean {
  const { window = 1, step = 30, at = new Date() } = opts;
  const normalized = code.replace(/\D/g, '');
  for (let i = -window; i <= window; i++) {
    const candidate = totp(secretBase32, new Date(at.getTime() + i * step * 1000), step);
    if (candidate.length === normalized.length && timingSafeEqualStr(candidate, normalized)) {
      return true;
    }
  }
  return false;
}

function timingSafeEqualStr(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export function provisioningUri(opts: {
  issuer: string;
  account: string;
  secret: string;
}): string {
  const label = encodeURIComponent(`${opts.issuer}:${opts.account}`);
  const params = new URLSearchParams({
    secret: opts.secret,
    issuer: opts.issuer,
    algorithm: 'SHA1',
    digits: '6',
    period: '30',
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}
