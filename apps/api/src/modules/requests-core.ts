import { Inject, Injectable } from '@nestjs/common';
import {
  COMMENT_EDIT_WINDOW_MS,
  autoCloseAt,
  formatRequestRef,
  requestOutcome,
  transition,
  type Actor,
  type Command,
} from '@compound/domain';
import type { Locale } from '@compound/i18n';
import { DomainError } from '../errors';
import { AppContext } from '../infra/context';
import { audit } from '../infra/audit';
import { newId } from '../infra/crypto';
import type { Tx } from '../infra/db';
import { publish } from '../infra/realtime';
import { NotificationsService } from './notifications';
import { iso } from './serializers';

export type Viewer = 'admin' | 'resident';

export const REQUEST_SELECT = `
  SELECT r.*, u.number AS unit_number, u.block AS unit_block, p.full_name AS resident_name,
         (SELECT count(*)::int FROM upload up WHERE up.request_id = r.id AND up.request_event_id IS NULL AND up.status = 'ready') AS photo_count
    FROM request r JOIN unit u ON u.id = r.unit_id JOIN person p ON p.id = r.created_by_person_id`;

export function requestCore(r: any) {
  return {
    id: r.id,
    ref: formatRequestRef(r.ref_no),
    unit: { id: r.unit_id, number: r.unit_number, block: r.unit_block },
    categoryCode: r.category_code,
    description: r.description,
    status: r.status,
    closeReason: r.close_reason,
    reopenCount: r.reopen_count,
    visit: r.visit_start_at ? { startAt: iso(r.visit_start_at), endAt: iso(r.visit_end_at) } : null,
    doneAt: iso(r.done_at),
    autoCloseAt: r.status === 'done' ? iso(autoCloseAt(r.done_at ? new Date(r.done_at) : null)) : null,
    version: r.version,
    createdAt: iso(r.created_at),
    updatedAt: iso(r.updated_at),
  };
}

export function adminSummary(r: any) {
  return {
    ...requestCore(r),
    residentName: r.resident_name,
    outcome: requestOutcome(r.status, r.close_reason, r.reopen_count),
    photoCount: r.photo_count ?? 0,
  };
}

const MANAGEMENT: Record<Locale, string> = { ar: 'الإدارة', en: 'Management' };

@Injectable()
export class RequestsCore {
  constructor(
    @Inject(AppContext) private readonly ctx: AppContext,
    @Inject(NotificationsService) private readonly notifications: NotificationsService,
  ) {}

  async photos(tx: Tx, where: string, id: string) {
    const rows = await tx.query<any>(`SELECT * FROM upload WHERE ${where} = $1 AND status = 'ready' ORDER BY created_at`, [id]);
    const now = this.ctx.now();
    return rows.map((u) => {
      const url = this.ctx.storage.signedUrl('GET', u.object_key, 600, now).url;
      return { id: u.id, url, thumbnailUrl: url, width: u.width ?? 0, height: u.height ?? 0 };
    });
  }

  async requestPhotos(tx: Tx, requestId: string) {
    const rows = await tx.query<any>(`SELECT * FROM upload WHERE request_id = $1 AND request_event_id IS NULL AND status = 'ready' ORDER BY created_at`, [requestId]);
    const now = this.ctx.now();
    return rows.map((u) => {
      const url = this.ctx.storage.signedUrl('GET', u.object_key, 600, now).url;
      return { id: u.id, url, thumbnailUrl: url, width: u.width ?? 0, height: u.height ?? 0 };
    });
  }

  async timeline(tx: Tx, requestId: string, viewer: Viewer, locale: Locale, viewerAdminId?: string) {
    const rows = await tx.query<any>(
      `SELECT e.*, a.full_name AS admin_name, p.full_name AS person_name
         FROM request_event e
         LEFT JOIN admin_user a ON e.actor_type = 'admin' AND a.id = e.actor_id
         LEFT JOIN person p ON e.actor_type = 'resident' AND p.id = e.actor_id
        WHERE e.request_id = $1 AND e.deleted_at IS NULL
        ORDER BY e.created_at, e.id`,
      [requestId],
    );
    const now = this.ctx.now().getTime();
    const out = [];
    for (const e of rows) out.push(await this.eventDto(tx, e, viewer, locale, viewerAdminId, now));
    return out;
  }

