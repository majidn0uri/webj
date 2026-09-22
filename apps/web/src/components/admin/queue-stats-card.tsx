'use client';

import { useState } from 'react';

/** سطلِ ساعتیِ صف — همان چیزی که `smsStats` از پایگاه می‌آورد */
export interface StatsBucket {
  hour: number;
  enqueued: number;
  sent: number;
  failed: number;
  dead: number;
}

export interface SmsStats {
  hours: number;
  buckets: StatsBucket[];
  totals: { enqueued: number; sent: number; failed: number; dead: number };
  /** درایورِ تولید (pg) رشته می‌دهد نه Date؛ پس رشته خوانده و با Intl ساخته می‌شود */
  lastSentAt: string | null;
  lastAttemptAt: string | null;
  dueNow: number;
  inBackoff: number;
  staleAfterMinutes: number;
  minutesSinceActivity: number | null;
  workerLooksStalled: boolean;
  reason: string | null;
  stuckDead: number;
  /** سیاستِ نگهداری (روز)؛ ۰ یعنی «هرگز پاک نشود» */
  retention: { smsOutboxDays: number; auditLogDays: number; observabilityDays: number };
  /** چند پیامکِ تمام‌شده مهلتِ نگهداری‌اش را رد کرده است */
  purgeable: number;
}

const faNum = new Intl.NumberFormat('fa-IR');

function fmtMinute(mins: number): string {
  if (mins < 60) return `${faNum.format(mins)} دقیقه`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m === 0
    ? `${faNum.format(h)} ساعت`
    : `${faNum.format(h)} ساعت و ${faNum.format(m)} دقیقه`;
}

const TZ = 'Asia/Tehran';

/** ساعتِ سطل، با همان تقویمی که کلِ پنل نشان می‌دهد (جلالی) */
function hourLabel(epochSeconds: number): string {
  const d = new Date(epochSeconds * 1000);
  try {
    return new Intl.DateTimeFormat('fa-IR', { hour: '2-digit', timeZone: TZ }).format(d);
  } catch {
    return String(d.getHours()).padStart(2, '0');
  }
}

function dayLabel(epochSeconds: number): string {
  const d = new Date(epochSeconds * 1000);
  try {
    return new Intl.DateTimeFormat('fa-IR', { month: 'long', day: 'numeric', timeZone: TZ }).format(d);
  } catch {
    return d.toLocaleDateString('fa-IR');
  }
}

