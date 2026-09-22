'use client';

/**
 * انتخابگرِ تاریخِ شمسی — تقویمِ کالندریِ فارسی به‌جای تایپِ دستیِ تاریخ.
 *
 * چرا اختصاصی؟
 *  ۱. کاربرِ ایرانی تاریخ را شمسی می‌بیند؛ `<input type="date">` همیشه میلادی نمایش می‌دهد.
 *  ۲. فیلدهایِ مختلفِ فروشگاه هر کدام فرمتِ خروجیِ متفاوت می‌خواهند:
 *     برخی «۱۴۰۵/۰۶/۲۰» (گزارش و صافی)، برخی «2026-09-21» (API). این قطعه یک‌بار
 *     تقویم را می‌سازد و خروجی را بر اساسِ `format` تنظیم می‌کند.
 *  ۳. بدون وابستگی — از همان `date-fns-jalali` هسته استفاده می‌شود که بخش‌هایِ
 *     دیگرِ پروژه (گزارش، فاکتور) هم همان را دارند.
 *
 * حالت‌ها:
 *  - کنترل‌شده: `value` + `onChange` (پنل‌هایِ admin که مقدار در state است)
 *  - غیرکنترل‌شده: `name` → ورودیِ مخفیِ فرم برایِ server actions (Checkout و CRM)
 */

import { useEffect, useMemo, useRef, useState } from 'react';
// از ساب‌پکج‌ها وارد می‌شود (نه barrel): barrel شاملِ `newId` است که
// `node:crypto` می‌خواهد و در مرورگر در دسترس نیست.
import {
  JALALI_MONTHS,
  JALALI_WEEKDAYS,
  addJalaliMonths,
  formatJalali,
  jalaliDaysInMonth,
  jalaliParts,
  jalaliWeekday,
  makeJalaliDate,
  parseJalali,
  toIsoDate,
} from '@set/shared-kernel/jalali';
import { toPersianDigits } from '@set/shared-kernel/persian';

type OutputFormat = 'jalali' | 'iso';

interface ShamsiDatePickerProps {
  /** مقدارِ فعلی — با همان فرمتی که `format` می‌دهد (یا undefined در حالتِ فرمِ ساده) */
  value?: string;
  /** دریافتِ مقدارِ انتخاب‌شده */
  onChange?: (value: string) => void;
  /** فرمتِ خروجی: `jalali` → «۱۴۰۵/۰۶/۲۰» (پیش‌فرض)؛ `iso` → «2026-09-21» */
  format?: OutputFormat;
  /** فیلدهایِ زمان: یک انتخابگرِ ساعت هم نشان بده و خروجی `YYYY-MM-DDTHH:mm` بده (فقط iso) */
  withTime?: boolean;
  /** اگر داده شود، ورودیِ مخفیِ فرم (FormData / server action) هم رندر می‌شود */
  name?: string;
  required?: boolean;
  /** ظاهرِ دکمه‌یِ نمایش: `admin` (استایلِ پنل) یا `store` (استایلِ فروشگاه) */
  variant?: 'admin' | 'store';
  placeholder?: string;
  disabled?: boolean;
}

