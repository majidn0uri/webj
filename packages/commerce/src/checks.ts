import type { Queryable } from '@set/db';
import { AppError, type Rial, formatToman } from '@set/shared-kernel';
import { nextDocumentNumber, type DocumentPrefix } from './numbering.js';

/**
 * مدیریتِ چک — BR-33 تا BR-37 , BR-46
 *
 * سه خط قرمز:
 *   ۱) چک فقط از همکار (BR-33)
 *   ۲) چک پول نقد نیست (BR-35) — در صندوقِ روزانه نمی‌آید، «طلب از مشتری» است
 *   ۳) سقفِ چکِ باز (BR-36) و سقفِ صفر بعد از برگشت (BR-37)
 *
 * هر تغییرِ وضعیت در check_status_logs ثبت می‌شود (BR-62).
 */

export type CheckStatus =
  | 'in_circulation' // در جریان
  | 'deposited' // سپرده به بانک
  | 'settled' // وصول‌شده
  | 'transferred' // خرج‌شده (تهاتر)
  | 'bounced' // برگشتی
  | 'void'; // ابطال با دلیل (BR-61)

export interface Check {
  id: string;
  check_no: string;
  sayad_no: string;
  bank: string;
  amount_rial: string;
  due_date: string;
  drawer_id: string;
  status: CheckStatus;
  document_type: 'FS' | 'SO' | null;
  document_id: string | null;
}

/** وضعیت‌هایی که چک هنوز «باز/وصول‌نشده» است — مبنای محاسبه‌ی سقف (BR-36) */
const OPEN_STATUSES: CheckStatus[] = ['in_circulation', 'deposited'];

export interface RegisterCheckInput {
  checkNo: string;
  sayadNo: string;
  bank: string;
  amountRial: Rial;
  dueDate: Date;
  drawerId: string;
  documentType?: 'FS' | 'SO' | null;
  documentId?: string | null;
  imageUrl?: string | null;
  actorId?: string | null;
  branchId?: string | null;
}

export interface CheckCeiling {
  /** مجموعِ مبالغِ چک‌های وصول‌نشده */
  openRial: bigint;
  /** سقفِ مصوبِ این همکار */
  ceilingRial: bigint;
  /** آیا چکِ جدید به این مبلغ مجاز است؟ */
  allowed: boolean;
  /** مقدارِ باقی‌مانده تا سقف */
  remainingRial: bigint;
  /** دلیلِ محدودیت (اگر مجاز نباشد) */
  reason: string | null;
}

/** محاسبه‌ی سقفِ چکِ بازِ یک همکار (BR-36 , BR-37) */
export async function checkCeiling(
  db: Queryable,
  customerId: string,
  amountRial: Rial = 0n,
): Promise<CheckCeiling> {
  const { rows: cust } = await db.query<{
    is_partner: boolean;
    check_ceiling_rial: string;
    full_name: string;
  }>(`SELECT is_partner, check_ceiling_rial::text, full_name FROM customers WHERE id = $1`, [
    customerId,
  ]);
  const c = cust[0];
  if (!c) throw new AppError('NOT_FOUND', { message: 'مشتری یافت نشد' });

  // BR-33: چک فقط از همکار
  if (!c.is_partner) {
    return {
      openRial: 0n,
      ceilingRial: 0n,
      allowed: false,
      remainingRial: 0n,
      reason: 'دریافتِ چک فقط از مشتریِ همکار مجاز است',
    };
  }

  // BR-37: چک برگشتیِ تسویه‌نشده یعنی سقف صفر
  const { rows: bounced } = await db.query<{ cnt: string }>(
    `SELECT COUNT(*)::text AS cnt FROM checks WHERE drawer_id = $1 AND status = 'bounced'`,
    [customerId],
  );
  if (Number(bounced[0]?.cnt ?? 0) > 0) {
    return {
      openRial: await openChecksTotal(db, customerId),
      ceilingRial: 0n,
      allowed: false,
      remainingRial: 0n,
      reason: 'این همکار چکِ برگشتیِ تسویه‌نشده دارد؛ تا تسویه، سقفِ چک صفر است',
    };
  }

  const { rows } = await db.query<{ total: string | null }>(
    `SELECT SUM(amount_rial)::text AS total
       FROM checks
      WHERE drawer_id = $1 AND status = ANY($2)`,
    [customerId, OPEN_STATUSES],
  );
  const openRial = BigInt(rows[0]?.total ?? '0');
  const ceilingRial = BigInt(c.check_ceiling_rial);
  const remaining = ceilingRial - openRial;
  const amount = BigInt(amountRial);

  if (ceilingRial === 0n) {
    return {
      openRial,
      ceilingRial,
      allowed: false,
      remainingRial: 0n,
      reason: 'سقفِ چکِ این همکار صفر است (پیش‌فرض تا تعیینِ مدیر)',
    };
  }

  return {
    openRial,
    ceilingRial,
    allowed: amount <= remaining,
    remainingRial: remaining < 0n ? 0n : remaining,
    reason:
      amount > remaining
        ? `جمعِ چک‌های باز (${openRial}) به‌علاوه‌ی این مبلغ از سقفِ ${ceilingRial} ریال بیشتر است`
        : null,
  };
}

