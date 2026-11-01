import { Body, Controller, Delete, Get, HttpCode, Inject, Injectable, Param, ParseUUIDPipe, Post, Query, Req, UseGuards } from '@nestjs/common';
import type { Locale } from '@compound/i18n';
import { z } from 'zod';
import { DomainError, notFound } from '../errors';
import { AppContext } from '../infra/context';
import { audit } from '../infra/audit';
import { newId } from '../infra/crypto';
import type { Tx } from '../infra/db';
import { enqueue } from '../infra/jobs';
import { publish } from '../infra/realtime';
import { AdminGuard, ResidentGuard, admin, clientMeta, parse, resident, type AppRequest } from '../http';
import { NotificationsService, decodeCursor, encodeCursor } from './notifications';
import { ResidentAccess } from './requests-app';
import { iso } from './serializers';

const audience = z
  .object({
    type: z.enum(['all', 'blocks', 'units']),
    blocks: z.array(z.string().max(30)).max(200).optional(),
    unitIds: z.array(z.string().uuid()).max(5000).optional(),
  })
  .superRefine((a, ctx) => {
    if (a.type === 'blocks' && !a.blocks?.length) ctx.addIssue({ code: 'custom', path: ['blocks'], message: 'audience_empty' });
    if (a.type === 'units' && !a.unitIds?.length) ctx.addIssue({ code: 'custom', path: ['unitIds'], message: 'audience_empty' });
  });
type Audience = z.infer<typeof audience>;

const opt = (max: number) => z.string().trim().max(max).optional().transform((v) => (v ? v : undefined));
const input = z
  .object({
    languages: z.enum(['ar', 'en', 'both']),
    titleAr: opt(80),
    bodyAr: opt(2000),
    titleEn: opt(80),
    bodyEn: opt(2000),
    attachmentUploadId: z.string().uuid().nullable().optional(),
    audience,
    sendSms: z.boolean().default(false),
    scheduledAt: z.string().datetime({ offset: true }).nullable().optional(),
  })
  .superRefine((v, ctx) => {
    const need = v.languages === 'both' ? ['Ar', 'En'] : [v.languages === 'ar' ? 'Ar' : 'En'];
    for (const l of need)
      for (const f of ['title', 'body'])
        if (!(v as any)[`${f}${l}`]) ctx.addIssue({ code: 'custom', path: [`${f}${l}`], message: 'announcement_invalid' });
  });
const previewBody = z.object({ audience, sendSms: z.boolean().default(false) });
const pageQuery = z.object({ cursor: z.string().optional(), limit: z.coerce.number().int().min(1).max(100).default(25) });

/** Resolve the audience to active assignments, one row per person (de-duplicated, architecture §4.3). */
export async function resolveAudience(tx: Tx, a: Audience) {
  const params: unknown[] = [];
  let filter = '';
  if (a.type === 'blocks') {
    params.push(a.blocks);
    filter = `AND u.block = ANY($1::text[])`;
  } else if (a.type === 'units') {
    params.push(a.unitIds);
    filter = `AND u.id = ANY($1::uuid[])`;
  }
  return tx.query<{ person_id: string; unit_id: string; phone_e164: string | null }>(
    `SELECT DISTINCT ON (ua.person_id) ua.person_id, ua.unit_id, p.phone_e164
       FROM unit_assignment ua JOIN unit u ON u.id = ua.unit_id JOIN person p ON p.id = ua.person_id
      WHERE ua.status = 'active' AND u.status = 'active' AND p.erased_at IS NULL ${filter}
      ORDER BY ua.person_id, u.number`,
    params,
  );
}

@Injectable()
export class AnnouncementsService {
  constructor(
    @Inject(AppContext) private readonly ctx: AppContext,
    @Inject(NotificationsService) private readonly notifications: NotificationsService,
  ) {}

