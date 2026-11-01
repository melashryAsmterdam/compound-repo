import { formatDual, formatTime, type Locale } from '@compound/i18n';

export { formatDual, formatTime };

/** Short Gregorian date for table cells; full dual date in the title tooltip. */
export function shortDate(iso: string | null | undefined, locale: Locale) {
  if (!iso) return '';
  return new Intl.DateTimeFormat(`${locale === 'ar' ? 'ar-SA' : 'en-GB'}-u-ca-gregory-nu-latn`, { timeZone: 'Asia/Riyadh', day: 'numeric', month: 'short' }).format(new Date(iso));
}

export function fullDate(iso: string | null | undefined, locale: Locale, time = true) {
  return iso ? formatDual(iso, locale, { time }).text : '';
}

/** "5 min ago" for the first 24 h, then a short date (spec §1.2). */
export function relative(iso: string | null | undefined, locale: Locale, now = Date.now()) {
  if (!iso) return '';
  const diff = now - new Date(iso).getTime();
  if (diff > 86_400_000 || diff < 0) return shortDate(iso, locale);
  const rtf = new Intl.RelativeTimeFormat(`${locale}-u-nu-latn`, { numeric: 'auto' });
  const min = Math.round(diff / 60_000);
  if (min < 60) return rtf.format(-min, 'minute');
  return rtf.format(-Math.round(min / 60), 'hour');
}

export function visitWindow(v: { startAt?: string; endAt?: string } | null | undefined, locale: Locale) {
  if (!v?.startAt || !v.endAt) return '';
  return `${formatDual(v.startAt, locale).text} · ${formatTime(new Date(v.startAt), locale)} – ${formatTime(new Date(v.endAt), locale)}`;
}

/** Today's date in Riyadh as YYYY-MM-DD (date inputs). */
export function riyadhToday() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Riyadh' }).format(new Date());
}

/** Local Riyadh wall clock → ISO UTC (Asia/Riyadh is fixed UTC+3). */
export function riyadhToIso(date: string, time: string) {
  return new Date(`${date}T${time}:00+03:00`).toISOString();
}
