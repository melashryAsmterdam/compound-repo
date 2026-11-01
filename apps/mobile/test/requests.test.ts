import type { RequestCore, RequestEvent } from '@/lib/types';
import {
  categoryName, hasUpcomingVisit, homeAction, isOpen, nextVisit, orderCategories, orderedTimeline, outcomeBadges, sortRequests,
  statusChip, timelineLine, visitCardState, wasRescheduled,
} from '@/lib/requests';

const now = new Date('2026-11-12T12:00:00Z');
const req = (p: Partial<RequestCore>): RequestCore => ({
  id: 'r', ref: 'REQ-00001', unit: { id: 'u', number: '14', block: 'B' }, categoryCode: 'plumbing', description: 'Leaking tap',
  status: 'new', reopenCount: 0, version: 1, createdAt: '2026-11-10T00:00:00Z', updatedAt: '2026-11-10T00:00:00Z', ...p,
});

describe('status vocabulary (§1.3)', () => {
  it.each([
    ['new', null, 'status.new', 'new'],
    ['in_progress', null, 'status.in_progress', 'in_progress'],
    ['done', null, 'status.done', 'done'],
    ['cancelled', null, 'status.cancelled', 'cancelled'],
    ['closed', 'confirmed', 'status.closedConfirmed', 'closed'],
    ['closed', 'no_response', 'status.closedNoResponse', 'closed'],
    ['closed', null, 'status.closed', 'closed'],
  ] as const)('%s/%s → %s', (status, closeReason, key, tone) => {
    expect(statusChip(req({ status, closeReason }))).toEqual({ key, tone });
  });

  it('done shows awaiting confirmation; reopened shows ×N only while open', () => {
    expect(outcomeBadges(req({ status: 'done' })).map((b) => b.key)).toEqual(['status.awaiting']);
    expect(outcomeBadges(req({ status: 'in_progress', reopenCount: 2 }))).toEqual([{ key: 'status.reopened', params: { count: 2 }, tone: 'reopened' }]);
    expect(outcomeBadges(req({ status: 'closed', reopenCount: 2 }))).toEqual([]);
  });

  it('open = new, in_progress, done', () => {
    expect(['new', 'in_progress', 'done', 'closed', 'cancelled'].map((s) => isOpen({ status: s as never }))).toEqual([true, true, true, false, false]);
  });
});

describe('M-11 ordering', () => {
  it('puts awaiting-confirmation first, then newest update', () => {
    const list = [
      req({ id: 'a', status: 'new', updatedAt: '2026-11-12T10:00:00Z' }),
      req({ id: 'b', status: 'done', updatedAt: '2026-11-01T10:00:00Z' }),
      req({ id: 'c', status: 'in_progress', updatedAt: '2026-11-12T11:00:00Z' }),
    ];
    expect(sortRequests(list).map((r) => r.id)).toEqual(['b', 'c', 'a']);
  });
});

describe('visits', () => {
  const v = (start: string, end: string) => ({ startAt: start, endAt: end });
  it('upcoming only for open requests with a future end', () => {
    expect(hasUpcomingVisit(req({ status: 'in_progress', visit: v('2026-11-13T06:00:00Z', '2026-11-13T08:00:00Z') }), now)).toBe(true);
    expect(hasUpcomingVisit(req({ status: 'in_progress', visit: v('2026-11-11T06:00:00Z', '2026-11-11T08:00:00Z') }), now)).toBe(false);
    expect(hasUpcomingVisit(req({ status: 'closed', visit: v('2026-11-13T06:00:00Z', '2026-11-13T08:00:00Z') }), now)).toBe(false);
  });
  it('nextVisit picks the soonest', () => {
    const list = [
      req({ id: 'late', status: 'in_progress', visit: v('2026-11-20T06:00:00Z', '2026-11-20T08:00:00Z') }),
      req({ id: 'soon', status: 'new', visit: v('2026-11-13T06:00:00Z', '2026-11-13T08:00:00Z') }),
      req({ id: 'none', status: 'new' }),
    ];
    expect(nextVisit(list, now)?.id).toBe('soon');
    expect(nextVisit([req({})], now)).toBeUndefined();
  });
  it('visit card: hidden when closed/none, past when over', () => {
    expect(visitCardState(req({}), now)).toBe('hidden');
    expect(visitCardState(req({ status: 'cancelled', visit: v('2026-11-13T06:00:00Z', '2026-11-13T08:00:00Z') }), now)).toBe('hidden');
    expect(visitCardState(req({ status: 'in_progress', visit: v('2026-11-11T06:00:00Z', '2026-11-11T08:00:00Z') }), now)).toBe('past');
    expect(visitCardState(req({ status: 'in_progress', visit: v('2026-11-13T06:00:00Z', '2026-11-13T08:00:00Z') }), now)).toBe('upcoming');
  });
  it('detects reschedules', () => {
    expect(wasRescheduled([{ type: 'visit_scheduled' }])).toBe(false);
    expect(wasRescheduled([{ type: 'visit_scheduled' }, { type: 'visit_rescheduled' }])).toBe(true);
  });
});