async function openChecksTotal(db: Queryable, customerId: string): Promise<bigint> {
  const { rows } = await db.query<{ total: string | null }>(
    `SELECT SUM(amount_rial)::text AS total FROM checks
      WHERE drawer_id = $1 AND status = ANY($2)`,
    [customerId, OPEN_STATUSES],
  );
  return BigInt(rows[0]?.total ?? '0');
}

/** ثبتِ چک — با کنترلِ سقف پیش از درج (BR-36) */
export async function registerCheck(db: Queryable, input: RegisterCheckInput): Promise<Check> {
  const ceiling = await checkCeiling(db, input.drawerId, input.amountRial);
  if (!ceiling.allowed) {
    throw new AppError('CONFLICT', {
      message: ceiling.reason ?? 'ثبتِ چک مجاز نیست',
    });
  }

  const number = await nextDocumentNumber(db, 'CH' as DocumentPrefix);
  const { rows } = await db.query<Check>(
    `INSERT INTO checks
       (check_no, sayad_no, bank, amount_rial, due_date, drawer_id, status,
        document_type, document_id, image_url, branch_id, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,'in_circulation',$7,$8,$9,$10,$11)
     RETURNING *`,
    [
      input.checkNo,
      input.sayadNo,
      input.bank,
      input.amountRial.toString(),
      input.dueDate.toISOString().slice(0, 10),
      input.drawerId,
      input.documentType ?? null,
      input.documentId ?? null,
      input.imageUrl ?? null,
      input.branchId ?? null,
      input.actorId ?? null,
    ],
  );
  const check = rows[0];
  if (!check) throw new AppError('INTERNAL', { message: 'ثبتِ چک ناموفق بود' });

  await logCheckStatus(db, {
    checkId: check.id,
    toStatus: 'in_circulation',
    actorId: input.actorId ?? null,
    reason: `سندِ ${input.documentType ?? '—'} | سقفِ مجاز پس از ثبت: ${
      ceiling.remainingRial - BigInt(input.amountRial)
    } ریال`,
  });

  return check;
}

export async function logCheckStatus(
  db: Queryable,
  input: { checkId: string; toStatus: CheckStatus; actorId?: string | null; reason?: string | null },
  fromStatus?: CheckStatus | null,
): Promise<void> {
  await db.query(
    `INSERT INTO check_status_logs (check_id, from_status, to_status, reason, actor_id)
     VALUES ($1,$2,$3,$4,$5)`,
    [input.checkId, fromStatus ?? null, input.toStatus, input.reason ?? null, input.actorId ?? null],
  );
}

export async function changeCheckStatus(
  db: Queryable,
  input: { checkId: string; toStatus: CheckStatus; actorId?: string | null; reason?: string | null },
): Promise<Check> {
  const { rows: before } = await db.query<Check>(`SELECT * FROM checks WHERE id = $1`, [
    input.checkId,
  ]);
  const current = before[0];
  if (!current) throw new AppError('NOT_FOUND', { message: 'چک یافت نشد' });

  validateTransition(current.status, input.toStatus);

  const { rows } = await db.query<Check>(
    `UPDATE checks SET status = $1, updated_at = now(),
            transferred_at = CASE WHEN $1 = 'transferred' THEN now() ELSE transferred_at END,
            void_reason = CASE WHEN $1 = 'void' THEN $2 ELSE void_reason END
      WHERE id = $3 RETURNING *`,
    [input.toStatus, input.reason ?? null, input.checkId],
  );

  await logCheckStatus(db, {
    checkId: input.checkId,
    toStatus: input.toStatus,
    actorId: input.actorId ?? null,
    reason: input.reason ?? null,
  }, current.status);

  // پیامک برگشت چک
  if (input.toStatus === 'bounced') {
    try {
      const { enqueueSms } = await import('./sms.js');
      const { rows: drawer } = await db.query<{ full_name: string | null; phone: string | null }>(
        `SELECT c.full_name, c.phone FROM customers c WHERE c.id = $1`, [current.drawer_id],
      );
      if (drawer[0]?.phone) {
        const { rows: settings } = await db.query<{ value: string }>(
          `SELECT value FROM store_settings WHERE key = 'store_phone'`, [],
        );
        await enqueueSms(db, {
          phone: drawer[0].phone,
          templateKey: 'check_bounced',
          vars: { check: current.check_no, phone: settings[0]?.value ?? '' },
        });
      }
    } catch { /* پیامک نباید تغییر وضعیت را متوقف کند */ }
  }

  return rows[0]!;
}

