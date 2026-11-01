import type { NotificationType } from './request-machine';

/** Notification routing matrix (architecture §6). */
export interface Route {
  inApp: boolean;
  push: boolean;
  smsFallback: boolean;
  /** Muting (R5-AC5) only applies to announcement pushes. */
  mutable: boolean;
}

const ROUTES: Record<NotificationType, Route> = {
  request_status_changed: { inApp: true, push: true, smsFallback: false, mutable: false },
  request_comment: { inApp: true, push: true, smsFallback: false, mutable: false },
  visit_scheduled: { inApp: true, push: true, smsFallback: true, mutable: false },
  visit_rescheduled: { inApp: true, push: true, smsFallback: true, mutable: false },
  visit_reminder: { inApp: true, push: true, smsFallback: false, mutable: false },
  request_auto_closed: { inApp: true, push: true, smsFallback: false, mutable: false },
  announcement: { inApp: true, push: true, smsFallback: false, mutable: true },
  access_revoked: { inApp: false, push: true, smsFallback: false, mutable: false },
};

export function routeFor(type: NotificationType): Route {
  return ROUTES[type];
}

/** Status → Done carries SMS fallback; other status changes do not. */
export function smsFallbackFor(type: NotificationType, toStatus?: string): boolean {
  if (type === 'request_status_changed') return toStatus === 'done';
  return ROUTES[type].smsFallback;
}

export const SMS_FALLBACK_DELAY_MS = 10 * 60 * 1000;

/** Quiet hours for fallback SMS: 22:00–07:00 local; returns when it may be sent. */
export function releaseAfterQuietHours(at: Date, utcOffsetMinutes: number): Date {
  const local = new Date(at.getTime() + utcOffsetMinutes * 60_000);
  const h = local.getUTCHours();
  if (h >= 7 && h < 22) return at;
  const release = new Date(local);
  if (h >= 22) release.setUTCDate(release.getUTCDate() + 1);
  release.setUTCHours(7, 0, 0, 0);
  return new Date(release.getTime() - utcOffsetMinutes * 60_000);
}
