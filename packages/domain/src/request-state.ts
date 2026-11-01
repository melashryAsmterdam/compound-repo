import { DomainError } from './errors.js';

/** Mirrors the request_status enum in schema.sql. */
export type RequestStatus = 'new' | 'in_progress' | 'done' | 'closed' | 'cancelled';
export type CloseReason = 'confirmed' | 'no_response';
export type ActorType = 'admin' | 'resident' | 'system';

export type RequestCommand =
  | { type: 'start' } // admin: new → in_progress
  | { type: 'complete' } // admin: new|in_progress → done
  | { type: 'confirm' } // resident: done → closed(confirmed)
  | { type: 'reopen'; reason: string; photoUploadIds?: string[] } // resident: done → in_progress
  | { type: 'auto_close' } // system: done → closed(no_response), after 7 days
  | { type: 'cancel' }; // resident: new → cancelled

export interface RequestSnapshot {
  status: RequestStatus;
  reopenCount: number;
  doneAt: Date | null;
}

export interface Actor {
  type: ActorType;
  id: string | null;
}

export type RequestEventType =
  | 'status_changed'
  | 'confirmed'
  | 'reopened'
  | 'auto_closed'
  | 'cancelled';

export type NotificationIntent =
  | { to: 'resident'; type: 'request_status_changed'; status: RequestStatus; smsFallback: boolean }
  | { to: 'resident'; type: 'request_auto_closed' }
  | { to: 'admins'; type: 'request_reopened' };

export interface TransitionResult {
  next: RequestSnapshot & { closeReason: CloseReason | null };
  event: {
    type: RequestEventType;
    fromStatus: RequestStatus;
    toStatus: RequestStatus;
    actor: Actor;
    body: string | null;
    photoUploadIds: string[];
  };
  notifications: NotificationIntent[];
  /** Event pushed to admin SSE clients (data-free; clients refetch). */
  realtime: 'request.updated';
}

export const AUTO_CLOSE_AFTER_MS = 7 * 24 * 60 * 60 * 1000;
export const REOPEN_REASON_MAX = 500;
export const REOPEN_PHOTOS_MAX = 3;

const OPEN_FOR_COMMENTS: ReadonlySet<RequestStatus> = new Set(['new', 'in_progress', 'done']);

interface Rule {
  from: readonly RequestStatus[];
  actor: ActorType;
  to: RequestStatus;
  event: RequestEventType;
}

const RULES: Record<RequestCommand['type'], Rule> = {
  start: { from: ['new'], actor: 'admin', to: 'in_progress', event: 'status_changed' },
  complete: { from: ['new', 'in_progress'], actor: 'admin', to: 'done', event: 'status_changed' },
  confirm: { from: ['done'], actor: 'resident', to: 'closed', event: 'confirmed' },
  reopen: { from: ['done'], actor: 'resident', to: 'in_progress', event: 'reopened' },
  auto_close: { from: ['done'], actor: 'system', to: 'closed', event: 'auto_closed' },
  cancel: { from: ['new'], actor: 'resident', to: 'cancelled', event: 'cancelled' },
};

/**
 * The single place a request's status may change (PRD §5, data model §3).
 * Pure: the caller persists `next` with a version check and writes `event` + `notifications`
 * in the same transaction.
 */
export function transition(
  request: RequestSnapshot,
  command: RequestCommand,
  actor: Actor,
  now: Date,
): TransitionResult {
  const rule = RULES[command.type];
  if (rule.actor !== actor.type) {
    throw new DomainError('forbidden_transition', 403);
  }
  if (!rule.from.includes(request.status)) {
    throw new DomainError('invalid_transition', 409);
  }

  let body: string | null = null;
  let photoUploadIds: string[] = [];
  if (command.type === 'reopen') {
    body = command.reason.trim();
    photoUploadIds = command.photoUploadIds ?? [];
    if (body.length === 0 || body.length > REOPEN_REASON_MAX) {
      throw new DomainError('reopen_reason_invalid', 422);
    }
    if (photoUploadIds.length > REOPEN_PHOTOS_MAX) {
      throw new DomainError('too_many_photos', 422);
    }
  }
  if (command.type === 'auto_close') {
    if (!request.doneAt || now.getTime() - request.doneAt.getTime() < AUTO_CLOSE_AFTER_MS) {
      throw new DomainError('auto_close_not_due', 409);
    }
  }

  const closeReason: CloseReason | null =
    command.type === 'confirm' ? 'confirmed' : command.type === 'auto_close' ? 'no_response' : null;

  const next = {
    status: rule.to,
    reopenCount: request.reopenCount + (command.type === 'reopen' ? 1 : 0),
    doneAt: rule.to === 'done' ? now : rule.to === 'closed' ? request.doneAt : null,
    closeReason,
  };

  return {
    next,
    event: { type: rule.event, fromStatus: request.status, toStatus: rule.to, actor, body, photoUploadIds },
    notifications: notificationsFor(command, rule.to),
    realtime: 'request.updated',
  };
}

function notificationsFor(command: RequestCommand, to: RequestStatus): NotificationIntent[] {
  switch (command.type) {
    case 'start':
    case 'complete':
      // SMS fallback only for Done (PRD R5-AC4).
      return [{ to: 'resident', type: 'request_status_changed', status: to, smsFallback: to === 'done' }];
    case 'auto_close':
      return [{ to: 'resident', type: 'request_auto_closed' }];
    case 'reopen':
      return [{ to: 'admins', type: 'request_reopened' }];
    case 'confirm':
    case 'cancel':
      return [];
  }
}

/** Comments and visit updates are allowed until a request is closed or cancelled (A4-AC1). */
export function canComment(status: RequestStatus): boolean {
  return OPEN_FOR_COMMENTS.has(status);
}

/** Commands an actor may issue on a request right now — drives which buttons clients show. */
export function availableCommands(status: RequestStatus, actor: ActorType): RequestCommand['type'][] {
  return (Object.keys(RULES) as RequestCommand['type'][]).filter((type) => {
    const rule = RULES[type];
    return rule.actor === actor && rule.from.includes(status);
  });
}
