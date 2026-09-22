import type { Database, Queryable } from './client.js';

/**
 * الگوی Outbox (بخش Q-8):
 * نوشتنِ رخداد در همان تراکنشِ تغییرِ داده، و ارسالِ آن بعداً توسط یک کارگرِ جداگانه.
 * فایده: اگر فرستادنِ پیامک/اعلان/همگام‌سازی شکست بخورد، تراکنشِ اصلی از بین نمی‌رود
 * و رخداد بعداً دوباره تلاش می‌شود (با فاصله‌ی زمانیِ فزاینده).
 */

export interface OutboxEvent {
  id: string;
  aggregate: string;
  aggregate_id: string;
  event_type: string;
  payload: Record<string, unknown>;
  schema_version: number;
  attempts: number;
}

export interface OutboxHandler {
  (event: OutboxEvent): Promise<void>;
}

/** درجِ رخداد در همان تراکنشِ کاری — این مهم‌ترین نکته‌ی الگو است */
export async function publishEvent(
  tx: Queryable,
  event: { aggregate: string; aggregateId: string; eventType: string; payload: unknown; schemaVersion?: number },
): Promise<void> {
  await tx.query(
    `INSERT INTO outbox_events (aggregate, aggregate_id, event_type, payload, schema_version)
     VALUES ($1, $2, $3, $4::jsonb, $5)`,
    [
      event.aggregate,
      event.aggregateId,
      event.eventType,
      JSON.stringify(event.payload ?? {}),
      event.schemaVersion ?? 1,
    ],
  );
}

export interface ProcessOptions {
  batchSize?: number;
  maxAttempts?: number;
  /** پایه‌ی فاصله‌ی زمانیِ فزاینده بر حسب ثانیه */
  backoffBaseSeconds?: number;
}

export interface ProcessResult {
  processed: number;
  succeeded: number;
  failed: number;
}

/** پردازشِ یک دسته از رخدادهایِ ارسال‌نشده */
export async function processOutboxBatch(
  db: Database,
  handler: OutboxHandler,
  opts: ProcessOptions = {},
): Promise<ProcessResult> {
  const { batchSize = 50, maxAttempts = 8, backoffBaseSeconds = 30 } = opts;

  const { rows } = await db.query<OutboxEvent>(
    `SELECT id, aggregate, aggregate_id, event_type, payload, schema_version, attempts
       FROM outbox_events
      WHERE sent_at IS NULL AND available_at <= now()
      ORDER BY created_at
      LIMIT $1
      FOR UPDATE SKIP LOCKED`,
    [batchSize],
  );

  let succeeded = 0;
  let failed = 0;

  for (const event of rows) {
    try {
      await handler(event);
      await db.query(`UPDATE outbox_events SET sent_at = now(), attempts = attempts + 1 WHERE id = $1`, [
        event.id,
      ]);
      succeeded++;
    } catch (error) {
      failed++;
      const attempts = event.attempts + 1;
      const delay = Math.min(backoffBaseSeconds * 2 ** (attempts - 1), 24 * 3600);
      await db.query(
        `UPDATE outbox_events
            SET attempts = $2,
                available_at = now() + ($3 || ' seconds')::interval,
                payload = payload || jsonb_build_object('last_error', $4::text)
          WHERE id = $1`,
        [event.id, attempts, String(delay), String((error as Error).message ?? 'خطای ناشناخته')],
      );
      if (attempts >= maxAttempts) {
        // بعد از حدِ مجاز، رخداد به صفِ مرده می‌رود تا دستی بررسی شود (بخش S)
        await db.query(
          `UPDATE outbox_events SET payload = payload || jsonb_build_object('dead', true) WHERE id = $1`,
          [event.id],
        );
      }
    }
  }

  return { processed: rows.length, succeeded, failed };
}

/** کارگرِ دوره‌ای — در فاز بعد با یک زمان‌سنجِ توزیع‌شده (Valkey) جایگزین می‌شود */
export function startOutboxWorker(
  db: Database,
  handler: OutboxHandler,
  opts: ProcessOptions & { pollIntervalMs?: number } = {},
): { stop: () => void } {
  const intervalMs = opts.pollIntervalMs ?? 5_000;
  const timer = setInterval(() => {
    void processOutboxBatch(db, handler, opts).catch((e) => console.error('خطای کارگرِ outbox:', e));
  }, intervalMs);
  timer.unref?.();
  return { stop: () => clearInterval(timer) };
}