  async eventDto(tx: Tx, e: any, viewer: Viewer, locale: Locale, viewerAdminId: string | undefined, now = this.ctx.now().getTime()) {
    const displayName =
      e.actor_type === 'admin' ? (viewer === 'admin' ? e.admin_name : MANAGEMENT[locale]) : e.actor_type === 'resident' ? e.person_name : locale === 'ar' ? 'النظام' : 'System';
    const editableUntil = new Date(new Date(e.created_at).getTime() + COMMENT_EDIT_WINDOW_MS);
    const editable = viewer === 'admin' && e.actor_type === 'admin' && e.actor_id === viewerAdminId && e.body !== null && editableUntil.getTime() > now;
    return {
      id: e.id,
      type: e.type,
      actor: { type: e.actor_type, displayName },
      fromStatus: e.from_status,
      toStatus: e.to_status,
      body: e.body,
      visit: e.visit_start_at ? { startAt: iso(e.visit_start_at), endAt: iso(e.visit_end_at) } : null,
      photos: e.type === 'reopened' ? await this.photos(tx, 'request_event_id', e.id) : [],
      createdAt: iso(e.created_at),
      editedAt: iso(e.edited_at),
      editableUntil: editable ? editableUntil.toISOString() : null,
    };
  }

  /** Is the creator's assignment on the request's unit still active? (notification + resident access rule) */
  async creatorActive(tx: Tx, r: { unit_id: string; created_by_person_id: string }): Promise<boolean> {
    const a = await tx.one(`SELECT 1 FROM unit_assignment WHERE unit_id = $1 AND person_id = $2 AND status = 'active'`, [r.unit_id, r.created_by_person_id]);
    return !!a;
  }

  /**
   * Execute a state-machine command in the caller's tenant transaction:
   * optimistic version check, event, notification (creator, if still active), SSE, audit.
   */
  async apply(
    tx: Tx,
    requestId: string,
    command: Command,
    actor: Actor & { id: string | null },
    opts: { expectedVersion?: number; body?: string | null; photoUploadIds?: string[]; meta?: { ip: string | null; userAgent: string | null } } = {},
  ) {
    const r = await tx.one<any>(`SELECT * FROM request WHERE id = $1 FOR UPDATE`, [requestId]);
    if (!r) throw new DomainError('not_found', 404);
    if (opts.expectedVersion !== undefined && opts.expectedVersion !== r.version) throw new DomainError('version_conflict', 409, { currentVersion: r.version });
    const result = transition({ status: r.status, reopenCount: r.reopen_count }, command, actor);
    if (!result.ok) throw new DomainError(result.code, result.code === 'forbidden' ? 403 : 409);
    const now = this.ctx.now();
    const upd = await tx.query(
      `UPDATE request SET status = $3, close_reason = $4, reopen_count = $5,
              done_at = CASE WHEN $6::text = 'set' THEN $7::timestamptz WHEN $6::text = 'clear' THEN NULL ELSE done_at END,
              closed_at = CASE WHEN $3::request_status = 'closed' THEN $7::timestamptz ELSE closed_at END,
              version = version + 1, updated_at = $7
        WHERE id = $1 AND version = $2 RETURNING version`,
      [requestId, r.version, result.status, result.closeReason, result.reopenCount, result.doneAt === true ? 'set' : result.doneAt === null ? 'clear' : 'keep', now],
    );
    if (upd.length === 0) throw new DomainError('version_conflict', 409);
    const eventId = newId();
    await tx.query(
      `INSERT INTO request_event (id, compound_id, request_id, type, actor_type, actor_id, from_status, to_status, body, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [eventId, r.compound_id, requestId, result.event.type, actor.type, actor.id, result.event.fromStatus, result.event.toStatus, opts.body ?? null, now],
    );
    if (opts.photoUploadIds?.length) {
      const attached = await tx.query(
        `UPDATE upload SET request_id = $1, request_event_id = $2
          WHERE id = ANY($3::uuid[]) AND purpose = 'reopen_photo' AND uploaded_by_id = $4 AND request_id IS NULL AND status <> 'rejected' RETURNING id`,
        [requestId, eventId, opts.photoUploadIds, actor.id],
      );
      if (attached.length !== opts.photoUploadIds.length) throw new DomainError('upload_invalid', 422);
    }
    if (result.notifyCreator && (await this.creatorActive(tx, r))) {
      await this.notifications.create(tx, {
        compoundId: r.compound_id,
        personId: r.created_by_person_id,
        type: result.notifyCreator.type,
        requestId,
        params: { ref: formatRequestRef(r.ref_no), toStatus: result.status },
        smsFallback: result.notifyCreator.smsFallback,
      });
    }
    await publish(tx, { compoundId: r.compound_id, admins: true, personIds: [r.created_by_person_id], type: 'request.updated', entityId: requestId, version: upd[0].version });
    await audit(tx, {
      compoundId: r.compound_id,
      actorType: actor.type,
      actorId: actor.id,
      action: `request.${result.event.type === 'status_changed' ? 'transition' : result.event.type}`,
      entityType: 'request',
      entityId: requestId,
      changes: { status: [r.status, result.status] },
      ...(opts.meta ?? {}),
    });
    return { eventId, version: upd[0].version as number };
  }
}
