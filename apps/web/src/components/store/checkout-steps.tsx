'use client';

/**
 * نوارِ مراحلِ خرید.
 *
 * چرا لازم است؟ چون نخستین پرسشِ کسی که در صفحه‌یِ پرداخت است این نیست که
 * «چه می‌خرد»، بلکه این است که «چقدر مانده و کجایم». نبودنِ این نشانه،
 * درست همان چیزی است که در تسویه، خریدار را نیمه‌کاره رها می‌کند.
 *
 * نکته‌یِ جهت: در راست‌چین، پیشروی از **راست به چپ** است. اگر این نوار را
 * با همان ترتیبِ ذهنیِ چپ‌به‌راست بسازیم، به خریدار می‌گوید «مرحله‌یِ آخر»
 * در حالی که تازه سبدش را دیده — و این گمراه کردن، بدتر از نداشتنِ نوار
 * است.
 */

export type StepKey = 'cart' | 'info' | 'pay' | 'done';

const STEPS: Array<{ key: StepKey; label: string }> = [
  { key: 'cart', label: 'سبد' },
  { key: 'info', label: 'اطلاعات' },
  { key: 'pay', label: 'پرداخت' },
  { key: 'done', label: 'تأیید' },
];

export function CheckoutSteps({ current }: { current: StepKey }) {
  const currentIndex = STEPS.findIndex((s) => s.key === current);

  return (
    <nav className="steps" aria-label="مراحلِ خرید">
      <ol className="sf-contents">
        {STEPS.map((step, index) => {
          const done = index < currentIndex;
          const now = index === currentIndex;
          return (
            <li key={step.key} className="sf-contents">
              <div
                className={
                  'steps__item' + (done ? ' steps__item--done' : '') + (now ? ' steps__item--now' : '')
                }
                aria-current={now ? 'step' : undefined}
              >
                <span className="steps__num" aria-hidden="true">
                  {done ? '✓' : index + 1}
                </span>
                <span>{step.label}</span>
              </div>
              {index < STEPS.length - 1 ? <span className="steps__line" aria-hidden="true" /> : null}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
