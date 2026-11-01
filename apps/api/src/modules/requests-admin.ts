import { Body, Controller, Delete, Get, HttpCode, Inject, Injectable, Param, ParseUUIDPipe, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import {
  COMMENT_EDIT_WINDOW_MS,
  allowedAdminTransitions,
  canComment,
  formatRequestRef,
  localToUtc,
  parseRequestRef,
  toWesternDigits,
  visitWindowToUtc,
} from '@compound/domain';
import { formatWindow } from '@compound/i18n';
import { z } from 'zod';
import { DomainError, notFound } from '../errors';
import { AppContext } from '../infra/context';
import { audit } from '../infra/audit';
import { newId } from '../infra/crypto';
import type { Tx } from '../infra/db';
import { publish } from '../infra/realtime';
import { AdminGuard, admin, clientMeta, localeOf, parse, type AppRequest } from '../http';
import { NotificationsService, decodeCursor, encodeCursor } from './notifications';
import { REQUEST_SELECT, RequestsCore, adminSummary } from './requests-core';

const STATUSES = ['new', 'in_progress', 'done', 'closed', 'cancelled'] as const;
const CATEGORIES = ['plumbing', 'electrical', 'ac_hvac', 'carpentry_doors', 'painting_walls', 'pest_control', 'cleaning', 'other'] as const;
const csv = <T extends string>(values: readonly [T, ...T[]]) =>
  z.preprocess((v) => (typeof v === 'string' ? v.split(',').filter(Boolean) : v), z.array(z.enum(values)).optional());
const boolQ = z.preprocess((v) => (v === 'true' ? true : v === 'false' ? false : v), z.boolean().optional());

const listQuery = z.object({
  status: csv(STATUSES),
  reopened: boolQ,
  category: csv(CATEGORIES),
  unitId: z.string().uuid().optional(),
  block: z.string().max(30).optional(),
  createdFrom: z.string().date().optional(),
  createdTo: z.string().date().optional(),
  q: z.string().max(100).optional(),
  sort: z.enum(['new_first', 'created_desc', 'created_asc', 'updated_desc']).default('new_first'),
  updatedSince: z.string().datetime({ offset: true }).optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});

const time = z.string().regex(/^([01][0-9]|2[0-3]):[0-5][0-9]$/);
const commentBody = z
  .object({
    body: z.string().trim().min(1).max(1000).optional(),
    visit: z.object({ date: z.string().date(), startTime: time, endTime: time }).optional(),
  })
  .refine((v) => v.body !== undefined || v.visit !== undefined, { message: 'validation_failed' });
const editBody = z.object({ body: z.string().trim().min(1).max(1000) });
const transitionBody = z.object({ to: z.enum(['in_progress', 'done']), expectedVersion: z.number().int() });

const SORTS: Record<string, string> = {
  new_first: `(x.status = 'new') DESC, x.created_at DESC`,
  created_desc: 'x.created_at DESC',
  created_asc: 'x.created_at ASC',
  updated_desc: 'x.updated_at DESC',
};

@Injectable()
export class AdminRequestsService {
  constructor(
    @Inject(AppContext) private readonly ctx: AppContext,
    @Inject(RequestsCore) private readonly core: RequestsCore,
  ) {}

  async list(compoundId: string, query: unknown) {
    const q = parse(listQuery, query);
    const offset = decodeCursor(q.cursor);
    return this.ctx.db.tenant({ compoundId }, async (tx) => {
      const tz = (await tx.one<any>(`SELECT timezone FROM compound WHERE id = $1`, [compoundId]))!.timezone;
      const where: string[] = [];
      const params: unknown[] = [];
      const add = (sql: string, ...vals: unknown[]) => {
        let s = sql;
        for (const v of vals) {
          params.push(v);
          s = s.replace('$?', `$${params.length}`);
        }
        where.push(s);
      };
      if (q.status?.length) add('x.status = ANY($?::request_status[])', q.status);
      if (q.reopened !== undefined) where.push(q.reopened ? 'x.reopen_count > 0' : 'x.reopen_count = 0');
      if (q.category?.length) add('x.category_code = ANY($?::text[])', q.category);
      if (q.unitId) add('x.unit_id = $?', q.unitId);
      if (q.block) add('x.unit_block = $?', q.block);
      if (q.createdFrom) add('x.created_at >= $?', localToUtc(q.createdFrom, '00:00', tz));
      if (q.createdTo) add('x.created_at < $?', new Date(localToUtc(q.createdTo, '00:00', tz).getTime() + 86_400_000));
      if (q.updatedSince) add('x.updated_at > $?', new Date(q.updatedSince));
      if (q.q?.trim()) {
        const term = toWesternDigits(q.q.trim());
        const ref = /^req/i.test(term) || /^\d+$/.test(term) ? parseRequestRef(term) : null;
        const like = `%${term.replace(/[%_\\]/g, '\\$&')}%`;
        if (ref !== null) add('(x.ref_no = $? OR lower(x.unit_number) = lower($?))', ref, term);
        else add('(lower(x.unit_number) = lower($?) OR x.description ILIKE $? OR x.resident_name ILIKE $?)', term, like, like);
      }
      const base = `SELECT * FROM (${REQUEST_SELECT}) x ${where.length ? 'WHERE ' + where.join(' AND ') : ''}`;
      const rows = await tx.query(`${base} ORDER BY ${SORTS[q.sort]}, x.id DESC LIMIT ${q.limit + 1} OFFSET ${offset}`, params);
      return { items: rows.slice(0, q.limit).map(adminSummary), nextCursor: rows.length > q.limit ? encodeCursor(offset + q.limit) : null };
    });
  }

  async detail(tx: Tx, requestId: string, adminId: string, locale: 'ar' | 'en') {
    const r = await tx.one<any>(`${REQUEST_SELECT} WHERE r.id = $1`, [requestId]);
    if (!r) throw notFound();
    const p = await tx.one<any>(`SELECT id, full_name, phone_e164, email FROM person WHERE id = $1`, [r.created_by_person_id]);
    return {
      ...adminSummary(r),
      locationInUnit: r.location_in_unit,
      preferredSlot: r.preferred_slot,
      resident: { personId: p.id, fullName: p.full_name, phone: p.phone_e164, email: p.email, isCurrentOwner: await this.core.creatorActive(tx, r) },
      photos: await this.core.requestPhotos(tx, requestId),
      timeline: await this.core.timeline(tx, requestId, 'admin', locale, adminId),
      allowedTransitions: allowedAdminTransitions(r.status),
      canComment: canComment(r.status),
    };
  }
}

@Controller('admin/v1/requests')
@UseGuards(AdminGuard)
export class AdminRequestsController {
  constructor(
    @Inject(AppContext) private readonly ctx: AppContext,
    @Inject(AdminRequestsService) private readonly svc: AdminRequestsService,
    @Inject(RequestsCore) private readonly core: RequestsCore,
    @Inject(NotificationsService) private readonly notifications: NotificationsService,
  ) {}

  @Get()
  list(@Req() req: AppRequest, @Query() query: unknown) {
    return this.svc.list(admin(req).compoundId, query);
  }

  @Get('counters')
  counters(@Req() req: AppRequest) {
    return this.ctx.db.tenant({ compoundId: admin(req).compoundId }, async (tx) => {
      const r = await tx.one<any>(
        `SELECT count(*) FILTER (WHERE status = 'new')::int AS new,
                count(*) FILTER (WHERE status = 'in_progress')::int AS in_progress,
                count(*) FILTER (WHERE status = 'done')::int AS done,
                count(*) FILTER (WHERE status = 'in_progress' AND reopen_count > 0)::int AS reopened
           FROM request`,
      );
      return { new: r.new, inProgress: r.in_progress, doneAwaitingConfirmation: r.done, reopened: r.reopened };
    });
  }

  @Get(':requestId')
  get(@Req() req: AppRequest, @Param('requestId', ParseUUIDPipe) id: string) {
    const a = admin(req);
    return this.ctx.db.tenant({ compoundId: a.compoundId }, (tx) => this.svc.detail(tx, id, a.id, localeOf(req)));
  }

  @Post(':requestId/transitions')
  @HttpCode(200)
  async transition(@Req() req: AppRequest, @Param('requestId', ParseUUIDPipe) id: string, @Body() body: unknown) {
    const { to, expectedVersion } = parse(transitionBody, body);
    const a = admin(req);
    return this.ctx.db.tenant({ compoundId: a.compoundId }, async (tx) => {
      await this.core.apply(tx, id, { kind: 'admin_transition', to }, { type: 'admin', id: a.id }, { expectedVersion, meta: clientMeta(req) });
      return this.svc.detail(tx, id, a.id, localeOf(req));
    });
  }

  /** Comment and/or schedule a visit (A4). One event; visit events carry the optional text. */
  @Post(':requestId/comments')
  @HttpCode(201)
  async comment(@Req() req: AppRequest, @Param('requestId', ParseUUIDPipe) id: string, @Body() body: unknown) {
    const input = parse(commentBody, body);
    const a = admin(req);
    const now = this.ctx.now();
    return this.ctx.db.tenant({ compoundId: a.compoundId }, async (tx) => {
      const r = await tx.one<any>(`SELECT r.*, c.timezone FROM request r JOIN compound c ON c.id = r.compound_id WHERE r.id = $1 FOR UPDATE OF r`, [id]);
      if (!r) throw notFound();
      if (!canComment(r.status)) throw new DomainError('request_closed', 409);
      let type: 'comment' | 'visit_scheduled' | 'visit_rescheduled' = 'comment';
      let visit: { startAt: Date; endAt: Date } | null = null;
      if (input.visit) {
        visit = visitWindowToUtc(input.visit, r.timezone);
        if (!visit) throw new DomainError('visit_invalid', 422, { errors: [{ field: 'visit.endTime', code: 'visit_invalid' }] });
        type = r.visit_start_at ? 'visit_rescheduled' : 'visit_scheduled';
      }
      const eventId = newId();
      await tx.query(
        `INSERT INTO request_event (id, compound_id, request_id, type, actor_type, actor_id, body, visit_start_at, visit_end_at, created_at)
         VALUES ($1,$2,$3,$4,'admin',$5,$6,$7,$8,$9)`,
        [eventId, r.compound_id, id, type, a.id, input.body ?? null, visit?.startAt ?? null, visit?.endAt ?? null, now],
      );
      const upd = await tx.one<any>(
        visit
          ? `UPDATE request SET visit_start_at = $2, visit_end_at = $3, visit_reminder_sent_at = NULL, version = version + 1, updated_at = $4 WHERE id = $1 RETURNING version`
          : `UPDATE request SET updated_at = $2 WHERE id = $1 RETURNING version`,
        visit ? [id, visit.startAt, visit.endAt, now] : [id, now],
      );
      if (await this.core.creatorActive(tx, r)) {
        const person = await tx.one<any>(`SELECT locale FROM person WHERE id = $1`, [r.created_by_person_id]);
        await this.notifications.create(tx, {
          compoundId: r.compound_id,
          personId: r.created_by_person_id,
          type: type === 'comment' ? 'request_comment' : type,
          requestId: id,
          params: { ref: formatRequestRef(r.ref_no), ...(visit ? { when: formatWindow(visit.startAt, visit.endAt, person.locale, r.timezone) } : {}) },
          smsFallback: type !== 'comment',
        });
      }
      await publish(tx, { compoundId: r.compound_id, admins: true, personIds: [r.created_by_person_id], type: 'request.event_added', entityId: id, version: upd.version });
      await audit(tx, { compoundId: r.compound_id, actorType: 'admin', actorId: a.id, action: `request.${type}`, entityType: 'request', entityId: id, ...clientMeta(req) });
      const e = await tx.one<any>(`SELECT e.*, ad.full_name AS admin_name FROM request_event e LEFT JOIN admin_user ad ON ad.id = e.actor_id WHERE e.id = $1`, [eventId]);
      return this.core.eventDto(tx, e, 'admin', localeOf(req), a.id);
    });
  }

  private async ownEditable(tx: Tx, requestId: string, eventId: string, adminId: string) {
    const e = await tx.one<any>(`SELECT * FROM request_event WHERE id = $1 AND request_id = $2 AND deleted_at IS NULL FOR UPDATE`, [eventId, requestId]);
    if (!e || !['comment', 'visit_scheduled', 'visit_rescheduled'].includes(e.type)) throw notFound();
    if (e.actor_type !== 'admin' || e.actor_id !== adminId) throw new DomainError('not_comment_author', 403);
    if (this.ctx.now().getTime() - new Date(e.created_at).getTime() > COMMENT_EDIT_WINDOW_MS) throw new DomainError('edit_window_closed', 409);
    return e;
  }

  @Patch(':requestId/comments/:eventId')
  async edit(@Req() req: AppRequest, @Param('requestId', ParseUUIDPipe) id: string, @Param('eventId', ParseUUIDPipe) eventId: string, @Body() body: unknown) {
    const { body: text } = parse(editBody, body);
    const a = admin(req);
    return this.ctx.db.tenant({ compoundId: a.compoundId }, async (tx) => {
      const e = await this.ownEditable(tx, id, eventId, a.id);
      await tx.query(`UPDATE request_event SET body = $2, edited_at = $3 WHERE id = $1`, [eventId, text, this.ctx.now()]);
      await audit(tx, { compoundId: a.compoundId, actorType: 'admin', actorId: a.id, action: 'request.comment_edit', entityType: 'request_event', entityId: eventId, changes: { length: [e.body?.length ?? 0, text.length] }, ...clientMeta(req) });
      const r = await tx.one<any>(`SELECT created_by_person_id, version FROM request WHERE id = $1`, [id]);
      await publish(tx, { compoundId: a.compoundId, admins: true, personIds: [r.created_by_person_id], type: 'request.event_added', entityId: id, version: r.version });
      const row = await tx.one<any>(`SELECT e.*, ad.full_name AS admin_name FROM request_event e LEFT JOIN admin_user ad ON ad.id = e.actor_id WHERE e.id = $1`, [eventId]);
      return this.core.eventDto(tx, row, 'admin', localeOf(req), a.id);
    });
  }

  /** Soft delete of a plain comment (visit entries stay: they drive the visit card). */
  @Delete(':requestId/comments/:eventId')
  @HttpCode(204)
  async remove(@Req() req: AppRequest, @Param('requestId', ParseUUIDPipe) id: string, @Param('eventId', ParseUUIDPipe) eventId: string) {
    const a = admin(req);
    await this.ctx.db.tenant({ compoundId: a.compoundId }, async (tx) => {
      const e = await this.ownEditable(tx, id, eventId, a.id);
      if (e.type !== 'comment') throw new DomainError('edit_window_closed', 409);
      await tx.query(`UPDATE request_event SET deleted_at = $2 WHERE id = $1`, [eventId, this.ctx.now()]);
      await audit(tx, { compoundId: a.compoundId, actorType: 'admin', actorId: a.id, action: 'request.comment_delete', entityType: 'request_event', entityId: eventId, ...clientMeta(req) });
      const r = await tx.one<any>(`SELECT created_by_person_id, version FROM request WHERE id = $1`, [id]);
      await publish(tx, { compoundId: a.compoundId, admins: true, personIds: [r.created_by_person_id], type: 'request.event_added', entityId: id, version: r.version });
    });
  }
}
