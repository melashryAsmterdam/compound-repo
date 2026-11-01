import { describe, expect, it } from 'vitest';
import { EMAIL, ERRORS, NOTIFICATIONS, SMS, STATUS_LABELS, errorMessage, fill, formatDual, formatWindow, notificationText, smsText, emailText } from '../src/index.js';

const keys = (o: Record<string, unknown>) => Object.keys(o).sort();

describe('catalogue parity ar/en', () => {
  it.each([
    ['errors', ERRORS],
    ['statuses', STATUS_LABELS],
    ['notifications', NOTIFICATIONS],
    ['sms', SMS],
    ['email', EMAIL],
  ] as const)('%s', (_, cat) => expect(keys(cat.ar)).toEqual(keys(cat.en)));
});

describe('templates', () => {
  it('isolates values for bidi', () => expect(fill('الطلب {ref}', { ref: 'REQ-00001' })).toBe('الطلب ⁦REQ-00001⁩'));
  it('keeps unknown placeholders', () => expect(fill('{x}', {})).toBe('{x}'));
  it('renders notification', () =>
    expect(notificationText('request_status_changed_done', 'en', { compound: 'Al Narjis', ref: 'REQ-00001' })).toEqual({
      title: 'Al Narjis',
      body: 'Request ⁦REQ-00001⁩ is Done — please confirm',
    }));
  it('sms and email are plain', () => {
    expect(smsText('otp', 'en', { code: '123456' })).toContain('123456');
    expect(emailText('otp', 'ar', { code: '123456' }).body).toContain('123456');
  });
  it('error fallback', () => {
    expect(errorMessage('unit_number_taken', 'ar')).toContain('وحدة');
    expect(errorMessage('nope', 'en')).toBe(ERRORS.en.internal_error);
  });
});

describe('formatDual', () => {
  it('shows Gregorian and Umm al-Qura Hijri in English', () => {
    const r = formatDual('2026-11-03T06:30:00Z', 'en', { time: true });
    expect(r.gregorian).toBe('3 Nov 2026');
    expect(r.hijri).toMatch(/1448 AH/);
    expect(r.time).toBe('9:30 AM');
  });
  it('Arabic uses ص/م and Western digits', () => {
    const r = formatDual(new Date('2026-11-03T15:00:00Z'), 'ar', { time: true });
    expect(r.time).toMatch(/6:00\s?م/);
    expect(r.hijri).toMatch(/1448/);
  });
  it('visit window', () => expect(formatWindow('2026-11-03T06:00:00Z', '2026-11-03T08:00:00Z', 'en')).toMatch(/9:00 AM – 11:00 AM$/));
});

import { PORTAL } from '../src/index.js';
describe('portal strings', () => {
  it('ar and en have the same keys', () => expect(Object.keys(PORTAL.ar).sort()).toEqual(Object.keys(PORTAL.en).sort()));
  it('placeholders match per key', () => {
    const ph = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort().join(',');
    for (const k of Object.keys(PORTAL.en) as (keyof typeof PORTAL.en)[]) expect([k, ph(PORTAL.ar[k])]).toEqual([k, ph(PORTAL.en[k])]);
  });
});
