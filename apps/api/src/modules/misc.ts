import { Body, Controller, Get, HttpCode, Inject, Injectable, Param, Patch, Post, Put, Query, Req, Res, UseGuards, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { maskPhone, normaliseSaudiMobile } from '@compound/domain';
import { CATEGORIES } from '@compound/i18n';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { DomainError, notFound } from '../errors';
import { AppContext } from '../infra/context';
import { audit } from '../infra/audit';
import { newId } from '../infra/crypto';
import { enqueue } from '../infra/jobs';
import { publish } from '../infra/realtime';
import { AdminGuard, ResidentGuard, admin, clientMeta, parse, resident, type AppRequest } from '../http';
import { decodeCursor, encodeCursor } from './notifications';
import { compoundDto, iso } from './serializers';

const categories = () => CATEGORIES.map((c) => ({ code: c.code, nameAr: c.nameAr, nameEn: c.nameEn, icon: c.icon }));

const compoundPatch = z.object({
  nameAr: z.string().trim().min(1).max(120).optional(),
  nameEn: z.string().trim().min(1).max(120).optional(),
  contactPhone: z.string().max(20).optional(),
  logoUploadId: z.string().uuid().nullable().optional(),
});

@Controller('admin/v1')
@UseGuards(AdminGuard)
export class AdminMiscController {
  constructor(@Inject(AppContext) private readonly ctx: AppContext) {}

  @Get('compound')
  get(@Req() req: AppRequest) {
    const { compoundId } = admin(req);
    return this.ctx.db.tenant({ compoundId }, (tx) => compoundDto(this.ctx, tx, compoundId));
  }

  @Patch('compound')
  async patch(@Req() req: AppRequest, @Body() body: unknown) {
    const p = parse(compoundPatch, body);
    const a = admin(req);
    let phone: string | undefined;
    if (p.contactPhone !== undefined) {
      // The compound line may be a landline: accept a Saudi mobile, or any +966 number of 8–9 digits.
      const digits = p.contactPhone.replace(/[\s-]/g, '');
      phone = normaliseSaudiMobile(digits) ?? (/^\+9661\d{7,8}$|^\+966[89]\d{8}$/.test(digits) ? digits : undefined);
      if (!phone) throw new DomainError('phone_invalid', 422, { errors: [{ field: 'contactPhone', code: 'phone_invalid' }] });
    }
    return this.ctx.db.tenant({ compoundId: a.compoundId }, async (tx) => {
      if (p.logoUploadId) {
        const u = await tx.one(`SELECT 1 FROM upload WHERE id = $1 AND purpose = 'compound_logo' AND status <> 'rejected'`, [p.logoUploadId]);
        if (!u) throw new DomainError('upload_invalid', 422);
      }
      const before = await tx.one<any>(`SELECT * FROM compound WHERE id = $1 FOR UPDATE`, [a.compoundId]);
      await tx.query(
        `UPDATE compound SET name_ar = COALESCE($2, name_ar), name_en = COALESCE($3, name_en), contact_phone = COALESCE($4, contact_phone),
                logo_upload_id = CASE WHEN $6 THEN $5::uuid ELSE logo_upload_id END, updated_at = now() WHERE id = $1`,
        [a.compoundId, p.nameAr ?? null, p.nameEn ?? null, phone ?? null, p.logoUploadId ?? null, p.logoUploadId !== undefined],
      );
      const changes: Record<string, unknown> = {};
      if (p.nameAr && p.nameAr !== before.name_ar) changes.nameAr = [before.name_ar, p.nameAr];
      if (p.nameEn && p.nameEn !== before.name_en) changes.nameEn = [before.name_en, p.nameEn];
      if (phone && phone !== before.contact_phone) changes.contactPhone = [maskPhone(before.contact_phone), maskPhone(phone)];
      if (p.logoUploadId !== undefined) changes.logo = [before.logo_upload_id, p.logoUploadId];
      await audit(tx, { compoundId: a.compoundId, actorType: 'admin', actorId: a.id, action: 'compound.update', entityType: 'compound', entityId: a.compoundId, changes, ...clientMeta(req) });
      return compoundDto(this.ctx, tx, a.compoundId);
    });
  }

  @Get('categories')
  categories() {
    return categories();
  }

  @Get('audit-log')
  auditLog(@Req() req: AppRequest, @Query() query: any) {
    const q = parse(
      z.object({ entityType: z.string().max(50).optional(), entityId: z.string().uuid().optional(), cursor: z.string().optional(), limit: z.coerce.number().int().min(1).max(100).default(25) }),
      query,
    );
    const offset = decodeCursor(q.cursor);
    return this.ctx.db.tenant({ compoundId: admin(req).compoundId }, async (tx) => {
      const rows = await tx.query<any>(
        `SELECT l.*, a.full_name AS admin_name, p.full_name AS person_name FROM audit_log l
           LEFT JOIN admin_user a ON l.actor_type = 'admin' AND a.id = l.actor_id
           LEFT JOIN person p ON l.actor_type = 'resident' AND p.id = l.actor_id
          WHERE ($1::text IS NULL OR l.entity_type = $1) AND ($2::uuid IS NULL OR l.entity_id = $2)
          ORDER BY l.id DESC LIMIT $3 OFFSET $4`,
        [q.entityType ?? null, q.entityId ?? null, q.limit + 1, offset],
      );
      return {
        items: rows.slice(0, q.limit).map((r) => ({
          id: Number(r.id),
          actor: { type: r.actor_type, displayName: r.admin_name ?? r.person_name ?? r.actor_type },
          action: r.action,
          entityType: r.entity_type,
          entityId: r.entity_id,
          changes: r.changes ?? {},
          createdAt: iso(r.created_at),
        })),
        nextCursor: rows.length > q.limit ? encodeCursor(offset + q.limit) : null,
      };
    });
  }
}

@Controller('app/v1/categories')
@UseGuards(ResidentGuard)
export class AppCategoriesController {
  @Get()
  list() {
    return categories();
  }
}

// ───────── uploads (ADR-013): signed PUT, then the worker sanitises ─────────

const uploadInit = z.object({
  purpose: z.enum(['request_photo', 'reopen_photo', 'announcement_attachment', 'compound_logo']),
  contentType: z.enum(['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'application/pdf']),
  bytes: z.number().int().min(1).max(10_485_760),
});
const EXT: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/heic': 'heic', 'application/pdf': 'pdf' };

async function createUpload(ctx: AppContext, compoundId: string, actorType: 'admin' | 'resident', actorId: string, body: unknown, allowed: string[]) {
  const u = parse(uploadInit, body);
  if (!allowed.includes(u.purpose)) throw new DomainError('upload_invalid', 422, { errors: [{ field: 'purpose', code: 'not_allowed' }] });
  if (u.contentType === 'application/pdf' && u.purpose !== 'announcement_attachment') throw new DomainError('upload_invalid', 422, { errors: [{ field: 'contentType', code: 'not_allowed' }] });
  const id = newId();
  const key = `attachments/${compoundId}/${id}.${EXT[u.contentType]}`;
  await ctx.db.tenant({ compoundId }, (tx) =>
    tx.query(
      `INSERT INTO upload (id, compound_id, purpose, uploaded_by_type, uploaded_by_id, object_key, content_type, bytes) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [id, compoundId, u.purpose, actorType, actorId, key, u.contentType, u.bytes],
    ),
  );
  const signed = ctx.storage.signedUrl('PUT', key, 600, ctx.now());
  return { uploadId: id, uploadUrl: signed.url, method: 'PUT', headers: { 'Content-Type': u.contentType }, expiresAt: signed.expiresAt.toISOString() };
}

@Controller()
export class UploadsController {
  constructor(@Inject(AppContext) private readonly ctx: AppContext) {}

  @Post('admin/v1/uploads')
  @HttpCode(201)
  @UseGuards(AdminGuard)
  adminUpload(@Req() req: AppRequest, @Body() body: unknown) {
    const a = admin(req);
    return createUpload(this.ctx, a.compoundId, 'admin', a.id, body, ['announcement_attachment', 'compound_logo']);
  }

  /** Resident uploads are scoped to the compound of one of their active units. */
  @Post('app/v1/uploads')
  @HttpCode(201)
  @UseGuards(ResidentGuard)
  async appUpload(@Req() req: AppRequest, @Body() body: unknown, @Query('unitId') unitId?: string) {
    const me = resident(req);
    const asg = await this.ctx.db.system((tx) =>
      tx.one<any>(
        `SELECT compound_id FROM unit_assignment WHERE person_id = $1 AND status = 'active' AND ($2::uuid IS NULL OR unit_id = $2) ORDER BY activated_at LIMIT 1`,
        [me.personId, unitId && /^[0-9a-f-]{36}$/i.test(unitId) ? unitId : null],
      ),
    );
    if (!asg) throw new DomainError('unit_access_revoked', 403);
    return createUpload(this.ctx, asg.compound_id, 'resident', me.personId, body, ['request_photo', 'reopen_photo']);
  }

  /** Local object store endpoint (stands in for GCS signed URLs). */
  @Put('_storage/:key')
  @HttpCode(200)
  async put(@Param('key') key: string, @Query() q: any, @Req() req: Request) {
    if (!this.ctx.storage.verify('PUT', key, q.exp, q.sig, this.ctx.now())) throw new DomainError('forbidden', 403);
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const c of req) {
      size += (c as Buffer).length;
      if (size > 10_485_760) throw new DomainError('upload_invalid', 413);
      chunks.push(c as Buffer);
    }
    const data = Buffer.concat(chunks);
    this.ctx.storage.put(key, data);
    const id = key.split('/').pop()!.split('.')[0]!;
    const compoundId = key.split('/')[1]!;
    await this.ctx.db.tenant({ compoundId }, (tx) => enqueue(tx, 'process-upload', { uploadId: id, compoundId }, { singletonKey: `upload:${id}` }));
    return { ok: true };
  }

  @Get('_storage/:key')
  get(@Param('key') key: string, @Query() q: any, @Res() res: Response) {
    if (!this.ctx.storage.verify('GET', key, q.exp, q.sig, this.ctx.now())) throw new DomainError('forbidden', 403);
    const data = this.ctx.storage.get(key);
    if (!data) throw notFound();
    const ext = key.split('.').pop();
    res.type(ext === 'pdf' ? 'application/pdf' : ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg');
    res.setHeader('Cache-Control', 'private, max-age=600');
    res.send(data);
  }
}

// ───────── realtime (ADR-007) ─────────

@Controller()
export class StreamsController {
  constructor(@Inject(AppContext) private readonly ctx: AppContext) {}

  private open(req: Request, res: Response) {
    res.status(200);
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();
    res.write('retry: 5000\n\n');
    const ping = setInterval(() => res.write(': ping\n\n'), 25_000);
    return (unsubscribe: () => void) =>
      req.on('close', () => {
        clearInterval(ping);
        unsubscribe();
      });
  }

  @Get('admin/v1/events/stream')
  @UseGuards(AdminGuard)
  adminStream(@Req() req: AppRequest, @Res() res: Response) {
    const onClose = this.open(req, res);
    const { compoundId } = admin(req);
    onClose(
      this.ctx.hub.subscribe({
        kind: 'admin',
        compoundId,
        send: (e, id) => res.write(`id: ${id}\nevent: ${e.type}\ndata: ${JSON.stringify({ type: e.type, entityId: e.entityId, version: e.version })}\n\n`),
      }),
    );
  }

  @Get('app/v1/events/stream')
  @UseGuards(ResidentGuard)
  appStream(@Req() req: AppRequest, @Res() res: Response) {
    const onClose = this.open(req, res);
    const { personId } = resident(req);
    onClose(
      this.ctx.hub.subscribe({
        kind: 'resident',
        personId,
        send: (e, id) => {
          void (async () => {
            if (e.type === 'session.revoked') {
              // Only a real sign-out when no active unit is left in ANY compound.
              const n = await this.ctx.db.system((tx) => tx.one<{ n: number }>(`SELECT count(*)::int AS n FROM unit_assignment WHERE person_id = $1 AND status = 'active'`, [personId]));
              if (n!.n > 0) {
                res.write(`id: ${id}\nevent: request.updated\ndata: ${JSON.stringify({ type: 'unit.revoked', entityId: e.entityId })}\n\n`);
                return;
              }
            }
            res.write(`id: ${id}\nevent: ${e.type}\ndata: ${JSON.stringify({ type: e.type, entityId: e.entityId, version: e.version })}\n\n`);
          })();
        },
      }),
    );
  }
}

// ───────── delivery webhooks ─────────

const receipt = z.object({ messageId: z.string().min(1).max(200), status: z.enum(['sent', 'delivered', 'failed', 'undelivered']), reason: z.string().max(200).optional() });

/**
 * Normalised receipt shape. Provider-specific payload mapping (Unifonic/Taqnyat
 * fields, signature check) plugs in per provider; MVP verifies a shared secret.
 */
@Controller('webhooks')
export class WebhooksController {
  constructor(@Inject(AppContext) private readonly ctx: AppContext) {}

  private async apply(req: Request, body: unknown) {
    const secret = process.env.WEBHOOK_SECRET;
    if (secret && req.headers['x-webhook-secret'] !== secret) throw new DomainError('forbidden', 403);
    if (!secret && this.ctx.config.NODE_ENV === 'production') throw new DomainError('forbidden', 403);
    const r = parse(receipt, body);
    await this.ctx.db.system(async (tx) => {
      const rows = await tx.query<any>(
        `UPDATE message_delivery SET status = $2, failure_reason = $3, updated_at = now()
          WHERE provider_message_id = $1 AND status NOT IN ('delivered') RETURNING compound_id, invitation_id`,
        [r.messageId, r.status, r.reason ?? null],
      );
      for (const d of rows) {
        if (d.invitation_id) {
          const u = await tx.one<any>(`SELECT ua.unit_id FROM invitation i JOIN unit_assignment ua ON ua.id = i.assignment_id WHERE i.id = $1`, [d.invitation_id]);
          await publish(tx, { compoundId: d.compound_id, admins: true, personIds: [], type: 'invitation.updated', entityId: u.unit_id });
        }
      }
    });
  }

  @Post('sms/:provider')
  @HttpCode(204)
  sms(@Param('provider') provider: string, @Req() req: Request, @Body() body: unknown) {
    z.enum(['unifonic', 'taqnyat']).parse(provider);
    return this.apply(req, body);
  }

  @Post('email/:provider')
  @HttpCode(204)
  email(@Req() req: Request, @Body() body: unknown) {
    return this.apply(req, body);
  }
}

@Controller('healthz')
export class HealthController {
  @Get()
  ok() {
    return { status: 'ok' };
  }
}

/** "1.2.10" → [1, 2, 10]; null for anything that is not a plain x.y.z version. */
export function parseVersion(v: unknown): [number, number, number] | null {
  const m = typeof v === 'string' ? /^(\d+)\.(\d+)\.(\d+)$/.exec(v.trim()) : null;
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}
export function versionBelow(v: [number, number, number], min: [number, number, number]): boolean {
  for (let i = 0; i < 3; i++) if (v[i] !== min[i]) return v[i]! < min[i]!;
  return false;
}

/** Contract v1.1: public app version info; the app forces an update below the minimum. */
@Controller('app/v1/meta')
export class AppMetaController {
  constructor(@Inject(AppContext) private readonly ctx: AppContext) {}

  @Get()
  meta() {
    const c = this.ctx.config;
    return {
      minSupportedVersion: { ios: c.APP_MIN_VERSION_IOS, android: c.APP_MIN_VERSION_ANDROID },
      latestVersion: { ios: c.APP_LATEST_VERSION_IOS, android: c.APP_LATEST_VERSION_ANDROID },
    };
  }
}

/**
 * 426 app_update_required on /app/v1 (except /app/v1/meta) when X-App-Version is below the minimum.
 * The contract sends no platform header, so the check uses the lower of the two minimums; the app's
 * own start-up call to /meta enforces the per-platform minimum. Requests without the header pass.
 */
@Injectable()
export class AppVersionGuard implements CanActivate {
  constructor(private readonly ctx: AppContext) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request>();
    if (!req.path.startsWith('/app/v1/') || req.path.startsWith('/app/v1/meta')) return true;
    const v = parseVersion(req.headers['x-app-version']);
    if (!v) return true;
    const mins = [parseVersion(this.ctx.config.APP_MIN_VERSION_IOS)!, parseVersion(this.ctx.config.APP_MIN_VERSION_ANDROID)!];
    const lowest = versionBelow(mins[0]!, mins[1]!) ? mins[0]! : mins[1]!;
    if (versionBelow(v, lowest)) throw new DomainError('app_update_required', 426);
    return true;
  }
}