describe('timeline (R3-AC2)', () => {
  const ev = (type: RequestEvent['type'], extra: Partial<RequestEvent> = {}): RequestEvent => ({
    id: type, type, actor: { type: 'admin' }, createdAt: '2026-11-12T00:00:00Z', ...extra,
  });
  const label = (s: string) => s.toUpperCase();
  it('maps every event type to a key and a side', () => {
    const map = Object.fromEntries(
      (['created', 'status_changed', 'comment', 'visit_scheduled', 'visit_rescheduled', 'reopened', 'confirmed', 'auto_closed', 'cancelled'] as const)
        .map((t) => [t, [timelineLine(ev(t, { toStatus: 'done', body: 'x' }), label).key, timelineLine(ev(t), label).side]]),
    );
    expect(map).toEqual({
      created: ['detail.ev_created', 'end'],
      status_changed: ['detail.ev_status_changed', 'center'],
      comment: ['detail.ev_comment', 'start'],
      visit_scheduled: ['detail.ev_visit_scheduled', 'start'],
      visit_rescheduled: ['detail.ev_visit_rescheduled', 'start'],
      reopened: ['detail.ev_reopened', 'end'],
      confirmed: ['detail.ev_confirmed', 'end'],
      auto_closed: ['detail.ev_auto_closed', 'center'],
      cancelled: ['detail.ev_cancelled', 'end'],
    });
    expect(timelineLine(ev('status_changed', { toStatus: 'done' }), label).params).toEqual({ status: 'DONE' });
    expect(timelineLine(ev('reopened', { body: 'still dripping' }), label).params).toEqual({ reason: 'still dripping' });
  });
  it('orders oldest first whatever the API order', () => {
    const list = [ev('comment', { createdAt: '2026-11-12T03:00:00Z' }), ev('created', { createdAt: '2026-11-12T01:00:00Z' })];
    expect(orderedTimeline(list).map((e) => e.type)).toEqual(['created', 'comment']);
  });
});

describe('Home action card', () => {
  it('none / one / many', () => {
    expect(homeAction([req({})])).toEqual({ kind: 'none' });
    const one = req({ id: 'd', status: 'done' });
    expect(homeAction([one, req({})])).toEqual({ kind: 'one', request: one });
    expect(homeAction([one, req({ id: 'e', status: 'done' })])).toEqual({ kind: 'many', count: 2 });
  });
});

describe('categories', () => {
  const cats = [
    { code: 'other' as const, nameAr: 'أخرى', nameEn: 'Other', icon: 'ellipsis' },
    { code: 'plumbing' as const, nameAr: 'سباكة', nameEn: 'Plumbing', icon: 'droplet' },
  ];
  it('Other is always last', () => {
    expect(orderCategories(cats).map((c) => c.code)).toEqual(['plumbing', 'other']);
  });
  it('names come from the API in the current language', () => {
    expect(categoryName(cats, 'plumbing', 'ar')).toBe('سباكة');
    expect(categoryName(cats, 'plumbing', 'en')).toBe('Plumbing');
    expect(categoryName(undefined, 'plumbing', 'en')).toBe('plumbing');
  });
});
