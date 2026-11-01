import { Body, Controller, Get, HttpCode, Inject, Injectable, Param, Patch, Post, Put, Query, Req, UseGuards } from '@nestjs/common';
import { invitationState, maskDestination, normaliseSaudiMobile, otpChannelFor } from '@compound/domain';
import type { Locale } from '@compound/i18n';
import { LEGAL_VERSIONS, legalDocument } from '@compound/legal';
import { SignJWT } from 'jose';
import { z } from 'zod';
import { DomainError } from '../errors';
import { AppContext } from '../infra/context';
import { audit } from '../infra/audit';
import { newId, randomToken, sha256 } from '../infra/crypto';
import type { Tx } from '../infra/db';
import { hit } from '../infra/ratelimit';
import { ResidentGuard, clientMeta, localeOf, parse, resident, type AppRequest } from '../http';
import { OtpService } from './otp';
import { compoundDto, signedObjectUrl } from './serializers';

const ACCESS_TTL_S = 15 * 60;
const REFRESH_TTL_MS = 90 * 86_400_000;

const phone = z.string().max(20).transform((v, ctx) => {
  const p = normaliseSaudiMobile(v);
  if (!p) ctx.addIssue({ code: 'custom', message: 'phone_invalid' });
  return p ?? '';
});
const email = z.string().trim().toLowerCase().email().max(254);
const device = z.object({
  installationId: z.string().uuid(),
  platform: z.enum(['ios', 'android']),
  appVersion: z.string().max(30).optional(),
  locale: z.enum(['ar', 'en']).optional(),
});
const startBody = z.union([z.object({ invitationToken: z.string().length(43) }), z.object({ phone }), z.object({ email })]);
const loginStart = z.union([z.object({ phone }), z.object({ email })]);
const completeBody = z.object({
  challengeId: z.string().uuid(),
  code: z.string().regex(/^[0-9]{6}$/),
  consent: z.object({ privacyNoticeVersion: z.string(), termsVersion: z.string(), locale: z.enum(['ar', 'en']) }),
  device,
});
const verifyBody = z.object({ challengeId: z.string().uuid(), code: z.string().regex(/^[0-9]{6}$/), device });
const resendBody = z.object({ challengeId: z.string().uuid() });
const refreshBody = z.object({ refreshToken: z.string().min(20).max(200) });
const mePatch = z.object({ locale: z.enum(['ar', 'en']).optional(), muteAnnouncements: z.boolean().optional() });
const deviceBody = z.object({ pushToken: z.string().max(4096).nullable().optional(), pushEnabled: z.boolean(), locale: z.enum(['ar', 'en']).optional(), appVersion: z.string().max(30).optional() });
const dsrBody = z.object({ type: z.enum(['access', 'correction', 'deletion']), details: z.string().max(1000).optional() });

/** Session issuing shared by activation and sign-in (05-auth §3). */
@Injectable()
export class ResidentSessions {
  constructor(@Inject(AppContext) private readonly ctx: AppContext) {}

  async upsertDevice(tx: Tx, personId: string, d: z.infer<typeof device>) {
    const existing = await tx.one<any>(`SELECT person_id FROM device WHERE id = $1`, [d.installationId]);
    if (existing && existing.person_id !== personId) {
      // Same install, different person (shared phone): end the previous person's sessions on it.
      await tx.query(`UPDATE refresh_token SET revoked_at = now(), revoke_reason = 'device_reassigned' WHERE device_id = $1 AND revoked_at IS NULL`, [d.installationId]);
    }
    await tx.query(
      `INSERT INTO device (id, person_id, platform, locale, app_version, last_seen_at) VALUES ($1,$2,$3,$4,$5,now())
       ON CONFLICT (id) DO UPDATE SET person_id = EXCLUDED.person_id, platform = EXCLUDED.platform, locale = EXCLUDED.locale,
         app_version = COALESCE(EXCLUDED.app_version, device.app_version), last_seen_at = now(),
         push_token = CASE WHEN device.person_id = EXCLUDED.person_id THEN device.push_token ELSE NULL END,
         push_enabled = CASE WHEN device.person_id = EXCLUDED.person_id THEN device.push_enabled ELSE false END`,
      [d.installationId, personId, d.platform, d.locale ?? 'ar', d.appVersion ?? null],
    );
    return d.installationId;
  }

