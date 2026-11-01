import { describe, expect, it } from 'vitest';
import { localDate, localToUtc, releaseAfterQuietHours, routeFor, smsFallbackFor, visitWindowToUtc, zoneOffsetMinutes } from '../src/index.js';

describe('routing matrix', () => {
  it('announcements are mutable, request updates are not', () => {
    expect(routeFor('announcement').mutable).toBe(true);
    expect(routeFor('request_comment').mutable).toBe(false);
    expect(routeFor('access_revoked').inApp).toBe(false);
  });
  it('sms fallback only for Done and visits', () => {
    expect(smsFallbackFor('request_status_changed', 'done')).toBe(true);
    expect(smsFallbackFor('request_status_changed', 'in_progress')).toBe(false);
    expect(smsFallbackFor('visit_scheduled')).toBe(true);
    expect(smsFallbackFor('visit_rescheduled')).toBe(true);
    expect(smsFallbackFor('request_comment')).toBe(false);
    expect(smsFallbackFor('visit_reminder')).toBe(false);
  });
  it('quiet hours hold fallback SMS until 07:00 Riyadh', () => {
    const off = 180;
    expect(releaseAfterQuietHours(new Date('2026-11-01T10:00:00Z'), off).toISOString()).toBe('2026-11-01T10:00:00.000Z'); // 13:00
    expect(releaseAfterQuietHours(new Date('2026-11-01T20:30:00Z'), off).toISOString()).toBe('2026-11-02T04:00:00.000Z'); // 23:30
    expect(releaseAfterQuietHours(new Date('2026-11-01T01:00:00Z'), off).toISOString()).toBe('2026-11-01T04:00:00.000Z'); // 04:00
    expect(releaseAfterQuietHours(new Date('2026-11-01T04:00:00Z'), off).toISOString()).toBe('2026-11-01T04:00:00.000Z'); // 07:00
    expect(releaseAfterQuietHours(new Date('2026-11-01T19:00:00Z'), off).toISOString()).toBe('2026-11-02T04:00:00.000Z'); // 22:00
  });
});

describe('time zone', () => {
  it('Riyadh is UTC+3', () => expect(zoneOffsetMinutes('Asia/Riyadh', new Date('2026-07-01T00:00:00Z'))).toBe(180));
  it('local to UTC', () => expect(localToUtc('2026-11-03', '09:30', 'Asia/Riyadh').toISOString()).toBe('2026-11-03T06:30:00.000Z'));
  it('rejects bad dates', () => expect(() => localToUtc('2026-13-40', '09:30', 'Asia/Riyadh')).toThrow('invalid_date'));
  it('visit window', () => {
    expect(visitWindowToUtc({ date: '2026-11-03', startTime: '09:00', endTime: '11:00' }, 'Asia/Riyadh')).toEqual({
      startAt: new Date('2026-11-03T06:00:00Z'),
      endAt: new Date('2026-11-03T08:00:00Z'),
    });
    expect(visitWindowToUtc({ date: '2026-11-03', startTime: '11:00', endTime: '11:00' }, 'Asia/Riyadh')).toBeNull();
  });
  it('local date', () => expect(localDate(new Date('2026-11-01T22:00:00Z'), 'Asia/Riyadh')).toBe('2026-11-02'));
});
