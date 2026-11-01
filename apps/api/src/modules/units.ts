import { Body, Controller, Delete, Get, HttpCode, Inject, Param, ParseUUIDPipe, Patch, Post, Put, Query, Req, UseGuards } from '@nestjs/common';
import {
  INVITATION_TTL_MS,
  INVITES_PER_UNIT_PER_DAY,
  availableChannels,
  invitationState,
  maskEmail,
  maskPhone,
  normaliseSaudiMobile,
  toWesternDigits,
} from '@compound/domain';
import { z } from 'zod';
import { DomainError, notFound } from '../errors';
import { AppContext } from '../infra/context';
import { audit } from '../infra/audit';
import { derivedToken, newId, sha256 } from '../infra/crypto';
import type { Tx } from '../infra/db';
import { enqueue } from '../infra/jobs';
import { publish } from '../infra/realtime';
import { AdminGuard, admin, clientMeta, parse, type AppRequest } from '../http';
import { iso } from './serializers';
import { AdminRequestsService } from './requests-admin';
import { NotificationsService } from './notifications';

const text = (max: number) => z.string().trim().max(max);
const nullableText = (max: number) => text(max).nullable().optional().transform((v) => (v === '' ? null : v));

const unitInput = z.object({
  number: z.string().trim().min(1).max(30).transform(toWesternDigits),
  block: nullableText(30),
  type: z.enum(['villa', 'apartment', 'townhouse', 'other']),
  floor: nullableText(10),
  notes: nullableText(500),
});
const unitPatch = unitInput.partial().extend({ status: z.enum(['active', 'inactive']).optional() });

const ownerInput = z
  .object({
    fullName: z.string().trim().min(2).max(120),
    phone: z.string().max(20).optional().nullable(),
    email: z.string().trim().toLowerCase().email().max(254).optional().nullable().or(z.literal('').transform(() => null)),
    locale: z.enum(['ar', 'en']).optional(),
  })
  .transform((o, ctx) => {
    let phone: string | null = null;
    if (o.phone) {
      phone = normaliseSaudiMobile(o.phone);
      if (!phone) ctx.addIssue({ code: 'custom', path: ['phone'], message: 'phone_invalid' });
    }
    const email = o.email || null;
    if (!phone && !email && !o.phone) ctx.addIssue({ code: 'custom', path: ['phone'], message: 'contact_required' });
    return { ...o, phone, email };
  });

