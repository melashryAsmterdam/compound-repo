import { createHash } from 'node:crypto';
import sharp from 'sharp';
import {
  SMS_FALLBACK_DELAY_MS,
  formatRequestRef,
  localDate,
  maskDestination,
  releaseAfterQuietHours,
  routeFor,
  zoneOffsetMinutes,
  type NotificationType,
} from '@compound/domain';
import { emailText, smsText, type Locale } from '@compound/i18n';
import type { AppContext } from '../infra/context';
import { newId } from '../infra/crypto';
import type { Tx } from '../infra/db';
import { enqueue, type JobRow } from '../infra/jobs';
import { logger } from '../infra/logger';
import type { AnnouncementsService } from '../modules/announcements';
import { deepLink, renderNotification, templateKey } from '../modules/notifications';
import type { RequestsCore } from '../modules/requests-core';

const SMS_TEMPLATES = new Set(['request_status_changed_done', 'visit_scheduled', 'visit_rescheduled', 'announcement']);

/** Job consumers and crons (architecture §6–7). */
export class WorkerHandlers {
  constructor(
    private readonly ctx: AppContext,
    private readonly core: RequestsCore,
    private readonly announcements: AnnouncementsService,
  ) {}

  register() {
    const w = this.ctx.worker;
    w.on('send-invitation', (j) => this.sendInvitation(j));
    w.on('send-notification', (j) => this.sendNotification(j.payload.notificationId));
    w.on('sms-fallback-check', (j) => this.smsFallbackCheck(j.payload.notificationId));
    w.on('process-upload', (j) => this.processUpload(j.payload.uploadId));
    w.on('announcement-dispatch', (j) => this.announcements.dispatch(j.payload.compoundId, j.payload.announcementId));
    w.on('send-email', (j) => this.sendEmail(j));
  }

  private async wipePayload(jobId: string) {
    await this.ctx.db.system((tx) => tx.query(`UPDATE job SET payload = '{}' WHERE id = $1`, [jobId]));
  }

  private async delivery(tx: Tx, d: { compoundId: string | null; notificationId?: string; invitationId?: string; channel: string; destination: string; deviceId?: string; provider: string; status: string; providerMessageId?: string | null; failureCode?: string | null; failureReason?: string | null }) {
    await tx.query(
      `INSERT INTO message_delivery (id, compound_id, notification_id, invitation_id, channel, destination_masked, device_id, provider, provider_message_id, status, failure_code, failure_reason, attempts)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,1)`,
      [newId(), d.compoundId, d.notificationId ?? null, d.invitationId ?? null, d.channel, d.channel === 'push' ? 'device' : maskDestination(d.destination), d.deviceId ?? null, d.provider, d.providerMessageId ?? null, d.status, d.failureCode ?? null, d.failureReason ?? null],
    );
  }

  // ───────── invitations ─────────

  async sendInvitation(job: JobRow) {
    const { invitationId, token } = job.payload;
    if (!token) return; // already sent; payload wiped
    const inv = await this.ctx.db.system((tx) =>
      tx.one<any>(
        `SELECT i.*, p.full_name, p.phone_e164, p.email, u.number, c.name_ar, c.name_en, c.sms_sender_id
           FROM invitation i JOIN unit_assignment ua ON ua.id = i.assignment_id JOIN person p ON p.id = ua.person_id
           JOIN unit u ON u.id = ua.unit_id JOIN compound c ON c.id = i.compound_id WHERE i.id = $1`,
        [invitationId],
      ),
    );
    if (!inv || inv.superseded_at || inv.revoked_at || inv.used_at) {
      await this.ctx.db.system((tx) => tx.query(`UPDATE message_delivery SET status = 'skipped', updated_at = now() WHERE invitation_id = $1 AND status = 'queued'`, [invitationId]));
      return this.wipePayload(job.id);
    }
    const locale: Locale = inv.locale;
    const params = { compound: locale === 'ar' ? inv.name_ar : inv.name_en, unit: inv.number, name: inv.full_name, link: `${this.ctx.config.ACTIVATION_BASE_URL}/a/${token}` };
    const rows = await this.ctx.db.system((tx) => tx.query<any>(`SELECT * FROM message_delivery WHERE invitation_id = $1 AND status = 'queued'`, [invitationId]));
    for (const d of rows) {
      let status = 'sent';
      let providerMessageId: string | null = null;
      let reason: string | null = null;
      try {
        if (d.channel === 'sms') ({ providerMessageId } = await this.ctx.sms.send({ to: inv.phone_e164, text: smsText('invitation', locale, params), senderId: inv.sms_sender_id }));
        else {
          const t = emailText('invitation', locale, params);
          ({ providerMessageId } = await this.ctx.email.send({ to: inv.email, subject: t.title, text: t.body }));
        }
      } catch (e) {
        status = 'failed';
        reason = String((e as Error).message).slice(0, 200);
      }
      await this.ctx.db.system((tx) =>
        tx.query(`UPDATE message_delivery SET status = $2, provider_message_id = $3, failure_reason = $4, attempts = attempts + 1, updated_at = now() WHERE id = $1`, [d.id, status, providerMessageId, reason]),
      );
    }
    await this.ctx.db.system(async (tx) => {
      const u = await tx.one<any>(`SELECT ua.unit_id FROM unit_assignment ua WHERE ua.id = $1`, [inv.assignment_id]);
      await tx.notify('events', { compoundId: inv.compound_id, admins: true, personIds: [], type: 'invitation.updated', entityId: u.unit_id });
    });
    await this.wipePayload(job.id);
  }