  async accessToken(personId: string, deviceId: string, familyId: string) {
    const now = this.ctx.now();
    const exp = Math.floor(now.getTime() / 1000) + ACCESS_TTL_S;
    const token = await new SignJWT({ did: deviceId, sid: familyId })
      .setProtectedHeader({ alg: 'ES256', kid: this.ctx.jwt.kid })
      .setSubject(personId)
      .setIssuer(this.ctx.config.JWT_ISSUER)
      .setAudience('app')
      .setIssuedAt(Math.floor(now.getTime() / 1000))
      .setExpirationTime(exp)
      .sign(this.ctx.jwt.privateKey);
    return { token, expiresAt: new Date(exp * 1000) };
  }

  async issue(tx: Tx, personId: string, deviceId: string, familyId = newId()) {
    const refresh = randomToken();
    await tx.query(
      `INSERT INTO refresh_token (token_hash, family_id, person_id, device_id, issued_at, expires_at) VALUES ($1,$2,$3,$4,$5,$6)`,
      [sha256(refresh), familyId, personId, deviceId, this.ctx.now(), new Date(this.ctx.now().getTime() + REFRESH_TTL_MS)],
    );
    const access = await this.accessToken(personId, deviceId, familyId);
    return { accessToken: access.token, accessTokenExpiresAt: access.expiresAt.toISOString(), refreshToken: refresh, me: await this.me(tx, personId) };
  }

  async me(tx: Tx, personId: string) {
    const p = await tx.one<any>(`SELECT * FROM person WHERE id = $1`, [personId]);
    const units = await tx.query<any>(
      `SELECT u.id, u.number, u.block, u.compound_id FROM unit_assignment ua JOIN unit u ON u.id = ua.unit_id
        WHERE ua.person_id = $1 AND ua.status = 'active' ORDER BY ua.activated_at, u.number`,
      [personId],
    );
    const out = [];
    for (const u of units) out.push({ unitId: u.id, number: u.number, block: u.block, compound: await compoundDto(this.ctx, tx, u.compound_id) });
    return { personId: p.id, fullName: p.full_name, phone: p.phone_e164, email: p.email, locale: p.locale, muteAnnouncements: p.mute_announcements, units: out };
  }
}

@Controller('app/v1')
export class ResidentAuthController {
  constructor(
    @Inject(AppContext) private readonly ctx: AppContext,
    @Inject(OtpService) private readonly otp: OtpService,
    @Inject(ResidentSessions) private readonly sessions: ResidentSessions,
  ) {}

  /** Look up an invitation by raw token. Cross-tenant by nature (the token is all we have). */
  private async invitationByToken(tx: Tx, token: string) {
    return tx.one<any>(
      `SELECT i.*, ua.status AS assignment_status, ua.person_id, u.number AS unit_number, u.block, u.status AS unit_status,
              p.full_name, p.phone_e164, p.email, p.locale AS person_locale,
              c.name_ar, c.name_en, c.logo_upload_id, c.contact_phone
         FROM invitation i JOIN unit_assignment ua ON ua.id = i.assignment_id JOIN unit u ON u.id = ua.unit_id
         JOIN person p ON p.id = ua.person_id JOIN compound c ON c.id = i.compound_id
        WHERE i.token_hash = $1`,
      [sha256(token)],
    );
  }

  private assertPending(inv: any) {
    if (!inv) throw new DomainError('invitation_not_found', 404);
    const state = invitationState({ expiresAt: new Date(inv.expires_at), usedAt: inv.used_at, supersededAt: inv.superseded_at, revokedAt: inv.revoked_at }, this.ctx.now());
    const extra = { compoundContactPhone: inv.contact_phone };
    if (state === 'used' || inv.assignment_status === 'active') throw new DomainError('invitation_used', 410, extra);
    if (state === 'expired') throw new DomainError('invitation_expired', 410, extra);
    if (state !== 'pending' || inv.assignment_status === 'revoked') throw new DomainError('invitation_revoked', 410, extra);
  }

  @Get('invitations/:token')
  async preview(@Req() req: AppRequest, @Param('token') token: string) {
    if (token.length !== 43) throw new DomainError('invitation_not_found', 404);
    await this.ctx.db.system((tx) => hit(tx, `invite-preview:${clientMeta(req).ip}`, 30, 3_600_000, 'rate_limited', this.ctx.now()));
    return this.ctx.db.system(async (tx) => {
      const inv = await this.invitationByToken(tx, token);
      this.assertPending(inv);
      const channel = otpChannelFor({ phone: inv.phone_e164, email: inv.email })!;
      return {
        fullName: inv.full_name,
        compoundNameAr: inv.name_ar,
        compoundNameEn: inv.name_en,
        compoundLogoUrl: await signedObjectUrl(this.ctx, tx, inv.logo_upload_id),
        unitNumber: inv.unit_number,
        block: inv.block,
        otpChannel: channel,
        maskedDestination: maskDestination(channel === 'sms' ? inv.phone_e164 : inv.email),
        privacyNoticeVersion: LEGAL_VERSIONS.privacy_notice,
        termsVersion: LEGAL_VERSIONS.terms,
      };
    });
  }