/** تبدیلِ مقدارِ ورودی به شیءِ Date — هر دو فرمت را می‌فهمد */
function valueToDate(value: string | undefined, format: OutputFormat): Date | null {
  if (!value) return null;
  if (format === 'jalali') return parseJalali(value);
  const m = value.match(/^(\d{4}-\d{2}-\d{2})/);
  if (m) {
    const d = new Date(`${m[1]}T00:00:00Z`);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
}

/** خروجیِ مقدار از Date */
function dateToOutput(date: Date, format: OutputFormat, time: string): string {
  if (format === 'jalali') return formatJalali(date);
  const iso = toIsoDate(date);
  if (!iso) return '';
  return time ? `${iso}T${time}` : iso;
}

function extractTime(value: string | undefined): string {
  if (!value) return '00:00';
  const m = value.match(/T(\d{2}:\d{2})$/);
  return m ? m[1] : '00:00';
}

const POP_WIDTH = 292;
const POP_HEIGHT = 348;

export function ShamsiDatePicker({
  value,
  onChange,
  format = 'jalali',
  withTime = false,
  name,
  required = false,
  variant = 'admin',
  placeholder,
  disabled = false,
}: ShamsiDatePickerProps) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const hiddenRef = useRef<HTMLInputElement>(null);
  const popRef = useRef<HTMLDivElement>(null);

  // در حالتِ فرمِ ساده (name بدون value)، مقدارِ انتخاب‌شده را خودمان نگه می‌داریم
  const [internal, setInternal] = useState<string>('');
  const effectiveValue = value !== undefined ? value : internal;

  const selected = useMemo(() => valueToDate(effectiveValue, format), [effectiveValue, format]);
  const [time, setTime] = useState(() => extractTime(effectiveValue));

  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  const parts = selected ? jalaliParts(selected) : null;
  const today = jalaliParts(new Date());

  // ماهِ نمایش‌شده در تقویم — با انتخابِ کاربر جابه‌جا می‌شود
  const [view, setView] = useState(() => (parts ? { year: parts.year, month: parts.month } : { year: today.year, month: today.month }));
  const [viewTime, setViewTime] = useState(time);

  const openCalendar = () => {
    if (disabled) return;
    const next = valueToDate(effectiveValue, format);
    const p = next ? jalaliParts(next) : today;
    setView({ year: p.year, month: p.month });
    setViewTime(extractTime(effectiveValue));
    const r = triggerRef.current?.getBoundingClientRect();
    if (r) {
      let top = r.bottom + 6;
      if (top + POP_HEIGHT > window.innerHeight - 8) top = Math.max(8, r.top - POP_HEIGHT - 6);
      let left = r.right - POP_WIDTH;
      left = Math.min(Math.max(8, left), window.innerWidth - POP_WIDTH - 8);
      setPos({ top, left });
    }
    setOpen(true);
  };

  // بستن با کلیکِ بیرون، Esc و اسکرول (چون موقعیتِ popover ثابت است)
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (triggerRef.current?.contains(t)) return;
      if (popRef.current?.contains(t)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    const onScroll = () => setOpen(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onScroll);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onScroll);
    };
  }, [open]);

  const emit = (out: string) => {
    if (hiddenRef.current) hiddenRef.current.value = out;
    setInternal(out);
    onChange?.(out);
  };

  const pickDay = (year: number, month: number, day: number) => {
    const d = makeJalaliDate(year, month, day);
    if (!d) return;
    const activeTime = withTime ? viewTime : extractTime(effectiveValue);
    setTime(activeTime);
    emit(dateToOutput(d, format, withTime ? activeTime : ''));
    setOpen(false);
  };

  const pickToday = () => {
    const now = new Date();
    const activeTime = withTime
      ? `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
      : extractTime(effectiveValue);
    if (withTime) setViewTime(activeTime);
    setTime(activeTime);
    emit(dateToOutput(now, format, withTime ? activeTime : ''));
    setOpen(false);
  };

  const clearValue = () => {
    emit('');
    setOpen(false);
  };

  const shiftMonth = (delta: number) => {
    setView((v) => {
      const next = addJalaliMonths(makeJalaliDate(v.year, v.month, 1) ?? new Date(), delta);
      const p = jalaliParts(next);
      return { year: p.year, month: p.month };
    });
  };

  const firstOfMonth = makeJalaliDate(view.year, view.month, 1);
  const daysInMonth = firstOfMonth ? jalaliDaysInMonth(firstOfMonth) : 30;
  const offset = firstOfMonth ? jalaliWeekday(firstOfMonth) : 0;

  const display = selected ? formatJalali(selected) : '';
  const monthName = JALALI_MONTHS[view.month - 1] ?? '';

  const isSame = (d: Date, y: number, m: number, day: number) => {
    const p = jalaliParts(d);
    return p.year === y && p.month === m && p.day === day;
  };

  const triggerClass =
    variant === 'admin'
      ? 'dp-trigger dp-trigger--admin'
      : 'dp-trigger dp-trigger--store';

  const cells: Array<number | null> = [
    ...(Array(offset).fill(null) as null[]),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={triggerClass}
        onClick={openCalendar}
        disabled={disabled}
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        <span dir="ltr" className={display ? 'dp-trigger__value' : 'dp-trigger__value dp-trigger__value--empty'}>
          {display || placeholder || '۱۴۰۵/۰۶/۲۰'}
        </span>
        {withTime && time && effectiveValue ? (
          <span dir="ltr" className="dp-trigger__time">
            {toPersianDigits(time)}
          </span>
        ) : null}
        <svg
          className="dp-trigger__icon"
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          aria-hidden
        >
          <rect x="3" y="5" width="18" height="16" rx="2.5" />
          <path d="M3 10h18M8 3v4M16 3v4" />
        </svg>
      </button>

      {name ? <input ref={hiddenRef} type="hidden" name={name} required={required || undefined} /> : null}

      {open && pos ? (
        <div
          ref={popRef}
          className={variant === 'store' ? 'dp-pop dp-pop--store' : 'dp-pop'}
          style={{ top: pos.top, left: pos.left }}
          role="dialog"
          aria-label="انتخاب تاریخ"
        >
          <div className="dp-pop__head">
            <div className="dp-pop__nav">
              <button type="button" className="dp-pop__navbtn" onClick={() => shiftMonth(-1)} aria-label="ماه قبل">
                ‹
              </button>
              <button type="button" className="dp-pop__navbtn" onClick={() => shiftMonth(1)} aria-label="ماه بعد">
                ›
              </button>
            </div>
            <div className="dp-pop__title">
              <span>{monthName}</span>
              <span className="num" dir="ltr">{toPersianDigits(String(view.year))}</span>
            </div>
            <div className="dp-pop__nav">
              <button
                type="button"
                className="dp-pop__navbtn dp-pop__navbtn--year"
                onClick={() => setView((v) => ({ ...v, year: v.year - 1 }))}
                aria-label="سال قبل"
              >
                ‹
              </button>
              <button
                type="button"
                className="dp-pop__navbtn dp-pop__navbtn--year"
                onClick={() => setView((v) => ({ ...v, year: v.year + 1 }))}
                aria-label="سال بعد"
              >
                ›
              </button>
            </div>
          </div>

          <div className="dp-pop__weekdays">
            {JALALI_WEEKDAYS.map((w) => (
              <span key={w}>{w}</span>
            ))}
          </div>

          <div className="dp-pop__grid">
            {cells.map((day, i) =>
              day === null ? (
                <span key={`blank-${i}`} className="dp-pop__cell dp-pop__cell--blank" />
              ) : (
                <button
                  key={day}
                  type="button"
                  className={[
                    'dp-pop__cell',
                    selected && isSame(selected, view.year, view.month, day) ? 'dp-pop__cell--selected' : '',
                    today.year === view.year && today.month === view.month && today.day === day ? 'dp-pop__cell--today' : '',
                  ].join(' ')}
                  onClick={() => pickDay(view.year, view.month, day)}
                >
                  {toPersianDigits(String(day))}
                </button>
              ),
            )}
          </div>

          {withTime ? (
            <div className="dp-pop__time">
              <label className="dp-pop__timelabel">
                ساعت
                <input
                  type="time"
                  className="dp-pop__timeinput"
                  value={viewTime}
                  onChange={(e) => {
                    setViewTime(e.target.value);
                    if (selected) emit(dateToOutput(selected, format, e.target.value));
                  }}
                  dir="ltr"
                />
              </label>
            </div>
          ) : null}

          <div className="dp-pop__foot">
            <button type="button" className="dp-pop__action dp-pop__action--primary" onClick={pickToday}>
              امروز
            </button>
            {!required ? (
              <button type="button" className="dp-pop__action" onClick={clearValue}>
                پاک کردن
              </button>
            ) : null}
          </div>
        </div>
      ) : null}
    </>
  );
}