  async sendEmail(job: JobRow) {
    const { to, subject, text, compoundId } = job.payload;
    if (!to) return;
    const { providerMessageId } = await this.ctx.email.send({ to, subject, text });
    await this.ctx.db.system(async (tx) => {
      await this.delivery(tx, { compoundId: compoundId ?? null, channel: 'email', destination: to, provider: this.ctx.email.provider, status: 'sent', providerMessageId });
      await tx.query(`UPDATE job SET payload = '{}' WHERE id = $1`, [job.id]);
    });
  }

  // ───────── notifications: push + SMS fallback (architecture §6) ─────────

  private async loadNotification(tx: Tx, id: string) {
    return tx.one<any>(
      `SELECT n.*, p.locale, p.phone_e164, p.mute_announcements, p.erased_at, c.name_ar, c.name_en, c.timezone, c.sms_sender_id,
              a.send_sms AS ann_send_sms, a.status AS ann_status, r.ref_no
         FROM notification n JOIN person p ON p.id = n.person_id JOIN compound c ON c.id = n.compound_id
         LEFT JOIN announcement a ON a.id = n.announcement_id LEFT JOIN request r ON r.id = n.request_id
        WHERE n.id = $1`,
      [id],
    );
  }

  async sendNotification(notificationId: string) {
    const n = await this.ctx.db.system((tx) => this.loadNotification(tx, notificationId));
    if (!n || n.erased_at) return;
    const route = routeFor(n.type as NotificationType);
    const locale: Locale = n.locale;
    const compound = locale === 'ar' ? n.name_ar : n.name_en;

    // Announcement "Also send SMS": to every recipient with a mobile, ignoring quiet hours (urgent channel).
    if (n.type === 'announcement') {
      if (n.ann_status === 'deleted') return;
      if (n.ann_send_sms && n.phone_e164) await this.sendSms(n, false);
    }
    const muted = route.mutable && n.mute_announcements;
    if (!route.push || muted) return;

    const devices = await this.ctx.db.system((tx) => tx.query<any>(`SELECT id, push_token FROM device WHERE person_id = $1 AND push_enabled AND push_token IS NOT NULL`, [n.person_id]));
    if (devices.length === 0) {
      if (n.sms_fallback) await this.sendSms(n, true);
      return;
    }
    const t = renderNotification(n, locale, compound);
    let delivered = 0;
    for (const d of devices) {
      const r = await this.ctx.push.send({ token: d.push_token, title: t.title, body: t.body, data: { notificationId: n.id, deepLink: deepLink(n) } });
      await this.ctx.db.system(async (tx) => {
        await this.delivery(tx, {
          compoundId: n.compound_id, notificationId: n.id, channel: 'push', destination: 'device', deviceId: d.id, provider: this.ctx.push.provider,
          status: r.ok ? 'sent' : 'failed', providerMessageId: r.ok ? r.providerMessageId : null, failureCode: r.ok ? null : r.error,
        });
        if (!r.ok && (r.error === 'UNREGISTERED' || r.error === 'INVALID_ARGUMENT')) await tx.query(`UPDATE device SET push_token = NULL, push_enabled = false WHERE id = $1`, [d.id]);
      });
      if (r.ok) delivered++;
    }
    if (!n.sms_fallback) return;
    if (delivered === 0) return this.sendSms(n, true);
    await this.ctx.db.system((tx) =>
      enqueue(tx, 'sms-fallback-check', { notificationId: n.id }, { runAt: new Date(this.ctx.now().getTime() + SMS_FALLBACK_DELAY_MS), singletonKey: `fallback:${n.id}` }),
    );
  }

  async smsFallbackCheck(notificationId: string) {
    const n = await this.ctx.db.system((tx) => this.loadNotification(tx, notificationId));
    if (!n || n.client_ack_at || n.erased_at) return;
    await this.sendSms(n, true);
  }