function sentLabel(iso: string): string {
  try {
    return new Intl.DateTimeFormat('fa-IR', {
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      timeZone: TZ,
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

/**
 * کارتِ «کارگرِ صف خوابیده؟».
 *
 * چرا لازم بود؟ «چرا پیامک نمی‌رسد؟» (readiness) خانه‌هایِ خالیِ تنظیمات را
 * می‌گوید، اما بدترینِ حالت را نه: تنظیمات کامل است، صف پُر است و **هیچ‌کس صف
 * را نمی‌فرستد** چون تایمرِ systemd از کار افتاده یا سرورِ کارگر خاموش است. آن
 * حالت بی‌این کارت هیچ نشانه‌ای نداشت — فقط پیامک‌هایی که هرگز نمی‌رسیدند.
 *
 * نمودار عمداً با کتابخانهٔ SVG ساخته نشده: `div`هایِ انعطاف‌پذیر. یک
 * کتابخانهٔ نمودار هم حجمِ CSS/JS اضافه می‌کند و هم وسوسهٔ CDN؛ هر دو در این
 * پروژه ممنوع‌اند و نتیجه رویِ مودمِ داخلی هم دُیر باز می‌شود.
 */
export function QueueStatsCard({
  stats,
  onDiagnose,
}: {
  stats: SmsStats;
  onDiagnose: () => void;
}) {
  const [open, setOpen] = useState(false);
  const buckets = stats.buckets;
  const peak = Math.max(1, ...buckets.map((b) => b.enqueued));

  // برچسبِ روز برایِ محور: روزها رویِ هم ادغام می‌شوند تا زیرِ ۱۶۸ سطل محور
  // خوانا بماند (۲۴ برچسبِ تکراری هیچ اطلاعاتی نمی‌دهد)
  const dayCount = new Map<string, number>();
  for (const b of buckets) {
    const k = dayLabel(b.hour);
    dayCount.set(k, (dayCount.get(k) ?? 0) + 1);
  }
  const axis = buckets.map((b, i) => {
    const k = dayLabel(b.hour);
    const first = i === 0 || dayLabel(buckets[i - 1]!.hour) !== k;
    return first ? { label: k, span: dayCount.get(k) ?? 1 } : null;
  });

  const state = stats.workerLooksStalled
    ? { cls: 'pill pill--danger', text: 'کارگرِ صف خوابیده به‌نظر می‌رسد' }
    : stats.dueNow > 0
      ? { cls: 'pill pill--warn', text: `${faNum.format(stats.dueNow)} پیام در نوبت است` }
      : stats.inBackoff > 0
        ? {
            cls: 'pill pill--warn',
            text: `همه در مهلتِ تلاشِ دوباره (${faNum.format(stats.inBackoff)})`,
          }
        : { cls: 'pill pill--ok', text: 'صف بی‌کار است' };

  const legend = [
    { key: 'sent', label: 'فرستاده‌شده', color: '#1a9f4f' },
    { key: 'waiting', label: 'در نوبت', color: '#9aa3c0' },
    { key: 'failed', label: 'ناموفق', color: '#e6a700' },
    { key: 'dead', label: 'ناامیدکننده', color: '#d9342c' },
  ];

  const gridCols: React.CSSProperties = {
    display: 'grid',
    gridTemplateColumns: `repeat(${Math.max(1, buckets.length)}, minmax(0, 1fr))`,
    gap: 3,
  };

  return (
    <section className="panel u-mb-3" >
      <div className="panel__head">
        <h2 className="panel__title">پایشِ صف</h2>
        <span className={state.cls}>{state.text}</span>
        <button
          type="button"
          className="btn btn--ghost btn--xs u-ml-auto"
          
          onClick={() => setOpen((v) => !v)}
        >
          {open ? 'بستنِ راهنما' : 'چطور بخوانمش؟'}
        </button>
      </div>

      {stats.reason && (
        <div className="alert alert--danger u-mb-3" >
          {stats.reason}
          {stats.stuckDead > 0 && (
            <>
              {' '}
              <button type="button" className="btn btn--ghost btn--xs" onClick={onDiagnose}>
                بازگرداندنِ صف
              </button>
            </>
          )}
        </div>
      )}

      <div className="u-flex u-flex-wrap u-gap-2 u-mb-3">
        <span className="pill">
          آخرینِ ارسال: <span className="num">{stats.lastSentAt ? sentLabel(stats.lastSentAt) : '—'}</span>
        </span>
        <span className="pill" title="هر تلاشی — موفق یا ناموفق — کارگر را زنده نشان می‌دهد">
          آخرینِ تکانهٔ صف: <span className="num">{stats.minutesSinceActivity === null ? '—' : `${fmtMinute(stats.minutesSinceActivity)} پیش`}</span>
        </span>
        <span
          className="pill"
          title={`بیش از ${stats.staleAfterMinutes} دقیقه سکوت = هشدار؛ از تنظیمات ← پیامک قابل تغییر است`}
        >
          مهلتِ سکوت: <span className="num">{faNum.format(stats.staleAfterMinutes)}</span> دقیقه
        </span>
        <span
          className="pill"
          title="پیامک‌هایِ تمام‌شده پس ازِ مهلتِ نگهداری پاک می‌شوند؛ صفِ زنده هرگز. هرچه این فهرست کهنه‌تر بماند، صفحهٔ صندوق کُندتر است."
        >
          نگهداریِ پیامک: <span className="num">{faNum.format(stats.retention.smsOutboxDays)}</span> روز ·{' '}
          <span className="num">{faNum.format(stats.purgeable)}</span> موردِ آمادهٔ پاک‌سازی
        </span>
      </div>

      <div dir="rtl" style={{ ...gridCols, alignItems: 'end', height: 62, marginBottom: 4 }}>
        {buckets.map((b) => {
          const waiting = Math.max(0, b.enqueued - b.sent - b.failed - b.dead);
          const segs = [
            { v: b.sent, color: '#1a9f4f' },
            { v: waiting, color: '#9aa3c0' },
            { v: b.failed, color: '#e6a700' },
            { v: b.dead, color: '#d9342c' },
          ].filter((x) => x.v > 0);
          const h = b.enqueued === 0 ? 2 : Math.max(8, Math.round((b.enqueued / peak) * 56));
          return (
            <div
              key={b.hour}
              title={`${hourLabel(b.hour)} — ${faNum.format(b.enqueued)} پیام (${faNum.format(
                b.sent,
              )} فرستاده‌شده، ${faNum.format(b.failed)} ناموفق، ${faNum.format(b.dead)} ناامیدکننده)`}
              style={{
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'flex-end',
                gap: 1,
              }}
            >
              {b.enqueued === 0 ? (
                <div style={{ height: 2, background: '#eef0f8', borderRadius: 1 }} />
              ) : (
                segs.map((x, i) => (
                  <div
                    key={i}
                    style={{
                      height: Math.max(2, Math.round((x.v / Math.max(1, b.enqueued)) * h)),
                      background: x.color,
                      borderRadius: 2,
                    }}
                  />
                ))
              )}
            </div>
          );
        })}
      </div>

      <div dir="rtl" style={{ ...gridCols, fontSize: 10, color: '#6d7488', overflow: 'hidden' }}>
        {axis.map((a, i) => (
          <div
            key={i}
            style={{
              gridColumn: a ? `span ${a.span}` : undefined,
              whiteSpace: 'nowrap',
              overflow: 'hidden',
            }}
          >
            {a ? a.label : ''}
          </div>
        ))}
      </div>

      <div className="u-flex u-flex-wrap u-gap-3 u-mt-2 u-text-xs">
        {legend.map((l) => (
          <span key={l.key} className="u-inline-flex u-items-center u-gap-1">
            <i
              style={{
                width: 9,
                height: 9,
                borderRadius: 2,
                background: l.color,
                display: 'inline-block',
              }}
            />
            {l.label}
          </span>
        ))}
        <span className="u-ml-auto num" >
          مجموعِ {faNum.format(stats.hours)} ساعت: {faNum.format(stats.totals.enqueued)} پیام،{' '}
          {faNum.format(stats.totals.sent)} فرستاده‌شده
        </span>
      </div>

      {open && (
        <div className="queue-legend">
          <div>
            هر ستون یک ساعت است؛ ارتفاع یعنی تعدادِ پیامک‌هایی که در آن ساعت در صف
            گذاشته شده‌اند و رنگ‌ها نشان می‌دهند سرِشان چه آمد.
          </div>
          <div>
            اگر ستون‌ها پُرند و هیچ بخشِ سبزی ندارند، پیامک‌ها ساخته می‌شوند اما کسی
            نمی‌فرستدشان — یا کارگرِ صف اجرا نمی‌شود، یا همه در مهلتِ تلاشِ دوباره‌اند.
          </div>
          <div>
            هشدار وقتی روشن می‌شود که «چیزی در نوبت باشد» و «مهلتِ سکوت» گذشته باشد؛
            عددش از تنظیمات ← پیامک ← «مهلتِ سکوتِ کارگرِ صف» عوض می‌شود. با تایمرِ
            دو‌دقیقه‌ای ۱۵ دقیقه مناسب است، با تایمرِ ساعتی ۷۰.
          </div>
          <div>
            اگر «موردِ آمادهٔ پاک‌سازی» زیاد است، کارگرِ پس از فروش (یا همان دکمهٔ «همین حالا
            بفرست» در همین صفحه) در دورِ بعدی آن‌ها را می‌برد؛ مهلتش از تنظیمات ← پیامک ←
            «مهلتِ نگهداریِ پیامک‌هایِ تمام‌شده» عوض می‌شود و «۰» یعنی هرگز پاک نشود.
          </div>
          <div>این صفحه زنده نیست؛ برایِ تازه‌شدنِ اعداد دوباره بارگیری کنید.</div>
        </div>
      )}
    </section>
  );
}
