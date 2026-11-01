import { Body, Controller, Get, Headers, HttpCode, Inject, Injectable, Param, ParseUUIDPipe, Post, Query, Req, Res, UseGuards } from '@nestjs/common';
import { allowedResidentActions, formatRequestRef } from '@compound/domain';
import type { Locale } from '@compound/i18n';
import type { Response } from 'express';
import { z } from 'zod';
import { DomainError, notFound } from '../errors';
import { AppContext } from '../infra/context';
import { audit } from '../infra/audit';
import { newId } from '../infra/crypto';
import type { Tx } from '../infra/db';
import { publish } from '../infra/realtime';
import { ResidentGuard, clientMeta, parse, resident, type AppRequest } from '../http';
import { decodeCursor, encodeCursor } from './notifications';
import { REQUEST_SELECT, RequestsCore, requestCore } from './requests-core';

const CATEGORIES = ['plumbing', 'electrical', 'ac_hvac', 'carpentry_doors', 'painting_walls', 'pest_control', 'cleaning', 'other'] as const;

const createBody = z.object({
  categoryCode: z.enum(CATEGORIES),
  description: z.string().trim().min(10).max(1000),
  locationInUnit: z.string().trim().max(100).optional(),
  preferredSlot: z.enum(['morning', 'afternoon', 'evening']).optional(),
  photoUploadIds: z.array(z.string().uuid()).max(5).optional(),
});
const versionBody = z.object({ expectedVersion: z.number().int() });
const reopenBody = z.object({ reason: z.string().trim().min(1).max(500), photoUploadIds: z.array(z.string().uuid()).max(3).optional(), expectedVersion: z.number().int() });
const listQuery = z.object({
  state: z.enum(['open', 'closed', 'all']).default('all'),
  updatedSince: z.string().datetime({ offset: true }).optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});

/**
 * Resident authorisation (05-auth §1): the caller must hold an ACTIVE assignment
 * on the unit; for a request, they must also be its creator (Q-7).
 */
@Injectable()
export class ResidentAccess {
  constructor(@Inject(AppContext) private readonly ctx: AppContext) {}

  async unit(personId: string, unitId: string): Promise<{ compoundId: string; unitStatus: string }> {
    const row = await this.ctx.db.system((tx) =>
      tx.one<any>(
        `SELECT ua.compound_id, u.status FROM unit_assignment ua JOIN unit u ON u.id = ua.unit_id
          WHERE ua.unit_id = $1 AND ua.person_id = $2 AND ua.status = 'active'`,
        [unitId, personId],
      ),
    );
    if (!row) throw new DomainError('unit_access_revoked', 403);
    return { compoundId: row.compound_id, unitStatus: row.status };
  }

  async request(personId: string, requestId: string): Promise<{ compoundId: string; unitId: string }> {
    const r = await this.ctx.db.system((tx) => tx.one<any>(`SELECT compound_id, unit_id, created_by_person_id FROM request WHERE id = $1`, [requestId]));
    if (!r || r.created_by_person_id !== personId) throw notFound();
    await this.unit(personId, r.unit_id);
    return { compoundId: r.compound_id, unitId: r.unit_id };
  }
}

@Controller('app/v1')
@UseGuards(ResidentGuard)
export class AppRequestsController {
  constructor(
    @Inject(AppContext) private readonly ctx: AppContext,
    @Inject(ResidentAccess) private readonly access: ResidentAccess,
    @Inject(RequestsCore) private readonly core: RequestsCore,
  ) {}

  private async locale(tx: Tx, personId: string): Promise<Locale> {
    return ((await tx.one<any>(`SELECT locale FROM person WHERE id = $1`, [personId]))?.locale ?? 'ar') as Locale;
  }

  async detail(tx: Tx, requestId: string, personId: string) {
    const r = await tx.one<any>(`${REQUEST_SELECT} WHERE r.id = $1`, [requestId]);
    if (!r) throw notFound();
    const locale = await this.locale(tx, personId);
    return {
      ...requestCore(r),
      locationInUnit: r.location_in_unit,
      preferredSlot: r.preferred_slot,
      photos: await this.core.requestPhotos(tx, requestId),
      timeline: await this.core.timeline(tx, requestId, 'resident', locale),
      allowedActions: allowedResidentActions(r.status, true),
    };
  }

  @Get('units/:unitId/requests')
  async list(@Req() req: AppRequest, @Param('unitId', ParseUUIDPipe) unitId: string, @Query() query: unknown) {
    const q = parse(listQuery, query);
    const me = resident(req);
    const { compoundId } = await this.access.unit(me.personId, unitId);
    const offset = decodeCursor(q.cursor);
    return this.ctx.db.tenant({ compoundId, personId: me.personId }, async (tx) => {
      const where = [`r.unit_id = $1`, `r.created_by_person_id = $2`];
      const params: unknown[] = [unitId, me.personId];
      if (q.state === 'open') where.push(`r.status IN ('new','in_progress','done')`);
      if (q.state === 'closed') where.push(`r.status IN ('closed','cancelled')`);
      if (q.updatedSince) {
        params.push(new Date(q.updatedSince));
        where.push(`r.updated_at > $${params.length}`);
      }
      const rows = await tx.query<any>(
        `${REQUEST_SELECT.replace('FROM request r', `, EXISTS (SELECT 1 FROM notification n WHERE n.request_id = r.id AND n.person_id = $2 AND n.read_at IS NULL) AS has_unread FROM request r`)}
          WHERE ${where.join(' AND ')} ORDER BY r.updated_at DESC, r.id DESC LIMIT ${q.limit + 1} OFFSET ${offset}`,
        params,
      );
      return {
        items: rows.slice(0, q.limit).map((r) => ({ ...requestCore(r), hasUnreadUpdates: r.has_unread })),
        nextCursor: rows.length > q.limit ? encodeCursor(offset + q.limit) : null,
      };
    });
  }