  /** Dispatch: scheduled|sending → sent, snapshot recipients, one notification per person. Idempotent. */
  async dispatch(compoundId: string, announcementId: string) {
    await this.ctx.db.tenant({ compoundId }, async (tx) => {
      const a = await tx.one<any>(`SELECT * FROM announcement WHERE id = $1 FOR UPDATE`, [announcementId]);
      if (!a || a.status === 'sent' || a.status === 'deleted') return;
      const targets = await tx.query<any>(`SELECT block, unit_id FROM announcement_target WHERE announcement_id = $1`, [announcementId]);
      const aud: Audience = { type: a.audience_type, blocks: targets.filter((t) => t.block).map((t) => t.block), unitIds: targets.filter((t) => t.unit_id).map((t) => t.unit_id) };
      const recipients = await resolveAudience(tx, aud);
      const now = this.ctx.now();
      for (const r of recipients) {
        await tx.query(
          `INSERT INTO announcement_recipient (announcement_id, compound_id, person_id, unit_id) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING`,
          [announcementId, compoundId, r.person_id, r.unit_id],
        );
        await this.notifications.create(tx, {
          compoundId,
          personId: r.person_id,
          type: 'announcement',
          announcementId,
          params: { titleAr: a.title_ar ?? a.title_en, titleEn: a.title_en ?? a.title_ar, sendSms: a.send_sms ? 1 : 0 },
          smsFallback: false,
        });
      }
      const smsCount = a.send_sms ? recipients.filter((r) => r.phone_e164).length : 0;
      await tx.query(`UPDATE announcement SET status = 'sent', sent_at = $2, recipient_count = $3, sms_count = $4 WHERE id = $1`, [announcementId, now, recipients.length, smsCount]);
      await publish(tx, { compoundId, admins: true, personIds: recipients.map((r) => r.person_id), type: 'announcement.published', entityId: announcementId });
      await audit(tx, { compoundId, actorType: 'system', actorId: null, action: 'announcement.send', entityType: 'announcement', entityId: announcementId, changes: { recipients: [null, recipients.length], sms: [null, smsCount] } });
    });
  }

  /** Cron: due scheduled announcements, any compound. */
  async dispatchDue() {
    const due = await this.ctx.db.system((tx) =>
      tx.query<any>(`SELECT id, compound_id FROM announcement WHERE status = 'scheduled' AND scheduled_at <= $1 ORDER BY scheduled_at LIMIT 50`, [this.ctx.now()]),
    );
    for (const d of due) await this.dispatch(d.compound_id, d.id);
    return due.length;
  }
}

@Controller('admin/v1/announcements')
@UseGuards(AdminGuard)
export class AdminAnnouncementsController {
  constructor(@Inject(AppContext) private readonly ctx: AppContext) {}

  private async dto(tx: Tx, a: any) {
    const targets = await tx.query<any>(`SELECT block, unit_id FROM announcement_target WHERE announcement_id = $1`, [a.id]);
    const read = await tx.one<{ n: number }>(`SELECT count(*) FILTER (WHERE read_at IS NOT NULL)::int AS n FROM announcement_recipient WHERE announcement_id = $1`, [a.id]);
    let attachment = null;
    if (a.attachment_upload_id) {
      const u = await tx.one<any>(`SELECT object_key, content_type FROM upload WHERE id = $1 AND status = 'ready'`, [a.attachment_upload_id]);
      if (u) attachment = { url: this.ctx.storage.signedUrl('GET', u.object_key, 600, this.ctx.now()).url, contentType: u.content_type, fileName: u.object_key.split('/').pop() };
    }
    return {
      id: a.id,
      status: a.status,
      titleAr: a.title_ar,
      bodyAr: a.body_ar,
      titleEn: a.title_en,
      bodyEn: a.body_en,
      attachment,
      audience: {
        type: a.audience_type,
        ...(a.audience_type === 'blocks' ? { blocks: targets.map((t) => t.block) } : {}),
        ...(a.audience_type === 'units' ? { unitIds: targets.map((t) => t.unit_id) } : {}),
      },
      sendSms: a.send_sms,
      scheduledAt: iso(a.scheduled_at),
      sentAt: iso(a.sent_at),
      recipientCount: a.recipient_count,
      readCount: a.status === 'sent' || a.status === 'deleted' ? read!.n : null,
      smsCount: a.sms_count,
      createdBy: a.created_by_name ?? '',
      createdAt: iso(a.created_at),
    };
  }

  @Get()
  async list(@Req() req: AppRequest, @Query() query: unknown) {
    const { cursor, limit } = parse(pageQuery, query);
    const offset = decodeCursor(cursor);
    return this.ctx.db.tenant({ compoundId: admin(req).compoundId }, async (tx) => {
      const rows = await tx.query<any>(
        `SELECT a.*, ad.full_name AS created_by_name FROM announcement a LEFT JOIN admin_user ad ON ad.id = a.created_by
          WHERE a.status <> 'deleted' OR a.sent_at IS NOT NULL
          ORDER BY COALESCE(a.sent_at, a.scheduled_at, a.created_at) DESC LIMIT $1 OFFSET $2`,
        [limit + 1, offset],
      );
      const items = [];
      for (const r of rows.slice(0, limit)) items.push(await this.dto(tx, r));
      return { items, nextCursor: rows.length > limit ? encodeCursor(offset + limit) : null };
    });
  }

  @Post('audience-preview')
  @HttpCode(200)
  preview(@Req() req: AppRequest, @Body() body: unknown) {
    const p = parse(previewBody, body);
    return this.ctx.db.tenant({ compoundId: admin(req).compoundId }, async (tx) => {
      const r = await resolveAudience(tx, p.audience);
      return { recipientCount: r.length, smsCount: p.sendSms ? r.filter((x) => x.phone_e164).length : 0 };
    });
  }

