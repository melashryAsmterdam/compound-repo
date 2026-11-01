import type { Locale } from './i18n/types';

/**
 * Dates per screen spec §1.2 and K-3: Gregorian first, Hijri (Umm al-Qura) second, Western digits
 * (Q-23), 12-hour clock, always Asia/Riyadh. Mirrors packages/i18n `formatDual` on the portal branch;
 * move to the shared package once that branch lands on main.
 */
export const TIME_ZONE = 'Asia/Riyadh';

const cache = new Map<string, Intl.DateTimeFormat>();
function fmt(tag: string, opts: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = tag + JSON.stringify(opts);
  let f = cache.get(key);
  if (!f) {
    f = new Intl.DateTimeFormat(tag, { timeZone: TIME_ZONE, ...opts });
    cache.set(key, f);
  }
  return f;
}

const toDate = (v: Date | string) => (typeof v === 'string' ? new Date(v) : v);

export function formatGregorian(value: Date | string, locale: Locale, withWeekday = true): string {
  const tag = locale === 'ar' ? 'ar-SA-u-ca-gregory-nu-latn' : 'en-GB-u-ca-gregory-nu-latn';
  return fmt(tag, {
    weekday: withWeekday ? (locale === 'ar' ? 'long' : 'short') : undefined,
    day: 'numeric',
    month: locale === 'ar' ? 'long' : 'short',
    year: 'numeric',
  })
    .format(toDate(value))
    .replace(/،/g, '')
    .replace(/,/g, '');
}

export function formatHijri(value: Date | string, locale: Locale): string {
  const tag = locale === 'ar' ? 'ar-SA-u-ca-islamic-umalqura-nu-latn' : 'en-US-u-ca-islamic-umalqura-nu-latn';
  const parts = fmt(tag, { day: 'numeric', month: 'long', year: 'numeric' }).formatToParts(toDate(value));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  const year = get('year').replace(/[^\d]/g, '');
  return locale === 'ar' ? `${get('day')} ${get('month')} ${year}هـ` : `${get('day')} ${get('month')} ${year} AH`;
}

export function formatTime(value: Date | string, locale: Locale): string {
  const tag = locale === 'ar' ? 'ar-SA-u-nu-latn' : 'en-US-u-nu-latn';
  return fmt(tag, { hour: 'numeric', minute: '2-digit', hour12: true }).format(toDate(value));
}

/** "Sun 12 Nov 2026 · 21 Jumada I 1448 AH" (+ " · 4:30 PM" with time). */
export function formatDual(value: Date | string, locale: Locale, opts: { time?: boolean } = {}): string {
  const base = `${formatGregorian(value, locale)} · ${formatHijri(value, locale)}`;
  return opts.time ? `${base} · ${formatTime(value, locale)}` : base;
}

/** "9:00 – 11:00 AM" when both ends share the meridiem, else "11:00 AM – 1:00 PM". */
export function formatTimeRange(start: Date | string, end: Date | string, locale: Locale): string {
  const s = formatTime(start, locale);
  const e = formatTime(end, locale);
  const mer = (x: string) => x.match(/(AM|PM|ص|م)\s*$/)?.[1];
  const ms = mer(s);
  if (ms && ms === mer(e)) return `${s.replace(/\s*(AM|PM|ص|م)\s*$/, '')} – ${e}`;
  return `${s} – ${e}`;
}

/** Short visit line for cards: "Tue 14 Nov · 9:00 – 11:00 AM". */
export function formatVisitShort(start: Date | string, end: Date | string, locale: Locale): string {
  const tag = locale === 'ar' ? 'ar-SA-u-ca-gregory-nu-latn' : 'en-GB-u-ca-gregory-nu-latn';
  const day = fmt(tag, { weekday: 'short', day: 'numeric', month: 'short' }).format(toDate(start)).replace(/[،,]/g, '');
  return `${day} · ${formatTimeRange(start, end, locale)}`;
}

/** Relative time for lists, switching to a short date after 24 hours (§1.2). */
export function formatRelative(value: Date | string, locale: Locale, now: Date = new Date()): string {
  const d = toDate(value);
  const diffSec = Math.round((d.getTime() - now.getTime()) / 1000);
  const abs = Math.abs(diffSec);
  if (abs < 45) return locale === 'ar' ? 'الآن' : 'Just now';
  if (abs < 24 * 3600) {
    const rtf = new Intl.RelativeTimeFormat(locale === 'ar' ? 'ar-SA-u-nu-latn' : 'en', { numeric: 'auto' });
    if (abs < 3600) return rtf.format(Math.round(diffSec / 60), 'minute');
    return rtf.format(Math.round(diffSec / 3600), 'hour');
  }
  return formatGregorian(d, locale, false);
}

/** Calendar-day bucket in Riyadh for the Notifications list headers (M-22). */
export function dayBucket(value: Date | string, now: Date = new Date()): 'today' | 'yesterday' | 'earlier' {
  const day = (d: Date) => fmt('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
  const d = day(toDate(value));
  if (d === day(now)) return 'today';
  if (d === day(new Date(now.getTime() - 24 * 3600 * 1000))) return 'yesterday';
  return 'earlier';
}

/** "4:12" countdown text. */
export function formatCountdown(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

/** Wrap a value in an LTR isolate (LRI…PDI) for use inside translated strings (§1.1 bidi). */
export const ltr = (s: string) => `\u2066${s}\u2069`;
