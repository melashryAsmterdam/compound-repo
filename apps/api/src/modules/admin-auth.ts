import { Body, Controller, Get, HttpCode, Inject, Patch, Post, Req, Res, UseGuards } from '@nestjs/common';
import { hash as argonHash, verify as argonVerify } from '@node-rs/argon2';
import type { Response } from 'express';
import { z } from 'zod';
import { DomainError } from '../errors';
import { AppContext } from '../infra/context';
import { audit } from '../infra/audit';
import { derivedToken, hmac, newId, randomToken, sha256 } from '../infra/crypto';
import { enqueue } from '../infra/jobs';
import { hit } from '../infra/ratelimit';
import { ADMIN_COOKIE, AdminGuard, admin, clientMeta, localeOf, parse, type AppRequest } from '../http';
import { OtpService } from './otp';
import { compoundDto } from './serializers';

const ARGON = { memoryCost: 65536, timeCost: 3, parallelism: 1 } as const;
const LOCK_MS = 15 * 60 * 1000;
const MAX_FAILED = 5;
const SESSION_ABSOLUTE_MS = 12 * 3_600_000;
const RESET_TTL_MS = 30 * 60 * 1000;

/** Offline excerpt of the breached-password list (05-auth §2). Full k-anonymity list ships with infra. */
const BREACHED = new Set(['password1234', '123456789012', 'qwertyuiop12', 'compound1234', 'admin1234567', 'p@ssw0rd1234']);

export const hashPassword = (p: string) => argonHash(p, ARGON);
const DUMMY_HASH = hashPassword('timing-equaliser-not-a-password');

const loginBody = z.object({ email: z.string().email().max(254), password: z.string().min(1).max(256) });
const mfaBody = z.object({ challengeId: z.string().uuid(), code: z.string().regex(/^[0-9]{6}$/) });
const resendBody = z.object({ challengeId: z.string().uuid() });
const forgotBody = z.object({ email: z.string().email().max(254) });
const localeBody = z.object({ locale: z.enum(['ar', 'en']) });
const changePasswordBody = z.object({ currentPassword: z.string().min(1).max(128), newPassword: z.string().min(12, 'password_too_weak').max(128) });
const resetBody = z.object({ token: z.string().min(10).max(100), newPassword: z.string().min(12, 'password_too_weak').max(128) });

@Controller('admin/v1')
export class AdminAuthController {
  constructor(
    @Inject(AppContext) private readonly ctx: AppContext,
    @Inject(OtpService) private readonly otp: OtpService,
  ) {}

  /** CSRF token derived from the session id, so the portal can recover it after a reload via GET /me. */
  private csrfFor(rawSession: string) {
    return hmac(this.ctx.config.OTP_PEPPER, `csrf:${rawSession}`).toString('base64url');
  }

  @Post('auth/login')
  @HttpCode(200)
  async login(@Req() req: AppRequest, @Body() body: unknown) {
    const { email, password } = parse(loginBody, body);
    const now = this.ctx.now();
    const { ip } = clientMeta(req);
    await this.ctx.db.system((tx) => hit(tx, `login:ip:${ip}`, this.ctx.config.LOGIN_IP_LIMIT, 10 * 60 * 1000, 'rate_limited', now));
    const a = await this.ctx.db.system((tx) => tx.one<any>(`SELECT * FROM admin_user WHERE email = $1`, [email]));
    if (!a || a.status !== 'active') {
      await argonVerify(await DUMMY_HASH, password).catch(() => false);
      throw new DomainError('invalid_credentials', 401);
    }
    if (a.locked_until && new Date(a.locked_until) > now) throw new DomainError('account_locked', 423, { lockedUntil: new Date(a.locked_until).toISOString() });
    const ok = await argonVerify(a.password_hash, password).catch(() => false);
    if (!ok) {
      const failed = a.failed_logins + 1;
      const lock = failed >= MAX_FAILED;
      await this.ctx.db.tenant({ compoundId: a.compound_id }, async (tx) => {
        await tx.query(`UPDATE admin_user SET failed_logins = $2, locked_until = $3, updated_at = $4 WHERE id = $1`, [a.id, lock ? 0 : failed, lock ? new Date(now.getTime() + LOCK_MS) : a.locked_until, now]);
        if (lock) await audit(tx, { compoundId: a.compound_id, actorType: 'system', actorId: null, action: 'admin.locked', entityType: 'admin_user', entityId: a.id, ...clientMeta(req) });
      });
      if (lock) throw new DomainError('account_locked', 423, { lockedUntil: new Date(now.getTime() + LOCK_MS).toISOString() });
      throw new DomainError('invalid_credentials', 401);
    }
    await this.ctx.db.tenant({ compoundId: a.compound_id }, (tx) => tx.query(`UPDATE admin_user SET failed_logins = 0, locked_until = NULL WHERE id = $1`, [a.id]));
    const channel = a.mfa_channel === 'sms' && a.phone_e164 ? 'sms' : 'email';
    return this.otp.issue({
      purpose: 'admin_mfa',
      subjectId: a.id,
      destination: channel === 'sms' ? a.phone_e164 : a.email,
      channel,
      locale: a.locale,
      ip,
      compoundId: a.compound_id,
    });
  }

