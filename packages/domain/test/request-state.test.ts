import { describe, expect, it } from 'vitest';
import {
  AUTO_CLOSE_AFTER_MS,
  DomainError,
  availableCommands,
  canComment,
  transition,
  type ActorType,
  type RequestCommand,
  type RequestStatus,
} from '../src/index.js';

const NOW = new Date('2026-11-01T10:00:00Z');
const STATUSES: RequestStatus[] = ['new', 'in_progress', 'done', 'closed', 'cancelled'];
const ACTORS: ActorType[] = ['admin', 'resident', 'system'];
const COMMANDS: RequestCommand[] = [
  { type: 'start' },
  { type: 'complete' },
  { type: 'confirm' },
  { type: 'reopen', reason: 'Still leaking' },
  { type: 'auto_close' },
  { type: 'cancel' },
];

// The only allowed (status, command, actor) triples — data model §3.
const ALLOWED: Record<string, RequestStatus> = {
  'new|start|admin': 'in_progress',
  'new|complete|admin': 'done',
  'in_progress|complete|admin': 'done',
  'done|confirm|resident': 'closed',
  'done|reopen|resident': 'in_progress',
  'done|auto_close|system': 'closed',
  'new|cancel|resident': 'cancelled',
};
const COMMAND_ACTOR: Record<RequestCommand['type'], ActorType> = {
  start: 'admin',
  complete: 'admin',
  confirm: 'resident',
  reopen: 'resident',
  auto_close: 'system',
  cancel: 'resident',
};

const oldDone = new Date(NOW.getTime() - AUTO_CLOSE_AFTER_MS);
const snap = (status: RequestStatus) => ({
  status,
  reopenCount: 0,
  doneAt: status === 'done' ? oldDone : null,
});

function codeOf(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (e) {
    return e instanceof DomainError ? e.code : 'unexpected';
  }
  return undefined;
}

describe('transition matrix', () => {
  for (const status of STATUSES)
    for (const command of COMMANDS)
      for (const actor of ACTORS) {
        const key = `${status}|${command.type}|${actor}`;
        it(key, () => {
          const run = () => transition(snap(status), command, { type: actor, id: 'x' }, NOW);
          const expected = ALLOWED[key];
          if (expected) {
            expect(run().next.status).toBe(expected);
          } else if (COMMAND_ACTOR[command.type] !== actor) {
            expect(codeOf(run)).toBe('forbidden_transition');
          } else {
            expect(codeOf(run)).toBe('invalid_transition');
          }
        });
      }
});

describe('side effects', () => {
  const admin = { type: 'admin' as const, id: 'a1' };
  const resident = { type: 'resident' as const, id: 'p1' };
  const system = { type: 'system' as const, id: null };

  it('start notifies by push only', () => {
    const r = transition(snap('new'), { type: 'start' }, admin, NOW);
    expect(r.notifications).toEqual([
      { to: 'resident', type: 'request_status_changed', status: 'in_progress', smsFallback: false },
    ]);
    expect(r.next.doneAt).toBeNull();
    expect(r.event).toMatchObject({ type: 'status_changed', fromStatus: 'new', toStatus: 'in_progress' });
    expect(r.realtime).toBe('request.updated');
  });

  it('complete sets doneAt and asks for SMS fallback', () => {
    const r = transition(snap('in_progress'), { type: 'complete' }, admin, NOW);
    expect(r.next.doneAt).toEqual(NOW);
    expect(r.next.closeReason).toBeNull();
    expect(r.notifications[0]).toMatchObject({ status: 'done', smsFallback: true });
  });

  it('confirm closes as confirmed, keeps doneAt, no notification', () => {
    const r = transition(snap('done'), { type: 'confirm' }, resident, NOW);
    expect(r.next).toMatchObject({ status: 'closed', closeReason: 'confirmed', doneAt: oldDone });
    expect(r.notifications).toEqual([]);
  });

  it('reopen increments count, clears doneAt, records reason and photos, notifies admins', () => {
    const r = transition(
      { status: 'done', reopenCount: 2, doneAt: NOW },
      { type: 'reopen', reason: '  Still leaking  ', photoUploadIds: ['u1'] },
      resident,
      NOW,
    );
    expect(r.next).toMatchObject({ status: 'in_progress', reopenCount: 3, doneAt: null });
    expect(r.event).toMatchObject({ type: 'reopened', body: 'Still leaking', photoUploadIds: ['u1'] });
    expect(r.notifications).toEqual([{ to: 'admins', type: 'request_reopened' }]);
  });

  it('reopen validates reason and photo count', () => {
    const base = { status: 'done' as const, reopenCount: 0, doneAt: NOW };
    expect(codeOf(() => transition(base, { type: 'reopen', reason: '   ' }, resident, NOW))).toBe(
      'reopen_reason_invalid',
    );
    expect(codeOf(() => transition(base, { type: 'reopen', reason: 'x'.repeat(501) }, resident, NOW))).toBe(
      'reopen_reason_invalid',
    );
    expect(
      codeOf(() =>
        transition(base, { type: 'reopen', reason: 'ok', photoUploadIds: ['1', '2', '3', '4'] }, resident, NOW),
      ),
    ).toBe('too_many_photos');
  });

  it('auto_close only after 7 days, closes as no_response and notifies resident', () => {
    const r = transition(snap('done'), { type: 'auto_close' }, system, NOW);
    expect(r.next.closeReason).toBe('no_response');
    expect(r.notifications).toEqual([{ to: 'resident', type: 'request_auto_closed' }]);

    const recent = { status: 'done' as const, reopenCount: 0, doneAt: new Date(NOW.getTime() - 1000) };
    expect(codeOf(() => transition(recent, { type: 'auto_close' }, system, NOW))).toBe('auto_close_not_due');
    const missing = { status: 'done' as const, reopenCount: 0, doneAt: null };
    expect(codeOf(() => transition(missing, { type: 'auto_close' }, system, NOW))).toBe('auto_close_not_due');
  });

  it('cancel has no notification', () => {
    expect(transition(snap('new'), { type: 'cancel' }, resident, NOW).notifications).toEqual([]);
  });
});

describe('helpers', () => {
  it('canComment until closed or cancelled', () => {
    expect(STATUSES.filter(canComment)).toEqual(['new', 'in_progress', 'done']);
  });

  it('availableCommands', () => {
    expect(availableCommands('new', 'admin')).toEqual(['start', 'complete']);
    expect(availableCommands('done', 'resident')).toEqual(['confirm', 'reopen']);
    expect(availableCommands('new', 'resident')).toEqual(['cancel']);
    expect(availableCommands('closed', 'admin')).toEqual([]);
  });

  it('DomainError default message is its code', () => {
    expect(new DomainError('x', 400).message).toBe('x');
  });
});
