import { describe, expect, it } from 'vitest';
import {
  allowedAdminTransitions,
  allowedResidentActions,
  autoCloseAt,
  canComment,
  type Command,
  formatRequestRef,
  isOpen,
  parseRequestRef,
  requestOutcome,
  type RequestStatus,
  transition,
  type Actor,
} from '../src/index.js';

const STATUSES: RequestStatus[] = ['new', 'in_progress', 'done', 'closed', 'cancelled'];
const COMMANDS: Command[] = [
  { kind: 'admin_transition', to: 'in_progress' },
  { kind: 'admin_transition', to: 'done' },
  { kind: 'confirm' },
  { kind: 'reopen' },
  { kind: 'cancel' },
  { kind: 'auto_close' },
];
const ACTORS: Record<string, Actor> = {
  admin: { type: 'admin' },
  creator: { type: 'resident', isActiveCreator: true },
  other: { type: 'resident', isActiveCreator: false },
  system: { type: 'system' },
};

/** Expected outcome for every allowed (status, command, actor); everything else is rejected. */
const ALLOWED: Record<string, RequestStatus> = {
  'new|admin_transition:in_progress|admin': 'in_progress',
  'new|admin_transition:done|admin': 'done',
  'in_progress|admin_transition:done|admin': 'done',
  'done|confirm|creator': 'closed',
  'done|reopen|creator': 'in_progress',
  'new|cancel|creator': 'cancelled',
  'done|auto_close|system': 'closed',
};

const cmdKey = (c: Command) => (c.kind === 'admin_transition' ? `${c.kind}:${c.to}` : c.kind);
const ownerOf = (c: Command) =>
  c.kind === 'admin_transition' ? 'admin' : c.kind === 'auto_close' ? 'system' : 'creator';

describe('transition — exhaustive state × command × actor', () => {
  for (const status of STATUSES)
    for (const command of COMMANDS)
      for (const [actorName, actor] of Object.entries(ACTORS)) {
        const key = `${status}|${cmdKey(command)}|${actorName}`;
        it(key, () => {
          const r = transition({ status, reopenCount: 0 }, command, actor);
          const expected = ALLOWED[key];
          if (expected) {
            expect(r.ok).toBe(true);
            if (r.ok) expect(r.status).toBe(expected);
          } else {
            expect(r.ok).toBe(false);
            if (!r.ok) expect(r.code).toBe(actorName === ownerOf(command) ? 'invalid_transition' : 'forbidden');
          }
        });
      }
});

describe('transition side effects', () => {
  it('done sets done_at and asks for SMS fallback', () => {
    const r = transition({ status: 'in_progress', reopenCount: 1 }, { kind: 'admin_transition', to: 'done' }, ACTORS.admin!);
    expect(r).toMatchObject({ ok: true, doneAt: true, notifyCreator: { type: 'request_status_changed', smsFallback: true } });
  });
  it('in_progress pushes without SMS fallback and keeps done_at', () => {
    const r = transition({ status: 'new', reopenCount: 0 }, { kind: 'admin_transition', to: 'in_progress' }, ACTORS.admin!);
    expect(r).toMatchObject({ ok: true, doneAt: undefined, notifyCreator: { smsFallback: false } });
  });
  it('reopen increments the count, clears done_at and records the event', () => {
    const r = transition({ status: 'done', reopenCount: 2 }, { kind: 'reopen' }, ACTORS.creator!);
    expect(r).toMatchObject({ ok: true, reopenCount: 3, doneAt: null, event: { type: 'reopened', fromStatus: 'done', toStatus: 'in_progress' }, notifyCreator: null });
  });
  it('confirm closes as confirmed', () => {
    expect(transition({ status: 'done', reopenCount: 0 }, { kind: 'confirm' }, ACTORS.creator!)).toMatchObject({ closeReason: 'confirmed', event: { type: 'confirmed' } });
  });
  it('auto close closes as no_response and notifies', () => {
    expect(transition({ status: 'done', reopenCount: 0 }, { kind: 'auto_close' }, ACTORS.system!)).toMatchObject({
      closeReason: 'no_response',
      event: { type: 'auto_closed' },
      notifyCreator: { type: 'request_auto_closed', smsFallback: false },
    });
  });
  it('cancel records cancelled', () => {
    expect(transition({ status: 'new', reopenCount: 0 }, { kind: 'cancel' }, ACTORS.creator!)).toMatchObject({ status: 'cancelled', event: { type: 'cancelled' } });
  });
});

describe('UI hints', () => {
  it('admin transitions', () => {
    expect(allowedAdminTransitions('new')).toEqual(['in_progress', 'done']);
    expect(allowedAdminTransitions('in_progress')).toEqual(['done']);
    for (const s of ['done', 'closed', 'cancelled'] as const) expect(allowedAdminTransitions(s)).toEqual([]);
  });
  it('resident actions', () => {
    expect(allowedResidentActions('new', true)).toEqual(['cancel']);
    expect(allowedResidentActions('done', true)).toEqual(['confirm', 'reopen']);
    expect(allowedResidentActions('in_progress', true)).toEqual([]);
    expect(allowedResidentActions('done', false)).toEqual([]);
  });
  it('comments and open state', () => {
    expect(STATUSES.filter(canComment)).toEqual(['new', 'in_progress', 'done']);
    expect(STATUSES.filter(isOpen)).toEqual(['new', 'in_progress', 'done']);
  });
  it('outcome', () => {
    expect(requestOutcome('done', null, 0)).toBe('awaiting_confirmation');
    expect(requestOutcome('closed', 'confirmed', 0)).toBe('confirmed');
    expect(requestOutcome('closed', 'no_response', 1)).toBe('no_response');
    expect(requestOutcome('in_progress', null, 1)).toBe('reopened');
    expect(requestOutcome('in_progress', null, 0)).toBeNull();
    expect(requestOutcome('new', null, 0)).toBeNull();
  });
  it('auto close date', () => {
    expect(autoCloseAt(null)).toBeNull();
    expect(autoCloseAt(new Date('2026-11-01T00:00:00Z'))!.toISOString()).toBe('2026-11-08T00:00:00.000Z');
  });
  it('request refs', () => {
    expect(formatRequestRef(123)).toBe('REQ-00123');
    expect(formatRequestRef(123456)).toBe('REQ-123456');
    expect(parseRequestRef('REQ-00123')).toBe(123);
    expect(parseRequestRef(' req123 ')).toBe(123);
    expect(parseRequestRef('42')).toBe(42);
    expect(parseRequestRef('B-14')).toBeNull();
  });
});