  @Post('auth/mfa/verify')
  @HttpCode(200)
  async verify(@Req() req: AppRequest, @Body() body: unknown, @Res({ passthrough: true }) res: Response) {
    const { challengeId, code } = parse(mfaBody, body);
    const ch = await this.otp.verify(challengeId, code, ['admin_mfa']);
    const now = this.ctx.now();
    const a = await this.ctx.db.system((tx) => tx.one<any>(`SELECT * FROM admin_user WHERE id = $1 AND status = 'active'`, [ch.subjectId]));
    if (!a) throw new DomainError('unauthenticated', 401);
    const raw = randomToken();
    const csrfToken = this.csrfFor(raw);
    const meta = clientMeta(req);
    await this.ctx.db.system((tx) =>
      tx.query(
        `INSERT INTO admin_session (id_hash, admin_user_id, compound_id, csrf_token_hash, created_at, last_seen_at, expires_at, ip, user_agent)
         VALUES ($1,$2,$3,$4,$5,$5,$6,$7,$8)`,
        [sha256(raw), a.id, a.compound_id, sha256(csrfToken), now, new Date(now.getTime() + SESSION_ABSOLUTE_MS), meta.ip, meta.userAgent],
      ),
    );
    await this.ctx.db.tenant({ compoundId: a.compound_id }, async (tx) => {
      await tx.query(`UPDATE admin_user SET last_login_at = $2 WHERE id = $1`, [a.id, now]);
      await audit(tx, { compoundId: a.compound_id, actorType: 'admin', actorId: a.id, action: 'admin.login', entityType: 'admin_user', entityId: a.id, ...meta });
    });
    res.cookie(ADMIN_COOKIE, raw, { httpOnly: true, secure: true, sameSite: 'strict', path: '/', maxAge: SESSION_ABSOLUTE_MS });
    return { admin: await this.me(a.id, a.compound_id), csrfToken };
  }

  @Post('auth/mfa/resend')
  @HttpCode(200)
  async resend(@Req() req: AppRequest, @Body() body: unknown) {
    const { challengeId } = parse(resendBody, body);
    return this.otp.resend(challengeId, ['admin_mfa'], localeOf(req));
  }

  @Post('auth/logout')
  @HttpCode(204)
  @UseGuards(AdminGuard)
  async logout(@Req() req: AppRequest, @Res({ passthrough: true }) res: Response) {
    const a = admin(req);
    await this.ctx.db.system((tx) => tx.query(`UPDATE admin_session SET revoked_at = $2 WHERE id_hash = $1`, [a.sessionHash, this.ctx.now()]));
    await this.ctx.db.tenant({ compoundId: a.compoundId }, (tx) =>
      audit(tx, { compoundId: a.compoundId, actorType: 'admin', actorId: a.id, action: 'admin.logout', entityType: 'admin_user', entityId: a.id, ...clientMeta(req) }),
    );
    res.clearCookie(ADMIN_COOKIE, { httpOnly: true, secure: true, sameSite: 'strict', path: '/' });
  }

  @Post('auth/password/forgot')
  @HttpCode(202)
  async forgot(@Body() body: unknown) {
    const { email } = parse(forgotBody, body);
    const now = this.ctx.now();
    const a = await this.ctx.db.system(async (tx) => {
      await hit(tx, `pwreset:${email.toLowerCase()}`, 3, 3_600_000, 'rate_limited', now).catch(() => null);
      return tx.one<any>(`SELECT id, compound_id, locale, email FROM admin_user WHERE email = $1 AND status = 'active'`, [email]);
    });
    if (!a) return;
    const resetId = newId();
    const token = derivedToken(this.ctx.config.TOKEN_SECRET, 'password_reset', resetId);
    await this.ctx.db.system(async (tx) => {
      await tx.query(`INSERT INTO password_reset (token_hash, admin_user_id, expires_at) VALUES ($1,$2,$3)`, [sha256(token), a.id, new Date(now.getTime() + RESET_TTL_MS)]);
      // IDs only (B3): no address, body or token at rest in the job table. The worker loads the
      // recipient from admin_user and re-derives the link.
      await enqueue(tx, 'send-email', { template: 'password_reset', adminUserId: a.id, resetId, compoundId: a.compound_id });
    });
  }

