import type { Locale } from './catalog.js';

export const TIME_ZONE = 'Asia/Riyadh';

/**
 * Gregorian + Hijri (Umm al-Qura) (K-3). Western digits (Q-23 working
 * assumption), 12-hour time with ص/م or AM/PM, Asia/Riyadh.
 */
export function formatDual(
  value: Date | string,
  locale: Locale,
  opts: { time?: boolean; timeZone?: string } = {},
): { gregorian: string; hijri: string; time: string | null; text: string } {
  const d = typeof value === 'string' ? new Date(value) : value;
  const timeZone = opts.timeZone ?? TIME_ZONE;
  const tag = locale === 'ar' ? 'ar-SA' : 'en-GB';
  const gregorian = new Intl.DateTimeFormat(`${tag}-u-ca-gregory-nu-latn`, {
    timeZone, day: 'numeric', month: 'short', year: 'numeric',
  }).format(d);
  const hijri = new Intl.DateTimeFormat(`${locale === 'ar' ? 'ar-SA' : 'en-US'}-u-ca-islamic-umalqura-nu-latn`, {
    timeZone, day: 'numeric', month: 'long', year: 'numeric',
  }).format(d);
  const time = opts.time ? formatTime(d, locale, timeZone) : null;
  const text = `${gregorian} · ${hijri}${time ? ` · ${time}` : ''}`;
  return { gregorian, hijri, time, text };
}

export function formatTime(d: Date, locale: Locale, timeZone = TIME_ZONE): string {
  return new Intl.DateTimeFormat(`${locale === 'ar' ? 'ar-SA' : 'en-US'}-u-nu-latn`, {
    timeZone, hour: 'numeric', minute: '2-digit', hour12: true,
  }).format(d);
}

/** "3 Nov 2026 · 9:00 AM – 11:00 AM" for visit windows. */
export function formatWindow(start: Date | string, end: Date | string, locale: Locale, timeZone = TIME_ZONE): string {
  const s = new Date(start);
  const e = new Date(end);
  return `${formatDual(s, locale, { timeZone }).text} · ${formatTime(s, locale, timeZone)} – ${formatTime(e, locale, timeZone)}`;
}
