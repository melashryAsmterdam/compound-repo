/**
 * Wall-clock ↔ UTC for the compound time zone. Asia/Riyadh has no DST
 * (fixed UTC+3), but this works for any IANA zone via Intl.
 */
export function zoneOffsetMinutes(timeZone: string, at: Date): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(at);
  const get = (t: string) => Number(parts.find((p) => p.type === t)!.value);
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
  return Math.round((asUtc - Math.floor(at.getTime() / 1000) * 1000) / 60_000);
}

/** "2026-11-03" + "09:30" in `timeZone` → UTC instant. */
export function localToUtc(date: string, time: string, timeZone: string): Date {
  const naive = new Date(`${date}T${time}:00Z`);
  if (Number.isNaN(naive.getTime())) throw new RangeError('invalid_date');
  const offset = zoneOffsetMinutes(timeZone, naive);
  return new Date(naive.getTime() - offset * 60_000);
}

export interface VisitWindowInput {
  date: string;
  startTime: string;
  endTime: string;
}

export function visitWindowToUtc(v: VisitWindowInput, timeZone: string): { startAt: Date; endAt: Date } | null {
  const startAt = localToUtc(v.date, v.startTime, timeZone);
  const endAt = localToUtc(v.date, v.endTime, timeZone);
  return endAt > startAt ? { startAt, endAt } : null;
}

/** Local calendar date (YYYY-MM-DD) of an instant in a zone. */
export function localDate(at: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(at);
}
