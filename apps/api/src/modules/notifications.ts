import { Controller, Get, HttpCode, Inject, Injectable, Param, ParseUUIDPipe, Post, Query, Req, UseGuards } from '@nestjs/common';
import type { NotificationType } from '@compound/domain';
import { notificationText, type Locale } from '@compound/i18n';
import { z } from 'zod';
import { AppContext } from '../infra/context';
import { newId } from '../infra/crypto';
import type { Tx } from '../infra/db';
import { enqueue } from '../infra/jobs';
import { publish } from '../infra/realtime';
import { ResidentGuard, parse, resident, type AppRequest } from '../http';
import { iso } from './serializers';

export interface NewNotification {
  compoundId: string;
  personId: string;
  type: NotificationType;
  requestId?: string | null;
  announcementId?: string | null;
  /** Template params: ref, unit, toStatus, title, when… Never names/descriptions (PDPL push minimisation). */
  params: Record<string, string | number>;
  smsFallback: boolean;
}

export function templateKey(type: string, params: Record<string, unknown>): string {
  return type === 'request_status_changed' ? `request_status_changed_${params.toStatus === 'done' ? 'done' : 'in_progress'}` : type;
}

export function deepLink(n: { request_id?: string | null; announcement_id?: string | null }): string {
  if (n.request_id) return `compound://requests/${n.request_id}`;
  if (n.announcement_id) return `compound://announcements/${n.announcement_id}`;
  return 'compound://notifications';
}

/** Notification rows are the in-app list (R5-AC2) and the delivery outbox (architecture §6). */
@Injectable()
export class NotificationsService {
  async create(tx: Tx, n: NewNotification): Promise<string> {
    const id = newId();
    await tx.query(
      `INSERT INTO notification (id, compound_id, person_id, type, request_id, announcement_id, params, sms_fallback)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [id, n.compoundId, n.personId, n.type, n.requestId ?? null, n.announcementId ?? null, JSON.stringify(n.params), n.smsFallback],
    );
    await enqueue(tx, 'send-notification', { notificationId: id, compoundId: n.compoundId }, { singletonKey: `notif:${id}` });
    await publish(tx, { compoundId: n.compoundId, admins: false, personIds: [n.personId], type: 'notification.created', entityId: id });
    return id;
  }
}

/** Compound short names for push titles, cached per call. */
export async function compoundNames(tx: Tx, ids: string[]): Promise<Map<string, { ar: string; en: string }>> {
  const rows = ids.length ? await tx.query<any>(`SELECT id, name_ar, name_en FROM compound WHERE id = ANY($1::uuid[])`, [ids]) : [];
  return new Map(rows.map((r) => [r.id, { ar: r.name_ar, en: r.name_en }]));
}

export function renderNotification(n: any, locale: Locale, compoundName: string) {
  const params: Record<string, string | number> = { ...(n.params ?? {}), compound: compoundName };
  if (n.type === 'announcement') params.title = (locale === 'ar' ? params.titleAr : params.titleEn) ?? '';
  return notificationText(templateKey(n.type, params), locale, params);
}

const pageQuery = z.object({ cursor: z.string().optional(), limit: z.coerce.number().int().min(1).max(100).default(25) });

export const decodeCursor = (c?: string) => (c ? Math.max(0, Number(JSON.parse(Buffer.from(c, 'base64url').toString()).o) || 0) : 0);
export const encodeCursor = (o: number) => Buffer.from(JSON.stringify({ o })).toString('base64url');

@Controller('app/v1/notifications')
@UseGuards(ResidentGuard)
export class AppNotificationsController {
  constructor(@Inject(AppContext) private readonly ctx: AppContext) {}

  @Get()
  async list(@Req() req: AppRequest, @Query() query: unknown) {
    const { cursor, limit } = parse(pageQuery, query);
    const me = resident(req);
    const offset = decodeCursor(cursor);
    // Person-scoped and cross-compound (one person may own units in several compounds).
    return this.ctx.db.system(async (tx) => {
      const person = await tx.one<any>(`SELECT locale FROM person WHERE id = $1`, [me.personId]);
      const rows = await tx.query<any>(
        `SELECT n.* FROM notification n
          WHERE n.person_id = $1 AND n.type <> 'access_revoked'
            AND (n.announcement_id IS NULL OR EXISTS (SELECT 1 FROM announcement a WHERE a.id = n.announcement_id AND a.status <> 'deleted'))
          ORDER BY n.created_at DESC LIMIT $2 OFFSET $3`,
        [me.personId, limit + 1, offset],
      );
      const unread = await tx.one<{ n: number }>(
        `SELECT count(*)::int AS n FROM notification WHERE person_id = $1 AND read_at IS NULL AND type <> 'access_revoked'`,
        [me.personId],
      );
      // Opening the list counts as receipt (architecture §6 step 3).
      await tx.query(`UPDATE notification SET client_ack_at = now() WHERE person_id = $1 AND client_ack_at IS NULL`, [me.personId]);
      const names = await compoundNames(tx, [...new Set(rows.map((r) => r.compound_id))]);
      const locale: Locale = person?.locale ?? 'ar';
      const items = rows.slice(0, limit).map((n) => {
        const t = renderNotification(n, locale, names.get(n.compound_id)?.[locale] ?? '');
        return { id: n.id, type: n.type, title: t.title, body: t.body, deepLink: deepLink(n), requestId: n.request_id, announcementId: n.announcement_id, createdAt: iso(n.created_at), isRead: n.read_at !== null };
      });
      return { items, unreadCount: unread!.n, nextCursor: rows.length > limit ? encodeCursor(offset + limit) : null };
    });
  }

  @Post('read-all')
  @HttpCode(204)
  async readAll(@Req() req: AppRequest) {
    await this.ctx.db.system((tx) => tx.query(`UPDATE notification SET read_at = now() WHERE person_id = $1 AND read_at IS NULL`, [resident(req).personId]));
  }

  @Post(':notificationId/read')
  @HttpCode(204)
  async read(@Req() req: AppRequest, @Param('notificationId', ParseUUIDPipe) id: string) {
    await this.ctx.db.system((tx) =>
      tx.query(`UPDATE notification SET read_at = COALESCE(read_at, now()), client_ack_at = COALESCE(client_ack_at, now()) WHERE id = $1 AND person_id = $2`, [id, resident(req).personId]),
    );
  }

  @Post(':notificationId/received')
  @HttpCode(204)
  async received(@Req() req: AppRequest, @Param('notificationId', ParseUUIDPipe) id: string) {
    await this.ctx.db.system((tx) => tx.query(`UPDATE notification SET client_ack_at = COALESCE(client_ack_at, now()) WHERE id = $1 AND person_id = $2`, [id, resident(req).personId]));
  }
}
