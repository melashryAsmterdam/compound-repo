import { Inject, Injectable } from '@nestjs/common';
import { DomainError, mask } from '@compound/domain';
import { CONFIG, type Config } from '../../config.js';
import { AuditService } from '../../infra/audit.service.js';
import { Clock } from '../../infra/clock.js';
import { maskEmail, randomToken, sha256 } from '../../infra/crypto.js';
import { Db, setCompound, type Queryable } from '../../infra/db/db.service.js';
import { unauthenticated } from '../../infra/errors.js';
import { Messenger } from '../../infra/messaging/messenger.js';
import { OtpService, resendAvailableAt, type OtpChallengeRow } from '../../infra/otp.service.js';
import { RateLimitService } from '../../infra/rate-limit.service.js';
import { burnPasswordCheck, hashPassword, PASSWORD_MIN, verifyPassword } from './password.js';

export const MAX_FAILED_LOGINS = 5;
export const LOCK_MS = 15 * 60 * 1000;
export const SESSION_ABSOLUTE_MS = 12 * 60 * 60 * 1000;
export const RESET_TTL_MS = 30 * 60 * 1000;

interface AdminRow {
  id: string;
  compound_id: string;
  email: string;
  full_name: string;
  phone_e164: string | null;
  password_hash: string;
  role: 'compound_admin';
  mfa_channel: 'sms' | 'email';
  locale: 'ar' | 'en';
  failed_logins: number;
  locked_until: Date | null;
  status: 'active' | 'inactive';
}

export interface RequestMeta {
  ip: string | null;
  userAgent: string | null;
}

type Outcome<T> = { ok: true; value: T } | { ok: false; error: DomainError };
const fail = (code: string, status: number): { ok: false; error: DomainError } => ({
  ok: false,
  error: new DomainError(code, status),
});

/**
 * Admin sign-in (A0). Transactions return an outcome instead of throwing, so counters
 * (failed logins, OTP attempts, rate limits) are committed even when the call is refused.
 */
@Injectable()
export class AuthService {
  constructor(
    @Inject(Db) private readonly db: Db,
    @Inject(Clock) private readonly clock: Clock,
    @Inject(OtpService) private readonly otp: OtpService,
    @Inject(RateLimitService) private readonly rateLimit: RateLimitService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(Messenger) private readonly messenger: Messenger,
    @Inject(CONFIG) private readonly config: Config,
  ) {}

  async login(emailInput: string, password: string, meta: RequestMeta) {
    const email = emailInput.trim().toLowerCase();
    const now = this.clock.now();

    const outcome = await this.db.global(async (q): Promise<Outcome<{ admin: AdminRow; challenge: OtpChallengeRow; code: string }>> => {
      if (!(await this.rateLimit.hit(q, `admin-login-ip:${meta.ip ?? 'unknown'}`, 10 * 60_000, 20))) {
        return fail('rate_limited', 429);
      }
      const admin = await findAdminForLogin(q, 'email', email);
      if (!admin || admin.status !== 'active') {
        await burnPasswordCheck(password);
        return fail('invalid_credentials', 401);
      }
      await setCompound(q, admin.compound_id);
      // Re-read under a row lock so concurrent attempts cannot lose a failure count.
      const lock = await q.query<Pick<AdminRow, 'failed_logins' | 'locked_until'>>(
        'SELECT failed_logins, locked_until FROM admin_user WHERE id = $1 FOR UPDATE',
        [admin.id],
      );
      Object.assign(admin, lock.rows[0]);
      if (admin.locked_until && admin.locked_until > now) return fail('account_locked', 423);

      if (!(await verifyPassword(admin.password_hash, password))) {
        const failed = admin.failed_logins + 1;
        const locks = failed >= MAX_FAILED_LOGINS;
        await q.query('UPDATE admin_user SET failed_logins = $2, locked_until = $3, updated_at = $4 WHERE id = $1', [
          admin.id,
          locks ? 0 : failed,
          locks ? new Date(now.getTime() + LOCK_MS) : null,
          now,
        ]);
        await this.audit.record(q, {
          compoundId: admin.compound_id,
          actorType: 'admin',
          actorId: admin.id,
          action: locks ? 'admin.locked' : 'admin.login_failed',
          entityType: 'admin_user',
          entityId: admin.id,
          ...meta,
        });
        return locks ? fail('account_locked', 423) : fail('invalid_credentials', 401);
      }

      await q.query('UPDATE admin_user SET failed_logins = 0, locked_until = NULL WHERE id = $1', [admin.id]);
      const destination = admin.mfa_channel === 'sms' && admin.phone_e164 ? admin.phone_e164 : admin.email;
      const channel = destination === admin.email ? 'email' : 'sms';
      const { challenge, code } = await this.otp.create(q, {
        purpose: 'admin_mfa',
        subjectId: admin.id,
        destination,
        channel,
      });
      return { ok: true, value: { admin, challenge, code } };
    });

    if (!outcome.ok) throw outcome.error;
    const { admin, challenge, code } = outcome.value;
    await this.messenger.send({
      channel: challenge.channel,
      destination: challenge.destination,
      locale: admin.locale,
      template: { kind: 'admin_otp', code },
    });
    return toChallengeDto(challenge);
  }