  /** Fallback SMS respect quiet hours (22:00–07:00 compound time): held and re-queued for 07:00. */
  private async sendSms(n: any, respectQuietHours: boolean) {
    if (!n.phone_e164) return;
    const key = templateKey(n.type, n.params ?? {});
    if (!SMS_TEMPLATES.has(key)) return;
    const now = this.ctx.now();
    if (respectQuietHours) {
      const release = releaseAfterQuietHours(now, zoneOffsetMinutes(n.timezone, now));
      if (release.getTime() > now.getTime()) {
        await this.ctx.db.system((tx) => enqueue(tx, 'sms-fallback-check', { notificationId: n.id }, { runAt: release, singletonKey: `fallback-quiet:${n.id}` }));
        return;
      }
    }
    const already = await this.ctx.db.system((tx) => tx.one(`SELECT 1 FROM message_delivery WHERE notification_id = $1 AND channel = 'sms' AND status <> 'failed'`, [n.id]));
    if (already) return;
    const locale: Locale = n.locale;
    const params = {
      ...(n.params ?? {}),
      compound: locale === 'ar' ? n.name_ar : n.name_en,
      ref: n.ref_no ? formatRequestRef(n.ref_no) : '',
      title: (locale === 'ar' ? n.params?.titleAr : n.params?.titleEn) ?? '',
      link: n.request_id ? `${this.ctx.config.ACTIVATION_BASE_URL}/r/${n.request_id}` : '',
    };
    let status = 'sent';
    let providerMessageId: string | null = null;
    let reason: string | null = null;
    try {
      ({ providerMessageId } = await this.ctx.sms.send({ to: n.phone_e164, text: smsText(key, locale, params), senderId: n.sms_sender_id }));
    } catch (e) {
      status = 'failed';
      reason = String((e as Error).message).slice(0, 200);
    }
    await this.ctx.db.system((tx) =>
      this.delivery(tx, { compoundId: n.compound_id, notificationId: n.id, channel: 'sms', destination: n.phone_e164, provider: this.ctx.sms.provider, status, providerMessageId, failureReason: reason }),
    );
    if (status === 'failed') throw new Error(`sms failed: ${reason}`);
  }

  // ───────── uploads (ADR-013): magic bytes + re-encode drops EXIF/GPS ─────────

