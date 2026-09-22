'use client';

import { useEffect, useMemo, useState } from 'react';

import { faDigits } from '@/lib/format';

import { submitReview, voteReview, type Review, type ReviewBundle } from '@/lib/review-actions';

/** میانگین را با رقمِ فارسی برایِ نمایش می‌سازد */
function formatAverage(average: number): string {
  return faDigits(average.toFixed(1));
}

/**
 * نظراتِ کالا — آنچه خریدارِ بعدی می‌خواند.
 *
 * چهار چیز اینجا بیشتر از ظاهر اهمیت دارد:
 *
 *  ۱. **نمودارِ ستاره‌ها پیش از متن‌ها**. خریدار در سه ثانیه می‌خواهد بداند
 *     «اکثراً راضی بوده‌اند یا نه»؛ اگر برایِ فهمیدنِ این مجبور باشد پنج
 *     نظر بخواند، بخشِ بزرگی اصلاً نمی‌خواند. نمودار همان سه ثانیه را
 *     می‌دهد.
 *  ۲. **نشانِ خریدِ تأیید‌شده دیده شود**. در بازاری که نظرِ ساختگی فراوان
 *     است، این نشان تنها فرقِ میانِ «نظر» و «تبلیغ» است.
 *  ۳. **پاسخِ فروشنده زیرِ نظر**. نپذیرفتنِ نظرِ بد پنهان کردنش نیست؛
 *     پاسخ دادن است. خریدار که ببیند فروشنده پاسخ داده، به فروشنده اعتماد
 *     می‌کند حتی اگر نظر منفی باشد.
 *  ۴. **رأیِ «مفید بود»**. مرتب‌سازی بر پایه‌یِ آن یعنی مفیدترین نظر بالا
 *     می‌آید، نه تازه‌ترین — و این همان چیزی است که دیجی‌کالا را در این
 *     بخش قوی می‌کند.
 */

const SORTS: Array<{ key: string; label: string }> = [
  { key: 'newest', label: 'تازه‌ترین' },
  { key: 'helpful', label: 'مفیدترین' },
  { key: 'highest', label: 'بالاترین امتیاز' },
  { key: 'lowest', label: 'پایین‌ترین امتیاز' },
];

const STATUS_LABEL: Record<string, string> = {
  pending: 'در انتظارِ تأیید',
  approved: 'منتشرشده',
  rejected: 'ردشده',
};

/** پنج ستاره — نیم‌ستاره هم پشتیبانی می‌شود (۴٫۵ را درست نشان می‌دهد) */
function Stars({ value, size = 16 }: { value: number; size?: number }) {
  const full = Math.floor(value);
  const half = value - full >= 0.5;
  return (
    <span className="stars" style={{ fontSize: `${size}px` }} aria-label={`${formatAverage(value)} از ۵`}>
      {[1, 2, 3, 4, 5].map((star) => (
        <span key={star} className={star <= full ? 'stars__on' : star === full + 1 && half ? 'stars__half' : 'stars__off'}>
          ★
        </span>
      ))}
    </span>
  );
}

function Jalali({ iso }: { iso: string }) {
  // تاریخ را در همان نگاهِ نخست می‌خوانیم؛ تبدیلِ دقیق در هسته‌یِ مشترک است
  const date = new Date(iso);
  const text = new Intl.DateTimeFormat('fa-IR', { year: 'numeric', month: 'long', day: 'numeric' }).format(date);
  return <time dateTime={iso}>{text}</time>;
}

