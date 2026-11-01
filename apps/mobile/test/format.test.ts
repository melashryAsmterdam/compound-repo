import { dayBucket, formatCountdown, formatDual, formatHijri, formatRelative, formatTime, formatTimeRange, ltr } from '@/lib/format';

// 2026-11-12 09:30 Riyadh = 06:30Z. Umm al-Qura: 2 Jumada II 1448 (verified against ICU).
const D = '2026-11-12T06:30:00Z';

describe('formatDual (K-3, §1.2)', () => {
  it('shows Gregorian then Hijri in English with Western digits', () => {
    const s = formatDual(D, 'en');
    expect(s).toMatch(/^Thu 12 Nov 2026 · \d{1,2} Jumada (II|I|al-Akhirah|al-Thani).* 1448 AH$/);
  });
  it('shows Arabic month names with Western digits and هـ', () => {
    const s = formatDual(D, 'ar');
    expect(s).toContain('نوفمبر');
    expect(s).toContain('2026');
    expect(s).toMatch(/1448هـ$/);
    expect(s).not.toMatch(/[٠-٩]/);
  });
  it('Hijri uses the Umm al-Qura calendar', () => {
    expect(formatHijri(D, 'en')).toContain('1448');
  });
  it('appends 12-hour time in Asia/Riyadh', () => {
    expect(formatTime(D, 'en')).toBe('9:30 AM');
    expect(formatTime(D, 'ar')).toMatch(/^9:30\s?ص$/);
    expect(formatDual(D, 'en', { time: true })).toMatch(/· 9:30 AM$/);
  });
});

describe('formatTimeRange', () => {
  it('collapses a shared meridiem', () => {
    expect(formatTimeRange('2026-11-12T06:00:00Z', '2026-11-12T08:00:00Z', 'en')).toBe('9:00 – 11:00 AM');
  });
  it('keeps both meridiems when they differ', () => {
    expect(formatTimeRange('2026-11-12T08:00:00Z', '2026-11-12T10:00:00Z', 'en')).toBe('11:00 AM – 1:00 PM');
  });
});

describe('formatRelative / dayBucket', () => {
  const now = new Date('2026-11-12T12:00:00Z');
  it('just now, minutes, hours, then a short date', () => {
    expect(formatRelative('2026-11-12T11:59:50Z', 'en', now)).toBe('Just now');
    expect(formatRelative('2026-11-12T11:55:00Z', 'en', now)).toBe('5 minutes ago');
    expect(formatRelative('2026-11-12T09:00:00Z', 'en', now)).toBe('3 hours ago');
    expect(formatRelative('2026-11-10T09:00:00Z', 'en', now)).toBe('10 Nov 2026');
  });
  it('buckets by the Riyadh calendar day', () => {
    expect(dayBucket('2026-11-12T01:00:00Z', now)).toBe('today');
    expect(dayBucket('2026-11-11T21:30:00Z', now)).toBe('today'); // 00:30 on the 12th in Riyadh
    expect(dayBucket('2026-11-11T20:30:00Z', now)).toBe('yesterday'); // 23:30 on the 11th in Riyadh
    expect(dayBucket('2026-11-09T12:00:00Z', now)).toBe('earlier');
  });
});

describe('small helpers', () => {
  it('countdown', () => {
    expect(formatCountdown(252_000)).toBe('4:12');
    expect(formatCountdown(-5)).toBe('0:00');
  });
  it('ltr isolate', () => {
    expect(ltr('B-14')).toBe('⁦B-14⁩');
  });
});