  async processUpload(uploadId: string) {
    const u = await this.ctx.db.system((tx) => tx.one<any>(`SELECT * FROM upload WHERE id = $1`, [uploadId]));
    if (!u || u.status !== 'pending') return;
    const data = this.ctx.storage.get(u.object_key);
    const reject = async (why: string) => {
      logger.warn({ uploadId, why }, 'upload rejected');
      this.ctx.storage.delete(u.object_key);
      await this.ctx.db.system((tx) => tx.query(`UPDATE upload SET status = 'rejected' WHERE id = $1`, [uploadId]));
    };
    if (!data || data.length === 0 || data.length > 10_485_760) return reject('size');
    if (u.content_type === 'application/pdf') {
      if (data.subarray(0, 5).toString('latin1') !== '%PDF-') return reject('magic');
      await this.ctx.db.system((tx) =>
        tx.query(`UPDATE upload SET status = 'ready', bytes = $2, sha256 = $3 WHERE id = $1`, [uploadId, data.length, createHash('sha256').update(data).digest()]),
      );
      return;
    }
    const magic: Record<string, (b: Buffer) => boolean> = {
      'image/jpeg': (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
      'image/png': (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
      'image/webp': (b) => b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP',
      'image/heic': (b) => b.subarray(4, 8).toString('latin1') === 'ftyp',
    };
    if (!magic[u.content_type]?.(data)) return reject('magic');
    let out: { data: Buffer; info: sharp.OutputInfo };
    try {
      // rotate() applies EXIF orientation; output carries no metadata unless asked (strips GPS, PDPL R2-AC7).
      const img = sharp(data, { limitInputPixels: 50_000_000 }).rotate().resize({ width: 2048, height: 2048, fit: 'inside', withoutEnlargement: true });
      out = await (u.content_type === 'image/png' ? img.png() : u.content_type === 'image/webp' ? img.webp({ quality: 80 }) : img.jpeg({ quality: 80 })).toBuffer({ resolveWithObject: true });
    } catch {
      return reject('decode');
    }
    this.ctx.storage.put(u.object_key, out.data);
    await this.ctx.db.system((tx) =>
      tx.query(`UPDATE upload SET status = 'ready', bytes = $2, width = $3, height = $4, sha256 = $5, content_type = $6 WHERE id = $1`, [
        uploadId, out.data.length, out.info.width, out.info.height, createHash('sha256').update(out.data).digest(), u.content_type === 'image/heic' ? 'image/jpeg' : u.content_type,
      ]),
    );
    const r = u.request_id ? await this.ctx.db.system((tx) => tx.one<any>(`SELECT created_by_person_id, version FROM request WHERE id = $1`, [u.request_id])) : null;
    if (r) await this.ctx.db.system((tx) => tx.notify('events', { compoundId: u.compound_id, admins: true, personIds: [r.created_by_person_id], type: 'request.updated', entityId: u.request_id, version: r.version }));
  }

  // ───────── crons (architecture §7) ─────────

  /** Done for 7 days with no resident answer → Closed (no response) (R4-AC4). */
  async autoClose(): Promise<number> {
    const cutoff = new Date(this.ctx.now().getTime() - 7 * 86_400_000);
    const due = await this.ctx.db.system((tx) => tx.query<any>(`SELECT id, compound_id FROM request WHERE status = 'done' AND done_at < $1 LIMIT 500`, [cutoff]));
    for (const r of due) {
      await this.ctx.db
        .tenant({ compoundId: r.compound_id }, (tx) => this.core.apply(tx, r.id, { kind: 'auto_close' }, { type: 'system', id: null }))
        .catch((e) => logger.warn({ requestId: r.id, err: (e as Error).message }, 'auto-close skipped'));
    }
    return due.length;
  }

  /** From 20:00 compound time: reminders for visits starting tomorrow (Q-12). */
  async visitReminders(): Promise<number> {
    const now = this.ctx.now();
    const compounds = await this.ctx.db.system((tx) => tx.query<any>(`SELECT id, timezone FROM compound WHERE status = 'active'`));
    let sent = 0;
    for (const c of compounds) {
      const offset = zoneOffsetMinutes(c.timezone, now);
      const localHour = new Date(now.getTime() + offset * 60_000).getUTCHours();
      if (localHour < 20) continue;
      const tomorrow = localDate(new Date(now.getTime() + 86_400_000), c.timezone);
      await this.ctx.db.tenant({ compoundId: c.id }, async (tx) => {
        const rows = await tx.query<any>(
          `SELECT r.* FROM request r JOIN unit_assignment ua ON ua.unit_id = r.unit_id AND ua.person_id = r.created_by_person_id AND ua.status = 'active'
            WHERE r.status IN ('new','in_progress') AND r.visit_start_at IS NOT NULL AND r.visit_reminder_sent_at IS NULL
              AND to_char(r.visit_start_at AT TIME ZONE $1, 'YYYY-MM-DD') = $2`,
          [c.timezone, tomorrow],
        );
        for (const r of rows) {
          await tx.query(`UPDATE request SET visit_reminder_sent_at = $2 WHERE id = $1`, [r.id, now]);
          const id = newId();
          await tx.query(
            `INSERT INTO notification (id, compound_id, person_id, type, request_id, params, sms_fallback) VALUES ($1,$2,$3,'visit_reminder',$4,$5,false)`,
            [id, c.id, r.created_by_person_id, r.id, JSON.stringify({ ref: formatRequestRef(r.ref_no) })],
          );
          await enqueue(tx, 'send-notification', { notificationId: id, compoundId: c.id }, { singletonKey: `notif:${id}` });
          sent++;
        }
      });
    }
    return sent;
  }

  async housekeeping() {
    const week = new Date(this.ctx.now().getTime() - 7 * 86_400_000);
    await this.ctx.db.system(async (tx) => {
      await tx.query(`DELETE FROM otp_challenge WHERE created_at < $1`, [week]);
      await tx.query(`DELETE FROM rate_limit_bucket WHERE window_start < $1`, [week]);
      await tx.query(`DELETE FROM admin_session WHERE expires_at < $1`, [week]);
      await tx.query(`DELETE FROM password_reset WHERE expires_at < $1`, [week]);
      await tx.query(`DELETE FROM job WHERE status IN ('done','cancelled') AND updated_at < $1`, [week]);
      await tx.query(`DELETE FROM upload WHERE status = 'pending' AND created_at < $1 AND request_id IS NULL`, [week]);
    });
  }

  /** Called every minute by the worker; each cron runs once per slot (cron_run table). */
  async tick() {
    const now = this.ctx.now();
    const slot = (ms: number) => String(Math.floor(now.getTime() / ms));
    const once = async (name: string, s: string, fn: () => Promise<unknown>) => {
      const claimed = await this.ctx.db.system((tx) =>
        tx.query(`INSERT INTO cron_run (name, last_slot) VALUES ($1,$2) ON CONFLICT (name) DO UPDATE SET last_slot = $2 WHERE cron_run.last_slot <> $2 RETURNING name`, [name, s]),
      );
      if (claimed.length) await fn().catch((e) => logger.error({ cron: name, err: (e as Error).message }, 'cron failed'));
    };
    await once('announcement-dispatch', slot(60_000), () => this.announcements.dispatchDue());
    await once('auto-close', slot(3_600_000), () => this.autoClose());
    await once('visit-reminders', slot(3_600_000), () => this.visitReminders());
    await once('housekeeping', slot(86_400_000), () => this.housekeeping());
  }
}
