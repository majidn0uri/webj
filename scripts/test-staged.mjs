#!/usr/bin/env node
/**
 * اجرایِ مرحله‌ایِ مجموعه‌آزمون برای دستگاه‌هایِ کم‌حافظه (۲ گیگابایت).
 *
 * چرا لازم است؟
 *   پایگاهِ حافظه‌ایِ آزمون‌ها (PGlite) یک نمونه‌یِ وب‌اسمبلیِ کاملِ Postgres است و
 *   برای هر نمونه حدود ۸۵۰ مگابایت «حافظه‌ی مقیم» (RSS) می‌گیرد. روی دستگاهی که
 *   فقط حدود ۱ گیگابایت آزاد دارد، اجرایِ یک‌باره‌یِ کلِ مجموعه کارگر را با
 *   کشنده‌یِ کمبودِ حافظه (SIGKILL/کد ۱۳۷) از کار می‌اندازد: آزمون‌ها سالم‌اند،
 *   ولی فرآیند جا نمی‌شود. این اسکریپت هر فایل را در دسته‌هایِ کوچک (پیش‌فرض
 *   دو آزمون) در یک فرآیندِ تازه اجرا می‌کند تا حافظه پس از هر دسته آزاد شود،
 *   و هر دسته‌یِ ناموفق را آزمون‌به‌آزمون دوباره می‌کوشد.
 *
 * شیوه‌یِ استفاده:
 *   node scripts/test-staged.mjs                      # همه‌یِ فایل‌ها
 *   node scripts/test-staged.mjs packages/cart        # یک بسته
 *   node scripts/test-staged.mjs packages/cart/src/cart.test.ts 3   # دسته‌هایِ ۳تایی
 *
 * خروجی: شمارِ آزمون‌هایِ موفق در هر فایل، و در پایان کدِ ۰ (همه سبز) یا ۱.
 */

import { spawn } from 'node:child_process';
import { readdir, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';

const ROOT = process.cwd();
const BATCH = Number(process.argv[3] ?? 2) || 2;

/** یک اجرایِ ویتست را انجام می‌دهد و خروجی‌اش را برمی‌گرداند */
function runVitest(target, pattern) {
  return new Promise((resolve) => {
    const args = ['vitest', 'run', target, '--pool=forks', '--maxWorkers=1'];
    if (pattern) args.push('-t', pattern);
    const started = Date.now();
    const child = spawn('npx', args, { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    child.stdout.on('data', (d) => (out += d.toString()));
    child.stderr.on('data', (d) => (out += d.toString()));
    child.on('close', (code) => {
      const m = out.match(/Tests\s+(\d+)\s+passed/);
      resolve({
        code,
        passed: m ? Number(m[1]) : 0,
        seconds: Math.round((Date.now() - started) / 1000),
        out,
      });
    });
  });
}

/** عنوان‌هایِ آزمون را از متنِ فایل می‌خواند (بدون اجرایِ آن) */
function testTitles(source) {
  return [...source.matchAll(/^\s*it\(\s*'((?:[^'\\]|\\.)*)'\s*,/gm)].map((m) =>
    m[1].replace(/\\'/g, "'"),
  );
}

async function testFiles(dir) {
  const found = [];
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...(await testFiles(full)));
    else if (entry.name.endsWith('.test.ts') || entry.name.endsWith('.test.tsx')) found.push(full);
  }
  return found;
}

async function runFile(file) {
  const source = await readFile(file, 'utf8');
  const titles = testTitles(source);
  const target = relative(ROOT, file);

  // فایل‌هایی که آزمونِ همگامِ ساده دارند (بدون پایگاه) یک‌باره اجرا می‌شوند
  if (titles.length === 0) {
    const r = await runVitest(target, null);
    return { passed: r.passed, failed: r.code === 0 ? 0 : 1, crashed: r.code !== 0 };
  }

  let passed = 0;
  const retry = [];
  for (let i = 0; i < titles.length; i += BATCH) {
    const group = titles.slice(i, i + BATCH);
    const pattern = group.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
    const r = await runVitest(target, pattern);
    if (r.code === 0) {
      passed += r.passed;
      process.stdout.write(`   ✓ ${r.passed} آزمون (${r.seconds} ثانیه)\n`);
    } else {
      // کارگر کشته شده (کمبودِ حافظه) یا آزمونی واقعاً شکست خورده؟
      const crashed = /Worker exited unexpectedly/.test(r.out);
      passed += r.passed;
      if (crashed) retry.push(...group.slice(r.passed));
      else retry.push(...group);
      process.stdout.write(
        `   ${crashed ? '⛔ کارگر کم آورد' : '✗ شکست'} — ${r.passed}/${group.length} (${r.seconds} ثانیه)\n`,
      );
    }
  }

  // تلاشِ دوباره، این بار یکی‌یکی
  for (const title of new Set(retry)) {
    const r = await runVitest(target, title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    if (r.code === 0) {
      passed += r.passed;
      process.stdout.write(`   ✓ تلاشِ دوباره: ${title.slice(0, 46)}\n`);
    } else {
      process.stdout.write(`   ✗ ${title.slice(0, 46)}\n`);
      const lines = r.out.split('\n').filter((l) => /AssertionError|Error:/.test(l)).slice(0, 2);
      for (const l of lines) process.stdout.write(`      ${l.trim().slice(0, 110)}\n`);
    }
  }
  return { passed, failed: 0 };
}

const arg = process.argv[2];
const files = arg
  ? arg.endsWith('.ts')
    ? [join(ROOT, arg)]
    : await testFiles(join(ROOT, arg))
  : [...(await testFiles(join(ROOT, 'packages'))), ...(await testFiles(join(ROOT, 'apps')))];

const started = Date.now();
let total = 0;
let bad = 0;
for (const file of files) {
  const name = relative(ROOT, file);
  process.stdout.write(`\n▸ ${name}\n`);
  const r = await runFile(file);
  total += r.passed;
  if (r.crashed) bad += 1;
}
const minutes = ((Date.now() - started) / 60000).toFixed(1);
process.stdout.write(`\n══════════════════════════════\n`);
process.stdout.write(`جمع: ${total} آزمونِ موفق در ${files.length} فایل — ${minutes} دقیقه\n`);
process.exit(bad === 0 ? 0 : 1);