function validateTransition(from: CheckStatus, to: CheckStatus): void {
  const allowed: Record<CheckStatus, CheckStatus[]> = {
    in_circulation: ['deposited', 'settled', 'transferred', 'bounced', 'void'],
    deposited: ['settled', 'bounced'],
    settled: [],
    transferred: ['bounced', 'settled'], // اگر چکِ خرج‌شده برگشت خورد
    bounced: ['settled', 'void'],
    void: [],
  };
  if (!allowed[from].includes(to)) {
    throw new AppError('CONFLICT', {
      message: `تغییرِ وضعیت از «${LABEL[from]}» به «${LABEL[to]}» مجاز نیست`,
    });
  }
}

export const LABEL: Record<CheckStatus, string> = {
  in_circulation: 'در جریان',
  deposited: 'سپرده به بانک',
  settled: 'وصول‌شده',
  transferred: 'خرج‌شده',
  bounced: 'برگشتی',
  void: 'ابطال‌شده',
};

/**
 * تهاتر (خرجِ چک): واگذاریِ چکِ مشتری به فروشنده (بخش ۷ سند)
 * بدهیِ فروشنده به اندازه‌ی مبلغِ چک تسویه می‌شود و مازاد «اعتبار نزد فروشنده» است.
 */
export async function transferCheck(
  db: Queryable,
  input: { checkId: string; toParty: string; actorId?: string | null },
): Promise<{ check: Check; appliedRial: bigint; surplusRial: bigint }> {
  const { rows } = await db.query<Check>(`SELECT * FROM checks WHERE id = $1`, [input.checkId]);
  const current = rows[0];
  if (!current) throw new AppError('NOT_FOUND', { message: 'چک یافت نشد' });
  if (current.status !== 'in_circulation') {
    throw new AppError('CONFLICT', { message: 'تنها چکِ «در جریان» قابل واگذاری است' });
  }

  const check = await changeCheckStatus(db, {
    checkId: input.checkId,
    toStatus: 'transferred',
    actorId: input.actorId ?? null,
    reason: `واگذاری به ${input.toParty}`,
  });

  await db.query(`UPDATE checks SET transferred_to = $1 WHERE id = $2`, [
    input.toParty,
    input.checkId,
  ]);

  const amount = BigInt(current.amount_rial);
  return { check, appliedRial: amount, surplusRial: 0n };
}

export async function listChecks(
  db: Queryable,
  filter: { drawerId?: string; status?: CheckStatus; dueBefore?: Date } = {},
): Promise<Check[]> {
  const conditions: string[] = ['true'];
  const params: unknown[] = [];
  let i = 1;

  if (filter.drawerId) {
    conditions.push(`drawer_id = $${i++}`);
    params.push(filter.drawerId);
  }
  if (filter.status) {
    conditions.push(`status = $${i++}`);
    params.push(filter.status);
  }
  if (filter.dueBefore) {
    conditions.push(`due_date <= $${i++}`);
    params.push(filter.dueBefore.toISOString().slice(0, 10));
  }

  const { rows } = await db.query<Check>(
    `SELECT * FROM checks WHERE ${conditions.join(' AND ')} ORDER BY due_date`,
    params,
  );
  return rows;
}

/**
 * یادآوری سررسید چک‌ها — باید به صورت cron job اجرا شود.
 * چک‌هایی که سررسیدشان فردا است و هنوز تسویه نشده‌اند.
 */
export async function sendCheckDueReminders(db: Queryable): Promise<{ sent: number }> {
  const { enqueueSms } = await import('./sms.js');

  // فردا
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const dueDateStr = tomorrow.toISOString().slice(0, 10);

  const { rows } = await db.query<{
    id: string; check_no: string; amount_rial: string; due_date: string;
    phone: string | null; full_name: string | null;
  }>(
    `SELECT c.id, c.check_no, c.amount_rial::text, c.due_date,
            cu.phone, cu.full_name
       FROM checks c
       JOIN customers cu ON cu.id = c.drawer_id
      WHERE c.due_date = $1
        AND c.status IN ('in_circulation', 'deposited')
        AND cu.phone IS NOT NULL`,
    [dueDateStr],
  );

  let sent = 0;
  for (const row of rows) {
    try {
      await enqueueSms(db, {
        phone: row.phone!,
        templateKey: 'check_due',
        vars: {
          check: row.check_no,
          amount: formatToman(BigInt(row.amount_rial)),
          date: row.due_date,
        },
      });
      sent++;
    } catch { /* خطا در یک چک نباید بقیه را متوقف کند */ }
  }

  return { sent };
}