function VoteButtons({ review }: { review: Review }) {
  const [counts, setCounts] = useState({ helpful: review.helpfulCount, unhelpful: review.unhelpfulCount });
  const [mine, setMine] = useState<boolean | null>(review.viewerVote);
  const [busy, setBusy] = useState(false);

  async function vote(isHelpful: boolean) {
    setBusy(true);
    const result = await voteReview(review.id, isHelpful);
    setBusy(false);
    if (result.ok) {
      setCounts({ helpful: result.data.helpfulCount, unhelpful: result.data.unhelpfulCount });
      setMine(isHelpful);
    }
  }

  return (
    <div className="rv__vote" dir="rtl">
      <span className="rv__vote-q">آیا این نظر مفید بود؟</span>
      <button
        type="button"
        className={`rv__thumb ${mine === true ? 'rv__thumb--on' : ''}`}
        disabled={busy}
        aria-pressed={mine === true}
        onClick={() => void vote(true)}
      >
        👍 <span className="num">{faDigits(String(counts.helpful))}</span>
      </button>
      <button
        type="button"
        className={`rv__thumb ${mine === false ? 'rv__thumb--on' : ''}`}
        disabled={busy}
        aria-pressed={mine === false}
        onClick={() => void vote(false)}
      >
        👎 <span className="num">{faDigits(String(counts.unhelpful))}</span>
      </button>
    </div>
  );
}

function WriteForm({
  productId,
  can,
  reason,
  onDone,
}: {
  productId: string;
  can: boolean;
  reason: string | null;
  onDone: () => void;
}) {
  const [rating, setRating] = useState(5);
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: 'ok' | 'bad'; text: string } | null>(null);

  if (!can) {
    return (
      <p className="rv__note">
        {reason ?? 'برایِ نوشتنِ نظر باید واردِ حسابِ خود شوید.'}
      </p>
    );
  }

  async function send() {
    if (body.trim().length < 10) {
      setMessage({ tone: 'bad', text: 'نظر را کامل‌تر بنویسید (دست‌کم ۱۰ نویسه).' });
      return;
    }
    setBusy(true);
    const result = await submitReview({ productId, rating, body });
    setBusy(false);
    if (result.ok) {
      setBody('');
      setMessage({ tone: 'ok', text: result.data.message });
      onDone();
    } else {
      setMessage({ tone: 'bad', text: result.message });
    }
  }

  return (
    <div className="rv__form">
      <div className="rv__rate">
        <span className="rv__rate-label">امتیازِ شما:</span>
        {[1, 2, 3, 4, 5].map((star) => (
          <button
            key={star}
            type="button"
            className={`rv__star ${star <= rating ? 'rv__star--on' : ''}`}
            aria-label={`${faDigits(String(star))} ستاره`}
            onClick={() => setRating(star)}
          >
            ★
          </button>
        ))}
      </div>
      <textarea
        className="field__input"
        rows={4}
        value={body}
        placeholder="چه چیزی شما را راضی یا ناراضی کرد؟ برایِ خریدارِ بعدی بنویسید…"
        onChange={(event) => setBody(event.target.value)}
      />
      {message ? (
        <p className={message.tone === 'ok' ? 'alert alert--ok' : 'alert alert--danger'}>{message.text}</p>
      ) : null}
      <button className="btn" disabled={busy} onClick={() => void send()}>
        {busy ? 'در حالِ فرستادن…' : 'فرستادنِ نظر'}
      </button>
    </div>
  );
}