  @Post('auth/password/reset')
  @HttpCode(204)
  async reset(@Req() req: AppRequest, @Body() body: unknown) {
    const { token, newPassword } = parse(resetBody, body);
    if (BREACHED.has(newPassword.toLowerCase())) throw new DomainError('password_too_weak', 422);
    const now = this.ctx.now();
    const hashed = await hashPassword(newPassword);
    const a = await this.ctx.db.system(async (tx) => {
      const r = await tx.one<any>(
        `UPDATE password_reset SET used_at = $2 WHERE token_hash = $1 AND used_at IS NULL AND expires_at > $2 RETURNING admin_user_id`,
        [sha256(token), now],
      );
      if (!r) throw new DomainError('reset_token_invalid', 400);
      const u = await tx.one<any>(`UPDATE admin_user SET password_hash = $2, failed_logins = 0, locked_until = NULL, updated_at = $3 WHERE id = $1 RETURNING id, compound_id`, [r.admin_user_id, hashed, now]);
      await tx.query(`UPDATE admin_session SET revoked_at = $2 WHERE admin_user_id = $1 AND revoked_at IS NULL`, [r.admin_user_id, now]);
      return u;
    });
    await this.ctx.db.tenant({ compoundId: a.compound_id }, (tx) =>
      audit(tx, { compoundId: a.compound_id, actorType: 'admin', actorId: a.id, action: 'admin.password_reset', entityType: 'admin_user', entityId: a.id, ...clientMeta(req) }),
    );
  }

  @Get('me')
  @UseGuards(AdminGuard)
  async getMe(@Req() req: AppRequest, @Res({ passthrough: true }) res: Response) {
    const a = admin(req);
    // Contract addition (open question to Architect): lets the portal recover the CSRF token after reload.
    res.setHeader('X-CSRF-Token', this.csrfFor(req.cookies[ADMIN_COOKIE]));
    return this.me(a.id, a.compoundId);
  }

  /** Contract v1.1: the admin's own portal language. */
  @Patch('me')
  @UseGuards(AdminGuard)
  async patchMe(@Req() req: AppRequest, @Body() body: unknown) {
    const { locale } = parse(localeBody, body);
    const a = admin(req);
    await this.ctx.db.tenant({ compoundId: a.compoundId }, async (tx) => {
      await tx.query(`UPDATE admin_user SET locale = $2, updated_at = $3 WHERE id = $1`, [a.id, locale, this.ctx.now()]);
      await audit(tx, { compoundId: a.compoundId, actorType: 'admin', actorId: a.id, action: 'admin.locale', entityType: 'admin_user', entityId: a.id, changes: { locale: [a.locale, locale] }, ...clientMeta(req) });
    });
    return this.me(a.id, a.compoundId);
  }

  /** Contract v1.1: change own password; every other session of this admin is revoked, this one kept. */
  @Post('me/password')
  @HttpCode(204)
  @UseGuards(AdminGuard)
  async changePassword(@Req() req: AppRequest, @Body() body: unknown) {
    const { currentPassword, newPassword } = parse(changePasswordBody, body);
    const a = admin(req);
    const now = this.ctx.now();
    await this.ctx.db.system((tx) => hit(tx, `pwchange:${a.id}`, 5, 15 * 60 * 1000, 'rate_limited', now));
    const row = await this.ctx.db.system((tx) => tx.one<any>(`SELECT password_hash FROM admin_user WHERE id = $1`, [a.id]));
    if (!row || !(await argonVerify(row.password_hash, currentPassword).catch(() => false))) throw new DomainError('current_password_invalid', 400);
    if (BREACHED.has(newPassword.toLowerCase())) throw new DomainError('password_too_weak', 422);
    const hashed = await hashPassword(newPassword);
    await this.ctx.db.system(async (tx) => {
      await tx.query(`UPDATE admin_user SET password_hash = $2, updated_at = $3 WHERE id = $1`, [a.id, hashed, now]);
      await tx.query(`UPDATE admin_session SET revoked_at = $3 WHERE admin_user_id = $1 AND id_hash <> $2 AND revoked_at IS NULL`, [a.id, a.sessionHash, now]);
    });
    await this.ctx.db.tenant({ compoundId: a.compoundId }, (tx) =>
      audit(tx, { compoundId: a.compoundId, actorType: 'admin', actorId: a.id, action: 'admin.password_change', entityType: 'admin_user', entityId: a.id, ...clientMeta(req) }),
    );
  }

  private async me(adminId: string, compoundId: string) {
    return this.ctx.db.tenant({ compoundId }, async (tx) => {
      const a = await tx.one<any>(`SELECT * FROM admin_user WHERE id = $1`, [adminId]);
      return { id: a.id, fullName: a.full_name, email: a.email, role: a.role, locale: a.locale, compound: await compoundDto(this.ctx, tx, compoundId) };
    });
  }
}