  @Post('activation/start')
  @HttpCode(200)
  async activationStart(@Req() req: AppRequest, @Body() body: unknown) {
    const input = parse(startBody, body);
    const { ip } = clientMeta(req);
    const locale = localeOf(req);
    if ('invitationToken' in input) {
      const inv = await this.ctx.db.system((tx) => this.invitationByToken(tx, input.invitationToken));
      this.assertPending(inv);
      const channel = otpChannelFor({ phone: inv.phone_e164, email: inv.email })!;
      return this.otp.issue({ purpose: 'activation', subjectId: inv.person_id, destination: channel === 'sms' ? inv.phone_e164 : inv.email, channel, locale: inv.person_locale, ip, compoundId: inv.compound_id });
    }
    // iOS deferred path (ADR-009): latest pending invitation for that phone/email; generic answer otherwise.
    const dest = 'phone' in input ? input.phone : input.email;
    const channel = 'phone' in input ? 'sms' : 'email';
    const pending = await this.ctx.db.system((tx) =>
      tx.one<any>(
        `SELECT p.id AS person_id, p.locale, i.compound_id FROM person p
           JOIN unit_assignment ua ON ua.person_id = p.id AND ua.status = 'invited'
           JOIN invitation i ON i.assignment_id = ua.id AND i.used_at IS NULL AND i.superseded_at IS NULL AND i.revoked_at IS NULL AND i.expires_at > $2
          WHERE ${channel === 'sms' ? 'p.phone_e164' : 'p.email'} = $1
          ORDER BY i.created_at DESC LIMIT 1`,
        [dest, this.ctx.now()],
      ),
    );
    return this.otp.issue({ purpose: 'activation', subjectId: pending?.person_id ?? null, destination: dest, channel, locale: pending?.locale ?? locale, ip, compoundId: pending?.compound_id ?? null, deliver: !!pending });
  }

