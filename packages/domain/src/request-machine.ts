/**
 * Request state machine (data model §3, PRD §5). Pure: no I/O, no clock.
 * The API runs `transition` inside one DB transaction; clients use the
 * `allowed*` helpers only for UI hints.
 */

export type RequestStatus = 'new' | 'in_progress' | 'done' | 'closed' | 'cancelled';
export type CloseReason = 'confirmed' | 'no_response';
export type ActorType = 'admin' | 'resident' | 'system';

export type RequestEventType =
  | 'created'
  | 'status_changed'
  | 'comment'
  | 'visit_scheduled'
  | 'visit_rescheduled'
  | 'reopened'
  | 'confirmed'
  | 'auto_closed'
  | 'cancelled';

export type NotificationType =
  | 'request_status_changed'
  | 'request_comment'
  | 'visit_scheduled'
  | 'visit_rescheduled'
  | 'visit_reminder'
  | 'announcement'
  | 'request_auto_closed'
  | 'access_revoked';

export type Command =
  | { kind: 'admin_transition'; to: 'in_progress' | 'done' }
  | { kind: 'confirm' }
  | { kind: 'reopen' }
  | { kind: 'cancel' }
  | { kind: 'auto_close' };

export interface Actor {
  type: ActorType;
  /** Resident only: the actor created this request and still has an active assignment on its unit. */
  isActiveCreator?: boolean;
}

export interface RequestState {
  status: RequestStatus;
  reopenCount: number;
}

export interface TransitionResult {
  ok: true;
  status: RequestStatus;
  closeReason: CloseReason | null;
  reopenCount: number;
  /** Set done_at = now() (true), clear it (null) or leave it (undefined). */
  doneAt: true | null | undefined;
  event: { type: RequestEventType; fromStatus: RequestStatus; toStatus: RequestStatus };
  /** Notification to the request creator, if any. Admin-facing changes go via SSE only (MVP). */
  notifyCreator: { type: NotificationType; smsFallback: boolean } | null;
}

export interface TransitionError {
  ok: false;
  code: 'invalid_transition' | 'forbidden';
}

const ADMIN_MOVES: Record<RequestStatus, ReadonlyArray<'in_progress' | 'done'>> = {
  new: ['in_progress', 'done'],
  in_progress: ['done'],
  done: [],
  closed: [],
  cancelled: [],
};

const invalid: TransitionError = { ok: false, code: 'invalid_transition' };
const forbidden: TransitionError = { ok: false, code: 'forbidden' };

export function transition(state: RequestState, command: Command, actor: Actor): TransitionResult | TransitionError {
  const from = state.status;
  switch (command.kind) {
    case 'admin_transition': {
      if (actor.type !== 'admin') return forbidden;
      if (!ADMIN_MOVES[from].includes(command.to)) return invalid;
      const toDone = command.to === 'done';
      return {
        ok: true,
        status: command.to,
        closeReason: null,
        reopenCount: state.reopenCount,
        doneAt: toDone ? true : undefined,
        event: { type: 'status_changed', fromStatus: from, toStatus: command.to },
        // Done → push + SMS fallback; In Progress → push only (architecture §6).
        notifyCreator: { type: 'request_status_changed', smsFallback: toDone },
      };
    }
    case 'confirm':
    case 'reopen':
    case 'cancel': {
      if (actor.type !== 'resident' || !actor.isActiveCreator) return forbidden;
      if (command.kind === 'cancel') {
        if (from !== 'new') return invalid;
        return ok(state, 'cancelled', null, undefined, 'cancelled', null);
      }
      if (from !== 'done') return invalid;
      if (command.kind === 'confirm') return ok(state, 'closed', 'confirmed', undefined, 'confirmed', null);
      return {
        ...ok(state, 'in_progress', null, null, 'reopened', null),
        reopenCount: state.reopenCount + 1,
      };
    }
    case 'auto_close': {
      if (actor.type !== 'system') return forbidden;
      if (from !== 'done') return invalid;
      return ok(state, 'closed', 'no_response', undefined, 'auto_closed', {
        type: 'request_auto_closed',
        smsFallback: false,
      });
    }
  }
}

function ok(
  state: RequestState,
  to: RequestStatus,
  closeReason: CloseReason | null,
  doneAt: true | null | undefined,
  eventType: RequestEventType,
  notifyCreator: TransitionResult['notifyCreator'],
): TransitionResult {
  return {
    ok: true,
    status: to,
    closeReason,
    reopenCount: state.reopenCount,
    doneAt,
    event: { type: eventType, fromStatus: state.status, toStatus: to },
    notifyCreator,
  };
}

/** Admin status options for the status panel (P-07). */
export function allowedAdminTransitions(status: RequestStatus): Array<'in_progress' | 'done'> {
  return [...ADMIN_MOVES[status]];
}

export type ResidentAction = 'confirm' | 'reopen' | 'cancel';

/** Resident decision bar (M-15). Empty when the resident is not the active creator. */
export function allowedResidentActions(status: RequestStatus, isActiveCreator: boolean): ResidentAction[] {
  if (!isActiveCreator) return [];
  if (status === 'new') return ['cancel'];
  if (status === 'done') return ['confirm', 'reopen'];
  return [];
}

/** Comments and visits are allowed until the request is closed or cancelled (A4-AC1). */
export function canComment(status: RequestStatus): boolean {
  return status !== 'closed' && status !== 'cancelled';
}

export function isOpen(status: RequestStatus): boolean {
  return status === 'new' || status === 'in_progress' || status === 'done';
}

export type RequestOutcome = 'awaiting_confirmation' | 'reopened' | 'confirmed' | 'no_response' | null;

/** Derived outcome label (data model §2). */
export function requestOutcome(status: RequestStatus, closeReason: CloseReason | null, reopenCount: number): RequestOutcome {
  if (status === 'done') return 'awaiting_confirmation';
  if (status === 'closed') return closeReason;
  if (status === 'in_progress' && reopenCount > 0) return 'reopened';
  return null;
}

export const AUTO_CLOSE_DAYS = 7;
export const COMMENT_EDIT_WINDOW_MS = 5 * 60 * 1000;

export function autoCloseAt(doneAt: Date | null): Date | null {
  return doneAt ? new Date(doneAt.getTime() + AUTO_CLOSE_DAYS * 86_400_000) : null;
}

export function formatRequestRef(refNo: number): string {
  return `REQ-${String(refNo).padStart(5, '0')}`;
}

/** Accepts "REQ-00123", "req123", "123" → 123; anything else → null. */
export function parseRequestRef(input: string): number | null {
  const m = /^\s*(?:req-?)?0*(\d{1,9})\s*$/i.exec(input);
  return m ? Number(m[1]) : null;
}

/** Command names kept from main's request-state module (`availableCommands`). */
export type RequestCommandType = 'start' | 'complete' | 'confirm' | 'reopen' | 'auto_close' | 'cancel';

/** Commands an actor may issue on a request right now (kept from main; drives which buttons clients show). */
export function availableCommands(status: RequestStatus, actor: ActorType): RequestCommandType[] {
  if (actor === 'admin') {
    return allowedAdminTransitions(status).map((to) => (to === 'in_progress' ? 'start' : 'complete'));
  }
  if (actor === 'resident') return allowedResidentActions(status, true);
  return status === 'done' ? ['auto_close'] : [];
}
