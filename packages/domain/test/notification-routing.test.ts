import { describe, expect, it } from 'vitest';
import { ACK_WAIT_MS, isQuietHour, planSmsFallback } from '../src/index';

const RIYADH = 180;
// 10:00 Riyadh = 07:00Z
const DAY = new Date('2026-11-01T07:00:00Z');
// 23:30 Riyadh = 20:30Z
const NIGHT = new Date('2026-11-01T20:30:00Z');
// 03:00 Riyadh = 00:00Z next day
const EARLY = new Date('2026-11-02T00:00:00Z');
const RELEASE = new Date('2026-11-02T04:00:00Z'); // 07:00 Riyadh

describe('planSmsFallback', () => {
  it('no device in the day → SMS now', () => {
    expect(planSmsFallback({ pushableDevices: 0, now: DAY, utcOffsetMinutes: RIYADH })).toEqual({ kind: 'sms_now' });
  });

  it('device in the day → SMS after the ack wait', () => {
    expect(planSmsFallback({ pushableDevices: 1, now: DAY, utcOffsetMinutes: RIYADH })).toEqual({
      kind: 'sms_at',
      at: new Date(DAY.getTime() + ACK_WAIT_MS),
      afterAckCheck: true,
    });
  });

  it('no device late evening → held to 07:00 next morning', () => {
    expect(planSmsFallback({ pushableDevices: 0, now: NIGHT, utcOffsetMinutes: RIYADH })).toEqual({
      kind: 'sms_at',
      at: RELEASE,
      afterAckCheck: false,
    });
  });

  it('device after midnight → held to 07:00 same day', () => {
    expect(planSmsFallback({ pushableDevices: 2, now: EARLY, utcOffsetMinutes: RIYADH })).toEqual({
      kind: 'sms_at',
      at: RELEASE,
      afterAckCheck: true,
    });
  });

  it('flagged announcement ignores quiet hours', () => {
    expect(
      planSmsFallback({ pushableDevices: 0, now: NIGHT, utcOffsetMinutes: RIYADH, ignoreQuietHours: true }),
    ).toEqual({ kind: 'sms_now' });
  });
});

describe('isQuietHour', () => {
  it('boundaries in Riyadh', () => {
    expect(isQuietHour(new Date('2026-11-01T18:59:00Z'), RIYADH)).toBe(false); // 21:59
    expect(isQuietHour(new Date('2026-11-01T19:00:00Z'), RIYADH)).toBe(true); // 22:00
    expect(isQuietHour(new Date('2026-11-01T03:59:00Z'), RIYADH)).toBe(true); // 06:59
    expect(isQuietHour(new Date('2026-11-01T04:00:00Z'), RIYADH)).toBe(false); // 07:00
  });
});
