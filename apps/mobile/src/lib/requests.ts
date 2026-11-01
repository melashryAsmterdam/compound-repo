import type { Category, CategoryCode, RequestCore, RequestEvent } from './types';
import type { Locale } from './i18n/types';

/** Pure presentation rules for requests (screen spec §1.3, M-11, M-15). No React, fully unit-tested. */

/** Tones follow tokens color.status (spec §1.3); `awaiting` is the success outline + dot. */
export type ChipTone = 'new' | 'in_progress' | 'done' | 'closed' | 'cancelled' | 'reopened' | 'awaiting';
export interface Chip {
  key: string;
  params?: Record<string, string | number>;
  tone: ChipTone;
}

export const OPEN_STATUSES = new Set(['new', 'in_progress', 'done']);
export const isOpen = (r: Pick<RequestCore, 'status'>) => OPEN_STATUSES.has(r.status);
export const isAwaitingConfirmation = (r: Pick<RequestCore, 'status'>) => r.status === 'done';

export function statusChip(r: Pick<RequestCore, 'status' | 'closeReason'>): Chip {
  switch (r.status) {
    case 'new':
      return { key: 'status.new', tone: 'new' };
    case 'in_progress':
      return { key: 'status.in_progress', tone: 'in_progress' };
    case 'done':
      return { key: 'status.done', tone: 'done' };
    case 'cancelled':
      return { key: 'status.cancelled', tone: 'cancelled' };
    case 'closed':
    default:
      if (r.closeReason === 'confirmed') return { key: 'status.closedConfirmed', tone: 'closed' };
      if (r.closeReason === 'no_response') return { key: 'status.closedNoResponse', tone: 'closed' };
      return { key: 'status.closed', tone: 'closed' };
  }
}

/** Outcome badges shown next to the status chip. */
export function outcomeBadges(r: Pick<RequestCore, 'status' | 'reopenCount'>): Chip[] {
  const out: Chip[] = [];
  if (r.status === 'done') out.push({ key: 'status.awaiting', tone: 'awaiting' });
  if (r.reopenCount > 0 && isOpen(r)) out.push({ key: 'status.reopened', params: { count: r.reopenCount }, tone: 'reopened' });
  return out;
}

/** M-11 order: awaiting confirmation first, then last update, newest first. */
export function sortRequests<T extends Pick<RequestCore, 'status' | 'updatedAt'>>(list: readonly T[]): T[] {
  return [...list].sort((a, b) => {
    const aw = Number(isAwaitingConfirmation(b)) - Number(isAwaitingConfirmation(a));
    if (aw !== 0) return aw;
    return Date.parse(b.updatedAt) - Date.parse(a.updatedAt);
  });
}

type WithVisit = Pick<RequestCore, 'status' | 'visit'>;
export function hasUpcomingVisit(r: WithVisit, now: Date = new Date()): boolean {
  return Boolean(isOpen(r) && r.visit?.endAt && Date.parse(r.visit.endAt) >= now.getTime());
}

/** Home "Next visit" card: the soonest future visit across open requests. */
export function nextVisit<T extends WithVisit>(list: readonly T[], now: Date = new Date()): T | undefined {
  return list
    .filter((r) => hasUpcomingVisit(r, now))
    .sort((a, b) => Date.parse(a.visit!.startAt!) - Date.parse(b.visit!.startAt!))[0];
}

/** Visit card on M-15: shown while not closed/cancelled; past visits render muted. */
export function visitCardState(r: WithVisit, now: Date = new Date()): 'hidden' | 'upcoming' | 'past' {
  if (!r.visit?.startAt || !isOpen(r)) return 'hidden';
  return hasUpcomingVisit(r, now) ? 'upcoming' : 'past';
}

export function wasRescheduled(timeline: readonly Pick<RequestEvent, 'type'>[]): boolean {
  return timeline.some((e) => e.type === 'visit_rescheduled');
}

export interface TimelineLine {
  id: string;
  key: string;
  params: Record<string, string | number>;
  /** management entries sit on the start side, the resident's own on the end side (M-15 RTL note). */
  side: 'start' | 'end' | 'center';
  body?: string | null;
  kind: 'status' | 'comment' | 'visit' | 'resident' | 'system';
}

export function timelineLine(e: RequestEvent, statusLabel: (s: string) => string): TimelineLine {
  const base = { id: e.id, params: {} as Record<string, string | number> };
  switch (e.type) {
    case 'created':
      return { ...base, key: 'detail.ev_created', side: 'end', kind: 'resident' };
    case 'status_changed':
      return { ...base, key: 'detail.ev_status_changed', params: { status: statusLabel(e.toStatus ?? '') }, side: 'center', kind: 'status' };
    case 'comment':
      return { ...base, key: 'detail.ev_comment', side: 'start', kind: 'comment', body: e.body };
    case 'visit_scheduled':
      return { ...base, key: 'detail.ev_visit_scheduled', side: 'start', kind: 'visit', body: e.body };
    case 'visit_rescheduled':
      return { ...base, key: 'detail.ev_visit_rescheduled', side: 'start', kind: 'visit', body: e.body };
    case 'reopened':
      return { ...base, key: 'detail.ev_reopened', params: { reason: e.body ?? '' }, side: 'end', kind: 'resident' };
    case 'confirmed':
      return { ...base, key: 'detail.ev_confirmed', side: 'end', kind: 'resident' };
    case 'auto_closed':
      return { ...base, key: 'detail.ev_auto_closed', side: 'center', kind: 'system' };
    case 'cancelled':
    default:
      return { ...base, key: 'detail.ev_cancelled', side: 'end', kind: 'resident' };
  }
}

/** Timeline is oldest at top, newest at bottom (R3-AC2), whatever order the API returns. */
export function orderedTimeline<T extends Pick<RequestEvent, 'createdAt'>>(events: readonly T[]): T[] {
  return [...events].sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
}

export function categoryName(cats: readonly Category[] | undefined, code: CategoryCode, locale: Locale): string {
  const c = cats?.find((x) => x.code === code);
  if (!c) return code;
  return locale === 'ar' ? c.nameAr : c.nameEn;
}

/** "Other" is always last on M-12. */
export function orderCategories(cats: readonly Category[]): Category[] {
  return [...cats].sort((a, b) => Number(a.code === 'other') - Number(b.code === 'other'));
}

/** Home action card (M-10 §1): one request → direct buttons; several → summary to M-11. */
export function homeAction<T extends Pick<RequestCore, 'status' | 'updatedAt'>>(list: readonly T[]):
  | { kind: 'none' }
  | { kind: 'one'; request: T }
  | { kind: 'many'; count: number } {
  const awaiting = list.filter(isAwaitingConfirmation);
  if (awaiting.length === 0) return { kind: 'none' };
  if (awaiting.length === 1) return { kind: 'one', request: awaiting[0]! };
  return { kind: 'many', count: awaiting.length };
}