  async resendMfa(challengeId: string) {
    const outcome = await this.db.global(async (q) => {
      const r = await this.otp.resend(q, challengeId, 'admin_mfa');
      if (!r.ok) return r;
      const admin = await findAdminForLogin(q, 'id', r.challenge.subject_id!);
      return { ...r, locale: admin?.locale ?? 'ar' };
    });
    if (!outcome.ok) throw new DomainError(outcome.failure, outcome.failure === 'rate_limited' ? 429 : 400);
    await this.messenger.send({
      channel: outcome.challenge.channel,
      destination: outcome.challenge.destination,
      locale: outcome.locale,
      template: { kind: 'admin_otp', code: outcome.code },
    });
    return toChallengeDto(outcome.challenge);
  }

  async verifyMfa(challengeId: string, code: string, meta: RequestMeta) {
    const now = this.clock.now();
    const outcome = await this.db.global(async (q): Promise<Outcome<{ token: string; csrf: string; admin: AdminRow }>> => {
      const r = await this.otp.verify(q, challengeId, code, 'admin_mfa');
      if (!r.ok) return fail(r.failure, r.failure === 'otp_attempts_exceeded' ? 429 : 400);
      const admin = await findAdminForLogin(q, 'id', r.challenge.subject_id!);
      if (!admin || admin.status !== 'active') return fail('otp_invalid', 400);

      const token = randomToken();
      const csrf = randomToken();
      await q.query(
        `INSERT INTO admin_session (id_hash, admin_user_id, compound_id, csrf_token_hash, created_at, last_seen_at, expires_at, ip, user_agent)
         VALUES ($1, $2, $3, $4, $5, $5, $6, $7, $8)`,
        [sha256(token), admin.id, admin.compound_id, sha256(csrf), now, new Date(now.getTime() + SESSION_ABSOLUTE_MS), meta.ip, meta.userAgent],
      );
      await setCompound(q, admin.compound_id);
      await q.query('UPDATE admin_user SET last_login_at = $2 WHERE id = $1', [admin.id, now]);
      await this.audit.record(q, {
        compoundId: admin.compound_id,
        actorType: 'admin',
        actorId: admin.id,
        action: 'admin.login',
        entityType: 'admin_user',
        entityId: admin.id,
        ...meta,
      });
      return { ok: true, value: { token, csrf, admin } };
    });
    if (!outcome.ok) throw outcome.error;
    const { token, csrf, admin } = outcome.value;
    return { token, csrfToken: csrf, me: await this.me(admin.id, admin.compound_id) };
  }

  async logout(adminId: string, compoundId: string, sessionIdHash: Buffer, meta: RequestMeta): Promise<void> {
    await this.db.tenant(compoundId, async (q) => {
      await q.query('UPDATE admin_session SET revoked_at = $2 WHERE id_hash = $1', [sessionIdHash, this.clock.now()]);
      await this.audit.record(q, {
        compoundId,
        actorType: 'admin',
        actorId: adminId,
        action: 'admin.logout',
        entityType: 'admin_user',
        entityId: adminId,
        ...meta,
      });
    });
  }

  async me(adminId: string, compoundId: string) {
    return this.db.tenant(compoundId, async (q) => {
      const { rows } = await q.query<{
        id: string;
        full_name: string;
        email: string;
        role: 'compound_admin';
        locale: 'ar' | 'en';
        c_id: string;
        name_ar: string;
        name_en: string;
        contact_phone: string;
        timezone: string;
      }>(
        `SELECT a.id, a.full_name, a.email, a.role, a.locale,
                c.id AS c_id, c.name_ar, c.name_en, c.contact_phone, c.timezone
         FROM admin_user a JOIN compound c ON c.id = a.compound_id WHERE a.id = $1`,
        [adminId],
      );
      const r = rows[0];
      if (!r) throw unauthenticated();
      return {
        id: r.id,
        fullName: r.full_name,
        email: r.email,
        role: r.role,
        locale: r.locale,
        compound: {
          id: r.c_id,
          nameAr: r.name_ar,
          nameEn: r.name_en,
          logoUrl: null,
          contactPhone: r.contact_phone,
          timezone: r.timezone,
        },
      };
    });
  }

