#!/usr/bin/env node
/**
 * شمارشِ آزمون‌ها به‌ازایِ هر پرونده — برایِ این‌که عددِ مستندات، عددِ اجرا باشد.
 *
 * چرا این اسکریپت لازم شد؟ چون یک بررسیِ بیرونی RIGHT به‌درستی گفت که
 * README چهار جمعِ مختلف دارد (۵۱۹، ۲۷۳، ۱۱۰، ۳۲۷) و هیچ‌کدام با واقعیت
 * نمی‌خواند. دست‌کاریِ عدد در جدول، همان دردی را دارد که درمان می‌کند: سه
 * هفته بعد دوباره کهنه می‌شود. راهِ درست، عددی است که **تولید** شود — این
 * اسکریپت vitest را با گزارشگرِ JSON می‌راند و همان جدولی را می‌چاپد که در
 * README می‌بینید، با شمارشِ خودِ چارچوبِ آزمون (نه شمردنِ نوشتاریِ `it(`،
 * که `it.each` را یک دانه می‌شمارد و دروغ می‌گوید).
 *
 * اجرا:  node scripts/test-summary.mjs [--json] [-- <vitest flags>]
 *
 * نکته: با وب و API بالا این اسکریپت ممکن است به کمبودِ حافظه بخورد؛ در آن
 * حالت سرویس‌ها را موقتاً بخوابانید (یا --maxWorkers=1 بدهید).
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
const argi = process.argv.slice(2);
const asJson = argi.includes('--json');
const dash = argi.indexOf('--');
const extra = dash === -1 ? [] : argi.slice(dash + 1);
const workers = extra.length ? extra : ['--maxWorkers=2'];

const outDir = mkdtempSync(join(tmpdir(), 'set-summary-'));
const outFile = join(outDir, 'vitest.json');

const result = spawnSync(
  join(ROOT, 'node_modules/.bin/vitest'),
  ['run', '--reporter=json', `--outputFile=${outFile}`, ...workers],
  { cwd: ROOT, stdio: ['ignore', 'inherit', 'inherit'] },
);

let report;
try {
  report = JSON.parse(readFileSync(outFile, 'utf8'));
} catch {
  console.error('خروجیِ JSONِ آزمون‌ها خوانده نشد (شاید اجرا کامل نشده باشد).');
  rmSync(outDir, { recursive: true, force: true });
  process.exit(result.status || 1);
}
rmSync(outDir, { recursive: true, force: true });

/** شمارش از خودِ چارچوب: هر assertionResult یک آزمونِ اجراشده است */
const rows = (report.testResults ?? [])
  .map((file) => ({
    file: relative(ROOT, file.name ?? '').replace(/\\/g, '/'),
    count: (file.assertionResults ?? []).length,
    failed: (file.assertionResults ?? []).filter((t) => t.status === 'failed').length,
  }))
  .filter((row) => row.count > 0)
  .sort((a, b) => a.file.localeCompare(b.file));

const total = rows.reduce((sum, r) => sum + r.count, 0);
const failed = rows.reduce((sum, r) => sum + r.failed, 0);

if (asJson) {
  console.log(JSON.stringify({ files: rows.length, tests: total, failed, rows }, null, 2));
} else {
  for (const row of rows) {
    const mark = row.failed ? ` ← ${row.failed} ناکام` : '';
    console.log(`${String(row.count).padStart(4)}  ${row.file}${mark}`);
  }
  console.log('─'.repeat(60));
  console.log(
    `مجموع: ${total} آزمون در ${rows.length} پرونده` +
      (failed ? ` — ${failed} ناکام` : '، همه سبز'),
  );
  console.log('این عدد را در README و `docs/pishraft.md` به کار ببرید؛');
  console.log('جدولِ دستی که بازتولید نشود، سه هفته بعد دروغ می‌گوید.');
}

process.exit(failed || result.status ? 1 : 0);
