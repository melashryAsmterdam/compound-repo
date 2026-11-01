import type { Db, Tx } from './db';

/** ADR-007 payload: ids only, clients refetch. */
export interface StreamEvent {
  compoundId: string;
  /** Admin portal sessions of the compound receive it when true. */
  admins: boolean;
  /** Resident connections that should receive it. */
  personIds: string[];
  type:
    | 'request.created'
    | 'request.updated'
    | 'request.event_added'
    | 'invitation.updated'
    | 'announcement.updated'
    | 'announcement.published'
    | 'notification.created'
    | 'session.revoked';
  entityId: string;
  version?: number;
}

export async function publish(tx: Tx, evt: StreamEvent) {
  await tx.notify('events', evt);
}

type Sub = { kind: 'admin'; compoundId: string; send: (e: StreamEvent, id: number) => void } | { kind: 'resident'; personId: string; send: (e: StreamEvent, id: number) => void };

/** Per-instance SSE hub fed by LISTEN events. */
export class RealtimeHub {
  private subs = new Set<Sub>();
  private seq = 0;

  async start(db: Db) {
    await db.listen('events', (payload) => {
      try {
        this.dispatch(JSON.parse(payload) as StreamEvent);
      } catch {
        /* ignore malformed */
      }
    });
  }

  dispatch(e: StreamEvent) {
    const id = ++this.seq;
    for (const s of this.subs) {
      if (s.kind === 'admin' && e.admins && s.compoundId === e.compoundId) s.send(e, id);
      if (s.kind === 'resident' && e.personIds.includes(s.personId)) s.send(e, id);
    }
  }

  subscribe(sub: Sub): () => void {
    this.subs.add(sub);
    return () => this.subs.delete(sub);
  }

  get size() {
    return this.subs.size;
  }
}