  /** Always succeeds from the caller's view (no account enumeration, A0-AC4). */
  async forgotPassword(emailInput: string, meta: RequestMeta): Promise<void> {
    const email = emailInput.trim().toLowerCase();
    const now = this.clock.now();
    const found = await this.db.global(async (q) => {
      if (!(await this.rateLimit.hit(q, `pwreset:${email}`, 60 * 60_000, 5))) return null;
      if (!(await this.rateLimit.hit(q, `pwreset-ip:${meta.ip ?? 'unknown'}`, 60 * 60_000, 20))) return null;
      const admin = await findAdminForLogin(q, 'email', email);
      if (!admin || admin.status !== 'active') return null;
      const token = randomToken();
      await q.query('INSERT INTO password_reset (token_hash, admin_user_id, expires_at) VALUES ($1, $2, $3)', [
        sha256(token),
        admin.id,
        new Date(now.getTime() + RESET_TTL_MS),
      ]);
      return { admin, token };
    });
    if (!found) return;
    const link = `${this.config.PORTAL_ORIGIN}/${found.admin.locale}/reset-password?token=${found.token}`;
    await this.messenger.send({
      channel: 'email',
      destination: found.admin.email,
      locale: found.admin.locale,
      template: { kind: 'password_reset', link },
    });
  }

  async resetPassword(token: string, newPassword: string, meta: RequestMeta): Promise<void> {
    if (newPassword.length < PASSWORD_MIN) throw new DomainError('password_too_short', 422);
    const passwordHash = await hashPassword(newPassword);
    const now = this.clock.now();
    const outcome = await this.db.global(async (q): Promise<Outcome<null>> => {
      const { rows } = await q.query<{ admin_user_id: string; expires_at: Date; used_at: Date | null }>(
        'SELECT admin_user_id, expires_at, used_at FROM password_reset WHERE token_hash = $1 FOR UPDATE',
        [sha256(token)],
      );
      const reset = rows[0];
      if (!reset || reset.used_at || reset.expires_at <= now) return fail('reset_token_invalid', 400);
      const admin = await findAdminForLogin(q, 'id', reset.admin_user_id);
      if (!admin) return fail('reset_token_invalid', 400);
      await setCompound(q, admin.compound_id);
      await q.query('UPDATE password_reset SET used_at = $2 WHERE token_hash = $1', [sha256(token), now]);
      await q.query(
        'UPDATE admin_user SET password_hash = $2, failed_logins = 0, locked_until = NULL, updated_at = $3 WHERE id = $1',
        [admin.id, passwordHash, now],
      );
      await q.query('UPDATE admin_session SET revoked_at = $2 WHERE admin_user_id = $1 AND revoked_at IS NULL', [admin.id, now]);
      await this.audit.record(q, {
        compoundId: admin.compound_id,
        actorType: 'admin',
        actorId: admin.id,
        action: 'admin.password_reset',
        entityType: 'admin_user',
        entityId: admin.id,
        ...meta,
      });
      return { ok: true, value: null };
    });
    if (!outcome.ok) throw outcome.error;
  }
}

/**
 * The one place that reads admin_user before the compound is known (see migration 0002,
 * policy admin_login_lookup). The flag is cleared before returning.
 */
async function findAdminForLogin(q: Queryable, by: 'email' | 'id', value: string): Promise<AdminRow | undefined> {
  await q.query(`SELECT set_config('app.purpose', 'admin_login', true)`);
  try {
    const { rows } = await q.query<AdminRow>(
      `SELECT id, compound_id, email, full_name, phone_e164, password_hash, role, mfa_channel, locale,
              failed_logins, locked_until, status
       FROM admin_user WHERE ${by === 'email' ? 'email' : 'id'} = $1`,
      [value],
    );
    return rows[0];
  } finally {
    await q.query(`SELECT set_config('app.purpose', '', true)`);
  }
}

function toChallengeDto(c: OtpChallengeRow) {
  return {
    challengeId: c.id,
    channel: c.channel,
    maskedDestination: c.channel === 'sms' ? mask(c.destination) : maskEmail(c.destination),
    expiresAt: c.expires_at.toISOString(),
    resendsRemaining: Math.max(0, 3 - c.resends),
    resendAvailableAt: resendAvailableAt(c).toISOString(),
  };
}