  @Post()
  @HttpCode(201)
  async create(@Req() req: AppRequest, @Body() body: unknown) {
    const v = parse(input, body);
    const a = admin(req);
    const now = this.ctx.now();
    const scheduledAt = v.scheduledAt ? new Date(v.scheduledAt) : null;
    if (scheduledAt && scheduledAt.getTime() <= now.getTime()) throw new DomainError('schedule_in_past', 422, { errors: [{ field: 'scheduledAt', code: 'schedule_in_past' }] });
    const id = newId();
    const ar = v.languages !== 'en';
    const en = v.languages !== 'ar';
    await this.ctx.db.tenant({ compoundId: a.compoundId }, async (tx) => {
      if (v.attachmentUploadId) {
        const u = await tx.one(`SELECT 1 FROM upload WHERE id = $1 AND purpose = 'announcement_attachment' AND status <> 'rejected'`, [v.attachmentUploadId]);
        if (!u) throw new DomainError('upload_invalid', 422);
      }
      if (v.audience.type === 'units') {
        const n = await tx.one<{ n: number }>(`SELECT count(*)::int AS n FROM unit WHERE id = ANY($1::uuid[])`, [v.audience.unitIds]);
        if (n!.n !== new Set(v.audience.unitIds).size) throw new DomainError('validation_failed', 422, { errors: [{ field: 'audience.unitIds', code: 'not_found' }] });
      }
      await tx.query(
        `INSERT INTO announcement (id, compound_id, title_ar, body_ar, title_en, body_en, attachment_upload_id, audience_type, send_sms, status, scheduled_at, created_by, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
        [id, a.compoundId, ar ? v.titleAr : null, ar ? v.bodyAr : null, en ? v.titleEn : null, en ? v.bodyEn : null, v.attachmentUploadId ?? null, v.audience.type, v.sendSms, scheduledAt ? 'scheduled' : 'sending', scheduledAt, a.id, now],
      );
      if (v.attachmentUploadId) await tx.query(`UPDATE upload SET announcement_id = $2 WHERE id = $1`, [v.attachmentUploadId, id]);
      for (const b of v.audience.type === 'blocks' ? [...new Set(v.audience.blocks)] : [])
        await tx.query(`INSERT INTO announcement_target (announcement_id, compound_id, block) VALUES ($1,$2,$3)`, [id, a.compoundId, b]);
      for (const u of v.audience.type === 'units' ? [...new Set(v.audience.unitIds)] : [])
        await tx.query(`INSERT INTO announcement_target (announcement_id, compound_id, unit_id) VALUES ($1,$2,$3)`, [id, a.compoundId, u]);
      await audit(tx, { compoundId: a.compoundId, actorType: 'admin', actorId: a.id, action: scheduledAt ? 'announcement.schedule' : 'announcement.create', entityType: 'announcement', entityId: id, changes: { audience: [null, v.audience.type], sendSms: [null, v.sendSms] }, ...clientMeta(req) });
      if (!scheduledAt) await enqueue(tx, 'announcement-dispatch', { compoundId: a.compoundId, announcementId: id }, { singletonKey: `ann:${id}` });
    });
    return this.get(req, id);
  }

  @Get(':announcementId')
  get(@Req() req: AppRequest, @Param('announcementId', ParseUUIDPipe) id: string) {
    return this.ctx.db.tenant({ compoundId: admin(req).compoundId }, async (tx) => {
      const r = await tx.one<any>(`SELECT a.*, ad.full_name AS created_by_name FROM announcement a LEFT JOIN admin_user ad ON ad.id = a.created_by WHERE a.id = $1`, [id]);
      if (!r) throw notFound();
      return this.dto(tx, r);
    });
  }

  /** Scheduled → cancelled (hidden); sent → hidden from residents (A5-AC6). */
  @Delete(':announcementId')
  @HttpCode(204)
  async remove(@Req() req: AppRequest, @Param('announcementId', ParseUUIDPipe) id: string) {
    const a = admin(req);
    await this.ctx.db.tenant({ compoundId: a.compoundId }, async (tx) => {
      const r = await tx.one<any>(`SELECT * FROM announcement WHERE id = $1 FOR UPDATE`, [id]);
      if (!r) throw notFound();
      if (r.status === 'deleted') return;
      if (r.status === 'sending') throw new DomainError('announcement_not_deletable', 409);
      await tx.query(`UPDATE announcement SET status = 'deleted', deleted_at = $2, deleted_by = $3 WHERE id = $1`, [id, this.ctx.now(), a.id]);
      await tx.query(`UPDATE job SET status = 'cancelled' WHERE singleton_key = $1 AND status = 'pending'`, [`ann:${id}`]);
      const recipients = await tx.query<any>(`SELECT person_id FROM announcement_recipient WHERE announcement_id = $1`, [id]);
      await publish(tx, { compoundId: a.compoundId, admins: true, personIds: recipients.map((x) => x.person_id), type: 'announcement.updated', entityId: id });
      await audit(tx, { compoundId: a.compoundId, actorType: 'admin', actorId: a.id, action: 'announcement.delete', entityType: 'announcement', entityId: id, changes: { status: [r.status, 'deleted'] }, ...clientMeta(req) });
    });
  }
}

function pick(a: any, locale: Locale) {
  const mine = locale === 'ar' ? { t: a.title_ar, b: a.body_ar } : { t: a.title_en, b: a.body_en };
  if (mine.t) return { title: mine.t, body: mine.b, locale };
  const other: Locale = locale === 'ar' ? 'en' : 'ar';
  return { title: other === 'ar' ? a.title_ar : a.title_en, body: other === 'ar' ? a.body_ar : a.body_en, locale: other };
}

@Controller('app/v1')
@UseGuards(ResidentGuard)
export class AppAnnouncementsController {
  constructor(
    @Inject(AppContext) private readonly ctx: AppContext,
    @Inject(ResidentAccess) private readonly access: ResidentAccess,
  ) {}

  private async dto(tx: Tx, a: any, locale: Locale) {
    let attachment = null;
    if (a.attachment_upload_id) {
      const u = await tx.one<any>(`SELECT object_key, content_type FROM upload WHERE id = $1 AND status = 'ready'`, [a.attachment_upload_id]);
      if (u) attachment = { url: this.ctx.storage.signedUrl('GET', u.object_key, 600, this.ctx.now()).url, contentType: u.content_type };
    }
    return { id: a.id, ...pick(a, locale), attachment, sentAt: iso(a.sent_at), isRead: a.read_at !== null };
  }

  @Get('units/:unitId/announcements')
  async list(@Req() req: AppRequest, @Param('unitId', ParseUUIDPipe) unitId: string, @Query() query: unknown) {
    const { cursor, limit } = parse(pageQuery, query);
    const me = resident(req);
    const { compoundId } = await this.access.unit(me.personId, unitId);
    const offset = decodeCursor(cursor);
    return this.ctx.db.tenant({ compoundId, personId: me.personId }, async (tx) => {
      const locale = ((await tx.one<any>(`SELECT locale FROM person WHERE id = $1`, [me.personId]))?.locale ?? 'ar') as Locale;
      const rows = await tx.query<any>(
        `SELECT a.*, ar.read_at FROM announcement_recipient ar JOIN announcement a ON a.id = ar.announcement_id
          WHERE ar.person_id = $1 AND a.status = 'sent' ORDER BY a.sent_at DESC LIMIT $2 OFFSET $3`,
        [me.personId, limit + 1, offset],
      );
      const items = [];
      for (const r of rows.slice(0, limit)) items.push(await this.dto(tx, r, locale));
      return { items, nextCursor: rows.length > limit ? encodeCursor(offset + limit) : null };
    });
  }

  /** Opening marks it read (A5-AC5). */
  @Get('announcements/:announcementId')
  async get(@Req() req: AppRequest, @Param('announcementId', ParseUUIDPipe) id: string) {
    const me = resident(req);
    const rec = await this.ctx.db.system((tx) =>
      tx.one<any>(`SELECT ar.compound_id FROM announcement_recipient ar JOIN announcement a ON a.id = ar.announcement_id WHERE ar.announcement_id = $1 AND ar.person_id = $2 AND a.status = 'sent'`, [id, me.personId]),
    );
    if (!rec) throw notFound();
    return this.ctx.db.tenant({ compoundId: rec.compound_id, personId: me.personId }, async (tx) => {
      await tx.query(`UPDATE announcement_recipient SET read_at = COALESCE(read_at, $3) WHERE announcement_id = $1 AND person_id = $2`, [id, me.personId, this.ctx.now()]);
      await tx.query(`UPDATE notification SET read_at = COALESCE(read_at, now()) WHERE announcement_id = $1 AND person_id = $2`, [id, me.personId]);
      const locale = ((await tx.one<any>(`SELECT locale FROM person WHERE id = $1`, [me.personId]))?.locale ?? 'ar') as Locale;
      const a = await tx.one<any>(`SELECT a.*, ar.read_at FROM announcement a JOIN announcement_recipient ar ON ar.announcement_id = a.id AND ar.person_id = $2 WHERE a.id = $1`, [id, me.personId]);
      return this.dto(tx, a, locale);
    });
  }
}