  /** R2. Idempotent on (creator, Idempotency-Key): a replay returns the original with 200 (R2-AC5). */
  @Post('units/:unitId/requests')
  async create(
    @Req() req: AppRequest,
    @Param('unitId', ParseUUIDPipe) unitId: string,
    @Headers('idempotency-key') key: string | undefined,
    @Body() body: unknown,
    @Res({ passthrough: true }) res: Response,
  ) {
    const idem = z.string().uuid().safeParse(key);
    if (!idem.success) throw new DomainError('validation_failed', 422, { errors: [{ field: 'Idempotency-Key', code: 'required' }] });
    const input = parse(createBody, body);
    const me = resident(req);
    const { compoundId, unitStatus } = await this.access.unit(me.personId, unitId);
    return this.ctx.db.tenant({ compoundId, personId: me.personId }, async (tx) => {
      const existing = await tx.one<any>(`SELECT id FROM request WHERE created_by_person_id = $1 AND client_request_id = $2`, [me.personId, idem.data]);
      if (existing) {
        res.status(200);
        return this.detail(tx, existing.id, me.personId);
      }
      if (unitStatus !== 'active') throw new DomainError('unit_inactive', 409);
      const now = this.ctx.now();
      const { next_request_no: refNo } = (await tx.one<any>(
        `UPDATE compound SET next_request_no = next_request_no + 1 WHERE id = $1 RETURNING next_request_no - 1 AS next_request_no`,
        [compoundId],
      ))!;
      const id = newId();
      await tx.query(
        `INSERT INTO request (id, compound_id, ref_no, unit_id, created_by_person_id, category_code, description, location_in_unit, preferred_slot, client_request_id, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$11)`,
        [id, compoundId, refNo, unitId, me.personId, input.categoryCode, input.description, input.locationInUnit || null, input.preferredSlot ?? null, idem.data, now],
      );
      await tx.query(
        `INSERT INTO request_event (id, compound_id, request_id, type, actor_type, actor_id, to_status, created_at) VALUES ($1,$2,$3,'created','resident',$4,'new',$5)`,
        [newId(), compoundId, id, me.personId, now],
      );
      if (input.photoUploadIds?.length) {
        const attached = await tx.query(
          `UPDATE upload SET request_id = $1 WHERE id = ANY($2::uuid[]) AND purpose = 'request_photo' AND uploaded_by_id = $3 AND request_id IS NULL AND status <> 'rejected' RETURNING id`,
          [id, input.photoUploadIds, me.personId],
        );
        if (attached.length !== new Set(input.photoUploadIds).size) throw new DomainError('upload_invalid', 422);
      }
      await publish(tx, { compoundId, admins: true, personIds: [me.personId], type: 'request.created', entityId: id, version: 1 });
      await audit(tx, { compoundId, actorType: 'resident', actorId: me.personId, action: 'request.create', entityType: 'request', entityId: id, changes: { ref: [null, formatRequestRef(refNo)] }, ...clientMeta(req) });
      res.status(201);
      return this.detail(tx, id, me.personId);
    });
  }

  @Get('requests/:requestId')
  async get(@Req() req: AppRequest, @Param('requestId', ParseUUIDPipe) id: string) {
    const me = resident(req);
    const { compoundId } = await this.access.request(me.personId, id);
    return this.ctx.db.tenant({ compoundId, personId: me.personId }, async (tx) => {
      await tx.query(`UPDATE notification SET read_at = now() WHERE request_id = $1 AND person_id = $2 AND read_at IS NULL`, [id, me.personId]);
      return this.detail(tx, id, me.personId);
    });
  }

  private async act(req: AppRequest, id: string, kind: 'confirm' | 'reopen' | 'cancel', body: unknown) {
    const me = resident(req);
    const { compoundId } = await this.access.request(me.personId, id);
    const input = kind === 'reopen' ? parse(reopenBody, body) : { ...parse(versionBody, body), reason: undefined, photoUploadIds: undefined };
    return this.ctx.db.tenant({ compoundId, personId: me.personId }, async (tx) => {
      await this.core.apply(tx, id, { kind }, { type: 'resident', id: me.personId, isActiveCreator: true }, {
        expectedVersion: input.expectedVersion,
        body: input.reason ?? null,
        photoUploadIds: input.photoUploadIds,
        meta: clientMeta(req),
      });
      return this.detail(tx, id, me.personId);
    });
  }

  @Post('requests/:requestId/confirm')
  @HttpCode(200)
  confirm(@Req() req: AppRequest, @Param('requestId', ParseUUIDPipe) id: string, @Body() body: unknown) {
    return this.act(req, id, 'confirm', body);
  }

  @Post('requests/:requestId/reopen')
  @HttpCode(200)
  reopen(@Req() req: AppRequest, @Param('requestId', ParseUUIDPipe) id: string, @Body() body: unknown) {
    return this.act(req, id, 'reopen', body);
  }

  @Post('requests/:requestId/cancel')
  @HttpCode(200)
  cancel(@Req() req: AppRequest, @Param('requestId', ParseUUIDPipe) id: string, @Body() body: unknown) {
    return this.act(req, id, 'cancel', body);
  }
}