const listQuery = z.object({
  q: z.string().max(100).optional(),
  block: z.string().max(30).optional(),
  activation: z.enum(['not_invited', 'invited', 'failed', 'expired', 'active']).optional(),
  status: z.enum(['active', 'inactive']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().refine((n) => n === 50).default(50),
});

const inviteBody = z.object({ channels: z.array(z.enum(['sms', 'email'])).min(1).max(2).refine((a) => new Set(a).size === a.length) });

/** Derived activation status in SQL (data model §2) so it can be filtered and paginated. */
const ACTIVATION_SQL = `
  CASE
    WHEN ua.id IS NULL THEN 'not_invited'
    WHEN ua.status = 'active' THEN 'active'
    WHEN inv.id IS NULL THEN 'not_invited'
    WHEN inv.delivery_count > 0 AND inv.failed_count = inv.delivery_count THEN 'failed'
    WHEN inv.used_at IS NULL AND inv.expires_at <= $NOW THEN 'expired'
    ELSE 'invited'
  END`;

const UNIT_SELECT = `
  SELECT u.*, ua.id AS assignment_id, ua.status AS assignment_status, ua.activated_at,
         p.id AS person_id, p.full_name, p.phone_e164, p.email AS person_email, p.locale AS person_locale,
         inv.id AS invitation_id,
         ${ACTIVATION_SQL} AS activation,
         (SELECT count(*)::int FROM request r WHERE r.unit_id = u.id AND r.status IN ('new','in_progress','done')) AS open_request_count
    FROM unit u
    LEFT JOIN unit_assignment ua ON ua.unit_id = u.id AND ua.status <> 'revoked'
    LEFT JOIN person p ON p.id = ua.person_id
    LEFT JOIN LATERAL (
      SELECT i.id, i.expires_at, i.used_at,
             (SELECT count(*) FROM message_delivery md WHERE md.invitation_id = i.id) AS delivery_count,
             (SELECT count(*) FROM message_delivery md WHERE md.invitation_id = i.id AND md.status IN ('failed','undelivered')) AS failed_count
        FROM invitation i WHERE i.assignment_id = ua.id ORDER BY i.created_at DESC LIMIT 1
    ) inv ON true`;

export function unitSummary(r: any) {
  return {
    id: r.id,
    number: r.number,
    block: r.block,
    type: r.type,
    status: r.status,
    owner: r.person_id
      ? { personId: r.person_id, fullName: r.full_name, phone: r.phone_e164, email: r.person_email, locale: r.person_locale, activatedAt: iso(r.activated_at) }
      : null,
    activation: r.activation,
    openRequestCount: r.open_request_count,
  };
}

function isUniqueViolation(e: unknown, constraint: string) {
  const err = e as { code?: string; constraint?: string; message?: string };
  return err?.code === '23505' && (err.constraint === constraint || String(err.message).includes(constraint));
}

@Controller('admin/v1/units')
@UseGuards(AdminGuard)
export class UnitsController {
  constructor(
    @Inject(AppContext) private readonly ctx: AppContext,
    @Inject(AdminRequestsService) private readonly requests: AdminRequestsService,
    @Inject(NotificationsService) private readonly notifications: NotificationsService,
  ) {}

  private tenant<T>(req: AppRequest, fn: (tx: Tx) => Promise<T>) {
    return this.ctx.db.tenant({ compoundId: admin(req).compoundId }, fn);
  }

  @Get()
  async list(@Req() req: AppRequest, @Query() query: unknown) {
    const q = parse(listQuery, query);
    const now = this.ctx.now();
    return this.tenant(req, async (tx) => {
      const where: string[] = [];
      const params: unknown[] = [now];
      const add = (sql: string, v: unknown) => {
        params.push(v);
        where.push(sql.replaceAll('$?', `$${params.length}`));
      };
      if (q.block) add('x.block = $?', q.block);
      if (q.status) add('x.status = $?', q.status);
      if (q.activation) add('x.activation = $?', q.activation);
      if (q.q) {
        const term = toWesternDigits(q.q.trim());
        const phone = normaliseSaudiMobile(term);
        if (phone) add('x.phone_e164 = $?', phone);
        else add(`(x.number ILIKE $? OR x.full_name ILIKE $? OR x.phone_e164 LIKE $? OR x.person_email ILIKE $?)`, `%${term.replace(/[%_]/g, '\\$&')}%`);
      }
      const base = `SELECT * FROM (${UNIT_SELECT.replaceAll('$NOW', '$1')}) x ${where.length ? 'WHERE ' + where.join(' AND ') : ''}`;
      const total = await tx.one<{ n: number }>(`SELECT count(*)::int AS n FROM (${base}) c`, params);
      const rows = await tx.query(
        `${base} ORDER BY x.block NULLS FIRST, length(x.number), x.number LIMIT ${q.pageSize} OFFSET ${(q.page - 1) * q.pageSize}`,
        params,
      );
      return { items: rows.map(unitSummary), page: q.page, pageSize: q.pageSize, total: total!.n };
    });
  }

  @Post()
  @HttpCode(201)
  async create(@Req() req: AppRequest, @Body() body: unknown) {
    const input = parse(unitInput, body);
    const a = admin(req);
    const id = newId();
    try {
      await this.tenant(req, async (tx) => {
        await tx.query(`INSERT INTO unit (id, compound_id, number, block, type, floor, notes) VALUES ($1,$2,$3,$4,$5,$6,$7)`, [
          id, a.compoundId, input.number, input.block ?? null, input.type, input.floor ?? null, input.notes ?? null,
        ]);
        await audit(tx, { compoundId: a.compoundId, actorType: 'admin', actorId: a.id, action: 'unit.create', entityType: 'unit', entityId: id, changes: { number: [null, input.number] }, ...clientMeta(req) });
      });
    } catch (e) {
      if (isUniqueViolation(e, 'unit_number_uq')) throw new DomainError('unit_number_taken', 409);
      throw e;
    }
    return this.detail(req, id);
  }

  @Get('blocks')
  async blocks(@Req() req: AppRequest) {
    return this.tenant(req, async (tx) => {
      const rows = await tx.query<any>(
        `SELECT u.block, count(*)::int AS unit_count,
                count(ua.id) FILTER (WHERE ua.status = 'active')::int AS active_resident_count
           FROM unit u LEFT JOIN unit_assignment ua ON ua.unit_id = u.id AND ua.status = 'active'
          WHERE u.block IS NOT NULL AND u.status = 'active'
          GROUP BY u.block ORDER BY u.block`,
      );
      return rows.map((r) => ({ block: r.block, unitCount: r.unit_count, activeResidentCount: r.active_resident_count }));
    });
  }

  /** Contract v1.1: counters for the Units page header (replaces six count calls). */
  @Get('summary')
  async summary(@Req() req: AppRequest) {
    const now = this.ctx.now();
    return this.tenant(req, async (tx) => {
      const r = await tx.one<any>(
        `SELECT count(*)::int AS total,
                count(*) FILTER (WHERE x.status = 'active')::int AS active,
                count(*) FILTER (WHERE x.status = 'inactive')::int AS inactive,
                count(*) FILTER (WHERE x.assignment_status = 'active')::int AS assigned,
                count(*) FILTER (WHERE x.person_id IS NULL)::int AS unassigned,
                count(*) FILTER (WHERE x.activation = 'invited')::int AS pending_invitations
           FROM (${UNIT_SELECT.replaceAll('$NOW', '$1')}) x`,
        [now],
      );
      return { total: r.total, active: r.active, inactive: r.inactive, assigned: r.assigned, unassigned: r.unassigned, pendingInvitations: r.pending_invitations };
    });
  }

  @Get(':unitId')
  get(@Req() req: AppRequest, @Param('unitId', ParseUUIDPipe) unitId: string) {
    return this.detail(req, unitId);
  }

  @Patch(':unitId')
  async patch(@Req() req: AppRequest, @Param('unitId', ParseUUIDPipe) unitId: string, @Body() body: unknown) {
    const input = parse(unitPatch, body);
    const a = admin(req);
    try {
      await this.tenant(req, async (tx) => {
        const before = await tx.one<any>(`SELECT * FROM unit WHERE id = $1 FOR UPDATE`, [unitId]);
        if (!before) throw notFound();
        const fields = ['number', 'block', 'type', 'floor', 'notes', 'status'] as const;
        const changes: Record<string, [unknown, unknown]> = {};
        for (const f of fields) {
          const v = (input as any)[f];
          if (v !== undefined && v !== before[f]) changes[f] = [before[f], v];
        }
        if (Object.keys(changes).length === 0) return;
        const sets = Object.keys(changes).map((f, i) => `${f} = $${i + 2}`);
        await tx.query(`UPDATE unit SET ${sets.join(', ')}, updated_at = now() WHERE id = $1`, [unitId, ...Object.values(changes).map((c) => c[1])]);
        const action = changes.status ? (changes.status[1] === 'inactive' ? 'unit.deactivate' : 'unit.activate') : 'unit.update';
        // Architect decision 2026-11-01 (Q-28): deactivating revokes the owner and their pending invitations
        // in the same transaction. Requests stay with the admin; the resident loses access.
        let revokedAssignmentId: string | null = null;
        if (action === 'unit.deactivate') {
          const current = await tx.one<any>(`SELECT * FROM unit_assignment WHERE unit_id = $1 AND status <> 'revoked'`, [unitId]);
          if (current) {
            await this.revokeAssignment(tx, current, a.id, before, this.ctx.now(), req);
            revokedAssignmentId = current.id;
          }
        }
        const auditChanges = revokedAssignmentId ? { ...changes, revokedAssignment: [revokedAssignmentId, 'unit_deactivated'] as [unknown, unknown] } : changes;
        await audit(tx, { compoundId: a.compoundId, actorType: 'admin', actorId: a.id, action, entityType: 'unit', entityId: unitId, changes: auditChanges, ...clientMeta(req) });
      });
    } catch (e) {
      if (isUniqueViolation(e, 'unit_number_uq')) throw new DomainError('unit_number_taken', 409);
      throw e;
    }
    return this.detail(req, unitId);
  }

  @Delete(':unitId')
  @HttpCode(204)
  async remove(@Req() req: AppRequest, @Param('unitId', ParseUUIDPipe) unitId: string) {
    const a = admin(req);
    await this.tenant(req, async (tx) => {
      const u = await tx.one<any>(`SELECT * FROM unit WHERE id = $1 FOR UPDATE`, [unitId]);
      if (!u) throw notFound();
      const used = await tx.one<{ n: number }>(
        `SELECT ((SELECT count(*) FROM unit_assignment WHERE unit_id = $1) + (SELECT count(*) FROM request WHERE unit_id = $1))::int AS n`,
        [unitId],
      );
      if (used!.n > 0) throw new DomainError('unit_in_use', 409);
      await tx.query(`DELETE FROM announcement_target WHERE unit_id = $1`, [unitId]);
      await tx.query(`DELETE FROM unit WHERE id = $1`, [unitId]);
      await audit(tx, { compoundId: a.compoundId, actorType: 'admin', actorId: a.id, action: 'unit.delete', entityType: 'unit', entityId: unitId, changes: { number: [u.number, null] }, ...clientMeta(req) });
    });
  }

  // ───────── owner (A2-AC1, AC6, AC7) ─────────

  @Put(':unitId/owner')
  async putOwner(@Req() req: AppRequest, @Param('unitId', ParseUUIDPipe) unitId: string, @Body() body: unknown) {
    const input = parse(ownerInput, body);
    const a = admin(req);
    const now = this.ctx.now();
    await this.tenant(req, async (tx) => {
      const unit = await tx.one<any>(`SELECT * FROM unit WHERE id = $1 FOR UPDATE`, [unitId]);
      if (!unit) throw notFound();
      const person = await this.upsertPerson(tx, input, a.compoundId);
      const current = await tx.one<any>(`SELECT * FROM unit_assignment WHERE unit_id = $1 AND status <> 'revoked'`, [unitId]);
      if (current && current.person_id === person.id) {
        await audit(tx, { compoundId: a.compoundId, actorType: 'admin', actorId: a.id, action: 'owner.update', entityType: 'unit_assignment', entityId: current.id, changes: this.maskedOwner(input), ...clientMeta(req) });
        return;
      }
      if (current) await this.revokeAssignment(tx, current, a.id, unit, now, req);
      const assignmentId = newId();
      await tx.query(
        `INSERT INTO unit_assignment (id, compound_id, unit_id, person_id, role, status, assigned_by, created_at) VALUES ($1,$2,$3,$4,'owner','invited',$5,$6)`,
        [assignmentId, a.compoundId, unitId, person.id, a.id, now],
      );
      await audit(tx, {
        compoundId: a.compoundId, actorType: 'admin', actorId: a.id, action: current ? 'owner.change' : 'owner.assign',
        entityType: 'unit_assignment', entityId: assignmentId, changes: { unitId: [null, unitId], ...this.maskedOwner(input) }, ...clientMeta(req),
      });
      await publish(tx, { compoundId: a.compoundId, admins: true, personIds: [], type: 'invitation.updated', entityId: unitId });
    });
    return this.detail(req, unitId);
  }

  @Delete(':unitId/owner')
  @HttpCode(204)
  async deleteOwner(@Req() req: AppRequest, @Param('unitId', ParseUUIDPipe) unitId: string) {
    const a = admin(req);
    await this.tenant(req, async (tx) => {
      const unit = await tx.one<any>(`SELECT * FROM unit WHERE id = $1 FOR UPDATE`, [unitId]);
      if (!unit) throw notFound();
      const current = await tx.one<any>(`SELECT * FROM unit_assignment WHERE unit_id = $1 AND status <> 'revoked'`, [unitId]);
      if (current) await this.revokeAssignment(tx, current, a.id, unit, this.ctx.now(), req);
      await publish(tx, { compoundId: a.compoundId, admins: true, personIds: [], type: 'invitation.updated', entityId: unitId });
    });
  }

  private maskedOwner(o: { fullName: string; phone: string | null; email: string | null }) {
    return { owner: [null, { name: `${o.fullName.slice(0, 1)}***`, phone: o.phone ? maskPhone(o.phone) : null, email: o.email ? maskEmail(o.email) : null }] };
  }

  /** Person is global (Q-2): match by phone first, then email. */
  private async upsertPerson(tx: Tx, o: { fullName: string; phone: string | null; email: string | null; locale?: 'ar' | 'en' }, compoundId: string) {
    const byPhone = o.phone ? await tx.one<any>(`SELECT * FROM person WHERE phone_e164 = $1`, [o.phone]) : undefined;
    const byEmail = o.email ? await tx.one<any>(`SELECT * FROM person WHERE email = $1`, [o.email]) : undefined;
    if (byPhone && byEmail && byPhone.id !== byEmail.id) {
      throw new DomainError('validation_failed', 422, { errors: [{ field: 'email', code: 'email_belongs_to_other_person' }] });
    }
    const existing = byPhone ?? byEmail;
    if (!existing) {
      const id = newId();
      const locale = o.locale ?? (await tx.one<any>(`SELECT default_locale FROM compound WHERE id = $1`, [compoundId]))!.default_locale;
      await tx.query(`INSERT INTO person (id, full_name, phone_e164, email, locale) VALUES ($1,$2,$3,$4,$5)`, [id, o.fullName, o.phone, o.email, locale]);
      return { id };
    }
    // Someone who has never activated anywhere can have their details corrected by the admin.
    const activated = await tx.one<{ n: number }>(`SELECT count(*)::int AS n FROM consent_record WHERE person_id = $1`, [existing.id]);
    await tx.query(
      `UPDATE person SET full_name = CASE WHEN $5 THEN $2 ELSE full_name END,
                         phone_e164 = COALESCE(phone_e164, $3), email = COALESCE(email, $4),
                         locale = CASE WHEN $5 AND $6::locale_code IS NOT NULL THEN $6::locale_code ELSE locale END,
                         updated_at = now()
        WHERE id = $1`,
      [existing.id, o.fullName, o.phone, o.email, activated!.n === 0, o.locale ?? null],
    );
    return { id: existing.id as string };
  }

  private async revokeAssignment(tx: Tx, current: any, adminId: string, unit: any, now: Date, req: AppRequest) {
    await tx.query(`UPDATE unit_assignment SET status = 'revoked', revoked_at = $2, revoked_by = $3 WHERE id = $1`, [current.id, now, adminId]);
    await tx.query(`UPDATE invitation SET revoked_at = $2 WHERE assignment_id = $1 AND used_at IS NULL AND revoked_at IS NULL`, [current.id, now]);
    await audit(tx, { compoundId: unit.compound_id, actorType: 'admin', actorId: adminId, action: 'owner.revoke', entityType: 'unit_assignment', entityId: current.id, ...clientMeta(req) });
    if (current.status === 'active') {
      await this.notifications.create(tx, {
        compoundId: unit.compound_id, personId: current.person_id, type: 'access_revoked', params: { unit: unit.number }, smsFallback: false,
      });
      const remaining = await tx.one<{ n: number }>(
        `SELECT count(*)::int AS n FROM unit_assignment WHERE person_id = $1 AND status = 'active'`,
        [current.person_id],
      );
      // RLS limits the count to this compound; the resident SSE handler re-checks globally.
      await publish(tx, { compoundId: unit.compound_id, admins: false, personIds: [current.person_id], type: 'session.revoked', entityId: unit.id, version: remaining!.n });
    }
  }

  // ───────── invitations (A2-AC2..AC5) ─────────

  @Get(':unitId/invitations')
  async invitations(@Req() req: AppRequest, @Param('unitId', ParseUUIDPipe) unitId: string) {
    return this.tenant(req, async (tx) => {
      const rows = await tx.query<any>(
        `SELECT i.*, a.full_name AS created_by_name FROM invitation i
           JOIN unit_assignment ua ON ua.id = i.assignment_id
           LEFT JOIN admin_user a ON a.id = i.created_by
          WHERE ua.unit_id = $1 ORDER BY i.created_at DESC LIMIT 50`,
        [unitId],
      );
      return Promise.all(rows.map((r) => this.invitationDto(tx, r)));
    });
  }

  @Post(':unitId/invitations')
  @HttpCode(201)
  async invite(@Req() req: AppRequest, @Param('unitId', ParseUUIDPipe) unitId: string, @Body() body: unknown) {
    const { channels } = parse(inviteBody, body);
    const a = admin(req);
    const now = this.ctx.now();
    return this.tenant(req, async (tx) => {
      const unit = await tx.one<any>(`SELECT * FROM unit WHERE id = $1 FOR UPDATE`, [unitId]);
      if (!unit) throw notFound();
      if (unit.status !== 'active') throw new DomainError('unit_inactive', 409);
      const asg = await tx.one<any>(
        `SELECT ua.*, p.phone_e164, p.email, p.locale FROM unit_assignment ua JOIN person p ON p.id = ua.person_id WHERE ua.unit_id = $1 AND ua.status <> 'revoked'`,
        [unitId],
      );
      if (!asg) throw new DomainError('no_owner_assigned', 409);
      if (asg.status === 'active') throw new DomainError('already_active', 409);
      const avail = availableChannels({ phone: asg.phone_e164, email: asg.email });
      if (!channels.every((c) => avail.includes(c))) throw new DomainError('channel_unavailable', 409);
      const recent = await tx.one<{ n: number }>(
        `SELECT count(*)::int AS n FROM invitation i JOIN unit_assignment ua ON ua.id = i.assignment_id WHERE ua.unit_id = $1 AND i.created_at > $2`,
        [unitId, new Date(now.getTime() - 86_400_000)],
      );
      if (recent!.n >= INVITES_PER_UNIT_PER_DAY) throw new DomainError('invite_limit_reached', 429);
      await tx.query(`UPDATE invitation SET superseded_at = $2 WHERE assignment_id = $1 AND used_at IS NULL AND superseded_at IS NULL AND revoked_at IS NULL`, [asg.id, now]);
      const id = newId();
      const token = derivedToken(this.ctx.config.TOKEN_SECRET, 'invitation', id);
      await tx.query(
        `INSERT INTO invitation (id, compound_id, assignment_id, token_hash, channels, locale, expires_at, created_by, created_at)
         VALUES ($1,$2,$3,$4,$5::channel[],$6,$7,$8,$9)`,
        [id, a.compoundId, asg.id, sha256(token), `{${channels.join(',')}}`, asg.locale, new Date(now.getTime() + INVITATION_TTL_MS), a.id, now],
      );
      for (const ch of channels) {
        const dest = ch === 'sms' ? maskPhone(asg.phone_e164) : maskEmail(asg.email);
        await tx.query(
          `INSERT INTO message_delivery (id, compound_id, invitation_id, channel, destination_masked, provider, status) VALUES ($1,$2,$3,$4,$5,$6,'queued')`,
          [newId(), a.compoundId, id, ch, dest, ch === 'sms' ? this.ctx.sms.provider : this.ctx.email.provider],
        );
      }
      // IDs only (B3): the worker re-derives the link token from TOKEN_SECRET at send time.
      await enqueue(tx, 'send-invitation', { invitationId: id, compoundId: a.compoundId });
      await audit(tx, { compoundId: a.compoundId, actorType: 'admin', actorId: a.id, action: 'invitation.send', entityType: 'invitation', entityId: id, changes: { channels: [null, channels] }, ...clientMeta(req) });
      await publish(tx, { compoundId: a.compoundId, admins: true, personIds: [], type: 'invitation.updated', entityId: unitId });
      const row = await tx.one<any>(`SELECT i.*, ad.full_name AS created_by_name FROM invitation i LEFT JOIN admin_user ad ON ad.id = i.created_by WHERE i.id = $1`, [id]);
      return this.invitationDto(tx, row);
    });
  }

  @Get(':unitId/requests')
  unitRequests(@Req() req: AppRequest, @Param('unitId', ParseUUIDPipe) unitId: string, @Query() query: any) {
    return this.requests.list(admin(req).compoundId, { ...query, unitId, sort: 'created_desc' });
  }

  private async invitationDto(tx: Tx, r: any) {
    const deliveries = await tx.query<any>(`SELECT * FROM message_delivery WHERE invitation_id = $1 ORDER BY created_at`, [r.id]);
    return {
      id: r.id,
      channels: parseChannels(r.channels),
      createdAt: iso(r.created_at),
      createdBy: r.created_by_name ?? null,
      expiresAt: iso(r.expires_at),
      state: invitationState({ expiresAt: new Date(r.expires_at), usedAt: r.used_at, supersededAt: r.superseded_at, revokedAt: r.revoked_at }, this.ctx.now()),
      deliveries: deliveries.map((d) => ({ channel: d.channel, destinationMasked: d.destination_masked, status: d.status, failureReason: d.failure_reason, updatedAt: iso(d.updated_at) })),
    };
  }

  async detail(req: AppRequest, unitId: string) {
    const now = this.ctx.now();
    return this.tenant(req, async (tx) => {
      const r = await tx.one<any>(`SELECT * FROM (${UNIT_SELECT.replaceAll('$NOW', '$2')}) x WHERE x.id = $1`, [unitId, now]);
      if (!r) throw notFound();
      let latestInvitation = null;
      if (r.invitation_id) {
        const inv = await tx.one<any>(`SELECT i.*, a.full_name AS created_by_name FROM invitation i LEFT JOIN admin_user a ON a.id = i.created_by WHERE i.id = $1`, [r.invitation_id]);
        latestInvitation = await this.invitationDto(tx, inv);
      }
      const recent = await tx.one<{ n: number }>(
        `SELECT count(*)::int AS n FROM invitation i JOIN unit_assignment ua ON ua.id = i.assignment_id WHERE ua.unit_id = $1 AND i.created_at > $2`,
        [unitId, new Date(now.getTime() - 86_400_000)],
      );
      return {
        ...unitSummary(r),
        floor: r.floor,
        notes: r.notes,
        latestInvitation,
        invitesRemainingToday: Math.max(0, INVITES_PER_UNIT_PER_DAY - recent!.n),
        createdAt: iso(r.created_at),
        updatedAt: iso(r.updated_at),
      };
    });
  }
}

/** channel[] comes back as a JS array (PGlite) or a "{sms,email}" literal (pg without array parser). */
export function parseChannels(v: unknown): string[] {
  if (Array.isArray(v)) return v;
  return String(v ?? '').replace(/[{}]/g, '').split(',').filter(Boolean);
}