export function ProductReviews({
  productId,
  productSlug,
  initial,
}: {
  productId: string;
  productSlug: string;
  initial: ReviewBundle;
}) {
  const [sort, setSort] = useState('newest');
  const [bundle, setBundle] = useState<ReviewBundle>(initial);
  const [loading, setLoading] = useState(false);

  // «می‌توانم نظر بنویسم؟» برایِ هر کس فرق دارد — فقط خریدارِ واقعیِ کالا
  // می‌تواند. برگه‌یِ کالا حالا کش می‌شود، پس این پرسش را در سرور نمی‌پرسیم
  // (پرسیدنش یعنی خواندنِ کوکی، و خواندنِ کوکی یعنی پویا شدنِ برگه برایِ
  // همه). در مرورگر می‌پرسیم: بهایش یک درخواستِ کوچک است، سودش این‌که برگه
  // برایِ هزاران نفر یکی است و از کش می‌آید.
  useEffect(() => {
    if (initial.canReview.can) return;
    let alive = true;
    (async () => {
      try {
        // مسیرِ «می‌توانم بنویسم؟» اسلاگ می‌گیرد (`product=`) و پاسخش
        // `{ canReview: { can, reason } }` است — نه شناسه و نه `{ can }`.
        const res = await fetch(`/api/shop/reviews/can?product=${encodeURIComponent(productSlug)}`, {
          credentials: 'include',
        });
        if (!res.ok) return;
        const data = (await res.json()) as { canReview?: { can?: boolean; reason?: string | null } };
        if (!alive) return;
        setBundle((prev) => ({
          ...prev,
          canReview: { can: data.canReview?.can ?? false, reason: data.canReview?.reason ?? null },
        }));
      } catch {
        // نشست یا شبکه نبود؛ فرم بسته می‌ماند — همان رفتارِ پیش از این
      }
    })();
    return () => {
      alive = false;
    };
  }, [initial.canReview.can, productSlug]);

  async function change(next: string) {
    setSort(next);
    setLoading(true);
    try {
      const res = await fetch(`/reviews?product=${encodeURIComponent(productSlug)}&sort=${next}&limit=20`);
      if (res.ok) setBundle((await res.json()) as ReviewBundle);
    } catch {
      // نماندنِ این درخواست نباید بخش را خراب کند: همان فهرستِ پیشین می‌ماند
    }
    setLoading(false);
  }

  const { summary } = bundle;
  const percent = useMemo(() => {
    const total = summary.count || 1;
    return (star: number) => Math.round((summary.histogram[String(star) as '5'] / total) * 100);
  }, [summary]);

  return (
    <section className="rv" id="reviews">
      <div className="rv__head">
        <h2 className="rv__title">
          نظر و امتیازِ خریداران
          {summary.count > 0 ? <span className="rv__count num"> ({faDigits(String(summary.count))})</span> : null}
        </h2>
      </div>

      {summary.count > 0 ? (
        <div className="rv__summary">
          <div className="rv__score">
            <div className="rv__score-num num">{formatAverage(summary.average)}</div>
            <Stars value={summary.average} size={20} />
            <div className="rv__score-sub">
              از {faDigits(String(summary.count))} نظر
              {summary.verifiedCount > 0 ? ` · ${faDigits(String(summary.verifiedCount))} خریدِ تأییدشده` : ''}
            </div>
          </div>

          <div className="rv__bars">
            {[5, 4, 3, 2, 1].map((star) => (
              <div className="rv__bar" key={star}>
                <span className="rv__bar-label num">{faDigits(String(star))}</span>
                <span className="rv__bar-track">
                  <span className="rv__bar-fill" style={{ width: `${percent(star)}%` }} />
                </span>
                <span className="rv__bar-count num">{faDigits(String(summary.histogram[String(star) as '5']))}</span>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <p className="rv__note">هنوز نظری برایِ این کالا نوشته نشده است. نخستین نفر باشید.</p>
      )}

      <WriteForm
        productId={productId}
        can={bundle.canReview.can}
        reason={bundle.canReview.reason}
        onDone={() => void change('newest')}
      />

      {bundle.items.length > 0 ? (
        <div className="rv__sort">
          <span className="rv__sort-label">ترتیب:</span>
          {SORTS.map((option) => (
            <button
              key={option.key}
              type="button"
              className={sort === option.key ? 'rv__sort-btn rv__sort-btn--on' : 'rv__sort-btn'}
              onClick={() => void change(option.key)}
            >
              {option.label}
            </button>
          ))}
        </div>
      ) : null}

      <div className={loading ? 'rv__list rv__list--busy' : 'rv__list'}>
        {bundle.items.map((review) => (
          <article className="rv__item" key={review.id}>
            <header className="rv__item-head">
              <span className="rv__author">{review.authorName}</span>
              {review.isVerifiedPurchase ? <span className="rv__badge">✔ خریدِ تأییدشده</span> : null}
              <span className="rv__date">
                <Jalali iso={review.createdAt} />
              </span>
            </header>
            <div className="rv__item-rate">
              <Stars value={review.rating} />
              <span className="rv__status rv__status--approved">{STATUS_LABEL.approved}</span>
            </div>
            <p className="rv__body">{review.body}</p>

            {review.sellerReply ? (
              <div className="rv__reply">
                <span className="rv__reply-label">پاسخِ فروشگاه</span>
                <p className="rv__reply-body">{review.sellerReply}</p>
              </div>
            ) : null}

            <VoteButtons review={review} />
          </article>
        ))}
      </div>
    </section>
  );
}