  /** Verify OTP, record PDPL consent, activate all pending assignments for this person, issue tokens (R1). */
  @Post('activation/complete')
  @HttpCode(200)
  async activationComplete(@Req() req: AppRequest, @Body() body: unknown) {
    const input = parse(completeBody, body);
    if (input.consent.privacyNoticeVersion !== LEGAL_VERSIONS.privacy_notice || input.consent.termsVersion !== LEGAL_VERSIONS.terms) {
      throw new DomainError('consent_version_outdated', 409, { privacyNoticeVersion: LEGAL_VERSIONS.privacy_notice, termsVersion: LEGAL_VERSIONS.terms });
    }
    const meta = clientMeta(req);
    const now = this.ctx.now();
    // OTP is verified (and consumed) first so wrong attempts are counted even when the call fails.
    const ch = await this.otp.verify(input.challengeId, input.code, ['activation']);
    // One system transaction: activation can span several compounds (Q-2), and must be atomic.
    return this.ctx.db.system(async (tx) => {
      const personId = ch.subjectId!;
      const pending = await tx.query<any>(
        `SELECT i.id AS invitation_id, i.compound_id, ua.id AS assignment_id, ua.unit_id FROM unit_assignment ua
           JOIN invitation i ON i.assignment_id = ua.id AND i.used_at IS NULL AND i.superseded_at IS NULL AND i.revoked_at IS NULL AND i.expires_at > $2
          WHERE ua.person_id = $1 AND ua.status = 'invited'`,
        [personId, now],
      );
      if (pending.length === 0) throw new DomainError('invitation_expired', 410);
      const deviceId = await this.sessions.upsertDevice(tx, personId, input.device);
      await tx.query(`UPDATE person SET locale = $2, updated_at = now() WHERE id = $1`, [personId, input.consent.locale]);
      for (const p of pending) {
        await tx.query(`UPDATE invitation SET used_at = $2 WHERE id = $1`, [p.invitation_id, now]);
        await tx.query(`UPDATE unit_assignment SET status = 'active', activated_at = $2 WHERE id = $1`, [p.assignment_id, now]);
        const hasConsent = await tx.one(`SELECT 1 FROM consent_record WHERE person_id = $1 AND compound_id = $2 AND version = $3 AND document = 'privacy_notice' AND withdrawn_at IS NULL`, [personId, p.compound_id, LEGAL_VERSIONS.privacy_notice]);
        if (!hasConsent) {
          for (const [doc, version] of [['privacy_notice', LEGAL_VERSIONS.privacy_notice], ['terms', LEGAL_VERSIONS.terms]] as const) {
            await tx.query(
              `INSERT INTO consent_record (id, person_id, compound_id, document, version, locale, accepted_at, device_id, ip) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
              [newId(), personId, p.compound_id, doc, version, input.consent.locale, now, deviceId, meta.ip],
            );
          }
        }
        await audit(tx, { compoundId: p.compound_id, actorType: 'resident', actorId: personId, action: 'assignment.activate', entityType: 'unit_assignment', entityId: p.assignment_id, ...meta });
        await tx.notify('events', { compoundId: p.compound_id, admins: true, personIds: [], type: 'invitation.updated', entityId: p.unit_id });
      }
      return this.sessions.issue(tx, personId, deviceId);
    });
  }

  @Get('legal/:document')
  legal(@Param('document') document: string, @Query('locale') locale: string) {
    const d = z.enum(['privacy_notice', 'terms']).parse(document);
    const l = z.enum(['ar', 'en']).parse(locale);
    return legalDocument(d, l);
  }

  @Post('auth/otp/start')
  @HttpCode(200)
  async otpStart(@Req() req: AppRequest, @Body() body: unknown) {
    const input = parse(loginStart, body);
    const dest = 'phone' in input ? input.phone : input.email;
    const channel = 'phone' in input ? 'sms' : 'email';
    const person = await this.ctx.db.system((tx) =>
      tx.one<any>(
        `SELECT p.id, p.locale FROM person p WHERE ${channel === 'sms' ? 'p.phone_e164' : 'p.email'} = $1 AND p.erased_at IS NULL
           AND EXISTS (SELECT 1 FROM unit_assignment ua WHERE ua.person_id = p.id AND ua.status = 'active')`,
        [dest],
      ),
    );
    // Always 200 with a challenge: no account enumeration (05-auth §3).
    return this.otp.issue({ purpose: 'resident_login', subjectId: person?.id ?? null, destination: dest, channel, locale: person?.locale ?? localeOf(req), ip: clientMeta(req).ip, deliver: !!person });
  }

  @Post('auth/otp/resend')
  @HttpCode(200)
  otpResend(@Req() req: AppRequest, @Body() body: unknown) {
    return this.otp.resend(parse(resendBody, body).challengeId, ['activation', 'resident_login'], localeOf(req));
  }

  @Post('auth/otp/verify')
  @HttpCode(200)
  async otpVerify(@Body() body: unknown) {
    const input = parse(verifyBody, body);
    const ch = await this.otp.verify(input.challengeId, input.code, ['resident_login']);
    return this.ctx.db.system(async (tx) => {
      const active = await tx.one<{ n: number }>(`SELECT count(*)::int AS n FROM unit_assignment WHERE person_id = $1 AND status = 'active'`, [ch.subjectId]);
      if (!active || active.n === 0) throw new DomainError('no_active_units', 403);
      const deviceId = await this.sessions.upsertDevice(tx, ch.subjectId!, input.device);
      return this.sessions.issue(tx, ch.subjectId!, deviceId);
    });
  }

  /** Rotation on every use; reuse of a rotated token revokes the family (theft detection). */
  @Post('auth/refresh')
  @HttpCode(200)
  async refresh(@Body() body: unknown) {
    const { refreshToken } = parse(refreshBody, body);
    const now = this.ctx.now();
    const outcome = await this.ctx.db.system(async (tx) => {
      const t = await tx.one<any>(`SELECT * FROM refresh_token WHERE token_hash = $1 FOR UPDATE`, [sha256(refreshToken)]);
      if (!t || t.revoked_at) return { error: 'session_revoked' as const };
      if (t.rotated_at) {
        await tx.query(`UPDATE refresh_token SET revoked_at = $2, revoke_reason = 'reuse_detected' WHERE family_id = $1 AND revoked_at IS NULL`, [t.family_id, now]);
        return { error: 'session_revoked' as const };
      }
      if (new Date(t.expires_at) <= now) return { error: 'refresh_expired' as const };
      const active = await tx.one<{ n: number }>(`SELECT count(*)::int AS n FROM unit_assignment WHERE person_id = $1 AND status = 'active'`, [t.person_id]);
      if (active!.n === 0) {
        await tx.query(`UPDATE refresh_token SET revoked_at = $2, revoke_reason = 'no_active_units' WHERE family_id = $1 AND revoked_at IS NULL`, [t.family_id, now]);
        return { error: 'session_revoked' as const };
      }
      await tx.query(`UPDATE refresh_token SET rotated_at = $2 WHERE token_hash = $1`, [sha256(refreshToken), now]);
      await tx.query(`UPDATE device SET last_seen_at = $2 WHERE id = $1`, [t.device_id, now]);
      return { pair: await this.sessions.issue(tx, t.person_id, t.device_id, t.family_id) };
    });
    // Revocation must commit, so the error is raised after the transaction.
    if ('error' in outcome) throw new DomainError(outcome.error!, 401);
    return outcome.pair;
  }

  @Post('auth/logout')
  @HttpCode(204)
  @UseGuards(ResidentGuard)
  async logout(@Req() req: AppRequest) {
    const me = resident(req);
    await this.ctx.db.system(async (tx) => {
      await tx.query(`UPDATE refresh_token SET revoked_at = now(), revoke_reason = 'logout' WHERE family_id = $1 AND revoked_at IS NULL`, [me.familyId]);
      await tx.query(`UPDATE device SET push_token = NULL, push_enabled = false WHERE id = $1 AND person_id = $2`, [me.deviceId, me.personId]);
    });
  }

  // ───────── profile, devices, privacy ─────────

  @Get('me')
  @UseGuards(ResidentGuard)
  getMe(@Req() req: AppRequest) {
    return this.ctx.db.system((tx) => this.sessions.me(tx, resident(req).personId));
  }

  @Patch('me')
  @UseGuards(ResidentGuard)
  patchMe(@Req() req: AppRequest, @Body() body: unknown) {
    const p = parse(mePatch, body);
    const me = resident(req);
    return this.ctx.db.system(async (tx) => {
      await tx.query(
        `UPDATE person SET locale = COALESCE($2::locale_code, locale), mute_announcements = COALESCE($3, mute_announcements), updated_at = now() WHERE id = $1`,
        [me.personId, p.locale ?? null, p.muteAnnouncements ?? null],
      );
      if (p.locale) await tx.query(`UPDATE device SET locale = $2 WHERE id = $1`, [me.deviceId, p.locale]);
      return this.sessions.me(tx, me.personId);
    });
  }

  @Put('devices/current')
  @HttpCode(204)
  @UseGuards(ResidentGuard)
  async putDevice(@Req() req: AppRequest, @Body() body: unknown) {
    const d = parse(deviceBody, body);
    const me = resident(req);
    await this.ctx.db.system(async (tx) => {
      if (d.pushToken) await tx.query(`UPDATE device SET push_token = NULL WHERE push_token = $1 AND id <> $2`, [d.pushToken, me.deviceId]);
      await tx.query(
        `UPDATE device SET push_token = CASE WHEN $3::text IS NULL AND $6 THEN push_token ELSE $3 END, push_enabled = $4,
                locale = COALESCE($5::locale_code, locale), app_version = COALESCE($7, app_version), last_seen_at = now()
          WHERE id = $1 AND person_id = $2`,
        [me.deviceId, me.personId, d.pushToken ?? null, d.pushEnabled, d.locale ?? null, d.pushToken === undefined, d.appVersion ?? null],
      );
    });
  }

  @Post('privacy/requests')
  @HttpCode(201)
  @UseGuards(ResidentGuard)
  async privacyRequest(@Req() req: AppRequest, @Body() body: unknown) {
    const p = parse(dsrBody, body);
    const me = resident(req);
    const now = this.ctx.now();
    const id = newId();
    const dueAt = new Date(now.getTime() + 30 * 86_400_000);
    await this.ctx.db.system(async (tx) => {
      await hit(tx, `dsr:${me.personId}`, 5, 86_400_000, 'rate_limited', now);
      await tx.query(`INSERT INTO data_subject_request (id, person_id, type, details, due_at, created_at) VALUES ($1,$2,$3,$4,$5,$6)`, [id, me.personId, p.type, p.details ?? null, dueAt, now]);
      await audit(tx, { compoundId: null, actorType: 'resident', actorId: me.personId, action: `privacy.${p.type}_request`, entityType: 'data_subject_request', entityId: id, ...clientMeta(req) });
    });
    return { id, status: 'received', dueAt: dueAt.toISOString() };
  }
}

export type { Locale };
