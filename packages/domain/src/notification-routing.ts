/**
 * SMS fallback decision for notifications that carry smsFallback (architecture overview §6):
 * - no push-enabled device, or every token invalid → SMS now;
 * - otherwise SMS after 10 minutes if the app has not acknowledged receipt;
 * - fallback SMS falling in quiet hours (22:00–07:00 compound time) is held until 07:00,
 *   unless the admin flagged an announcement SMS, which ignores quiet hours.
 */
export const ACK_WAIT_MS = 10 * 60 * 1000;
export const QUIET_START_HOUR = 22;
export const QUIET_END_HOUR = 7;

export interface FallbackInput {
  pushableDevices: number;
  now: Date;
  /** Compound UTC offset in minutes; Asia/Riyadh is +180 with no DST. */
  utcOffsetMinutes: number;
  ignoreQuietHours?: boolean;
}

export type FallbackPlan = { kind: 'sms_now' } | { kind: 'sms_at'; at: Date; afterAckCheck: boolean };

export function planSmsFallback(input: FallbackInput): FallbackPlan {
  const noPush = input.pushableDevices === 0;
  const due = noPush ? input.now : new Date(input.now.getTime() + ACK_WAIT_MS);
  const at = input.ignoreQuietHours ? due : releaseFromQuietHours(due, input.utcOffsetMinutes);
  if (noPush && at.getTime() === input.now.getTime()) return { kind: 'sms_now' };
  return { kind: 'sms_at', at, afterAckCheck: !noPush };
}

export function isQuietHour(instant: Date, utcOffsetMinutes: number): boolean {
  const hour = localHour(instant, utcOffsetMinutes);
  return hour >= QUIET_START_HOUR || hour < QUIET_END_HOUR;
}

function localHour(instant: Date, utcOffsetMinutes: number): number {
  return new Date(instant.getTime() + utcOffsetMinutes * 60_000).getUTCHours();
}

function releaseFromQuietHours(instant: Date, utcOffsetMinutes: number): Date {
  if (!isQuietHour(instant, utcOffsetMinutes)) return instant;
  const local = new Date(instant.getTime() + utcOffsetMinutes * 60_000);
  const release = new Date(
    Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate(), QUIET_END_HOUR),
  );
  if (local.getUTCHours() >= QUIET_START_HOUR) release.setUTCDate(release.getUTCDate() + 1);
  return new Date(release.getTime() - utcOffsetMinutes * 60_000);
}
