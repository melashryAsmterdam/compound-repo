import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { CONFIG, type Config } from '../config.js';
import { Clock } from './clock.js';
import { hmac, safeEqual, sixDigitCode } from './crypto.js';
import type { Queryable } from './db/db.service.js';

export const OTP_TTL_MS = 5 * 60 * 1000;
export const OTP_MAX_ATTEMPTS = 5;
export const OTP_MAX_RESENDS = 3;
export const OTP_RESEND_COOLDOWN_MS = 60 * 1000;

export type OtpPurpose = 'activation' | 'resident_login' | 'admin_mfa';

export interface OtpChallengeRow {
  id: string;
  subject_id: string | null;
  destination: string;
  channel: 'sms' | 'email';
  expires_at: Date;
  resends: number;
}

export type OtpFailure = 'otp_invalid' | 'otp_expired' | 'otp_attempts_exceeded' | 'rate_limited';

/**
 * One-time codes for admin 2FA now, resident sign-in and activation later. Codes are stored as
 * HMAC-SHA256 with a server pepper. Failures are returned, not thrown, so the caller can commit
 * the attempt counter before raising the error.
 */
@Injectable()
export class OtpService {
  constructor(
    @Inject(Clock) private readonly clock: Clock,
    @Inject(CONFIG) private readonly config: Config,
  ) {}

  async create(
    q: Queryable,
    input: { purpose: OtpPurpose; subjectId: string; destination: string; channel: 'sms' | 'email' },
  ): Promise<{ challenge: OtpChallengeRow; code: string }> {
    const code = sixDigitCode();
    const { rows } = await q.query<OtpChallengeRow>(
      `INSERT INTO otp_challenge (id, purpose, subject_id, destination, channel, code_hash, expires_at, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id, subject_id, destination, channel, expires_at, resends`,
      [
        randomUUID(),
        input.purpose,
        input.subjectId,
        input.destination,
        input.channel,
        hmac(code, this.config.OTP_PEPPER),
        new Date(this.clock.now().getTime() + OTP_TTL_MS),
        this.clock.now(),
      ],
    );
    return { challenge: rows[0]!, code };
  }

  async verify(
    q: Queryable,
    challengeId: string,
    code: string,
    purpose: OtpPurpose,
  ): Promise<{ ok: true; challenge: OtpChallengeRow } | { ok: false; failure: OtpFailure }> {
    const row = await this.lock(q, challengeId, purpose);
    if (!row || row.consumed_at) return { ok: false, failure: 'otp_invalid' };
    if (row.attempts >= OTP_MAX_ATTEMPTS) return { ok: false, failure: 'otp_attempts_exceeded' };
    if (row.expires_at <= this.clock.now()) return { ok: false, failure: 'otp_expired' };
    if (!safeEqual(hmac(code, this.config.OTP_PEPPER), row.code_hash)) {
      await q.query('UPDATE otp_challenge SET attempts = attempts + 1 WHERE id = $1', [row.id]);
      return { ok: false, failure: row.attempts + 1 >= OTP_MAX_ATTEMPTS ? 'otp_attempts_exceeded' : 'otp_invalid' };
    }
    await q.query('UPDATE otp_challenge SET consumed_at = $2 WHERE id = $1', [row.id, this.clock.now()]);
    return { ok: true, challenge: row };
  }

  async resend(
    q: Queryable,
    challengeId: string,
    purpose: OtpPurpose,
  ): Promise<{ ok: true; challenge: OtpChallengeRow; code: string } | { ok: false; failure: OtpFailure }> {
    const row = await this.lock(q, challengeId, purpose);
    if (!row || row.consumed_at || row.attempts >= OTP_MAX_ATTEMPTS) return { ok: false, failure: 'otp_invalid' };
    const lastSentAt = row.expires_at.getTime() - OTP_TTL_MS;
    if (row.resends >= OTP_MAX_RESENDS || this.clock.now().getTime() < lastSentAt + OTP_RESEND_COOLDOWN_MS) {
      return { ok: false, failure: 'rate_limited' };
    }
    const code = sixDigitCode();
    const { rows } = await q.query<OtpChallengeRow>(
      `UPDATE otp_challenge SET code_hash = $2, expires_at = $3, resends = resends + 1, attempts = 0
       WHERE id = $1 RETURNING id, subject_id, destination, channel, expires_at, resends`,
      [row.id, hmac(code, this.config.OTP_PEPPER), new Date(this.clock.now().getTime() + OTP_TTL_MS)],
    );
    return { ok: true, challenge: rows[0]!, code };
  }

  private async lock(q: Queryable, id: string, purpose: OtpPurpose) {
    const { rows } = await q.query<
      OtpChallengeRow & { code_hash: Buffer; attempts: number; consumed_at: Date | null }
    >(
      `SELECT id, subject_id, destination, channel, expires_at, resends, code_hash, attempts, consumed_at
       FROM otp_challenge WHERE id = $1 AND purpose = $2 FOR UPDATE`,
      [id, purpose],
    );
    return rows[0];
  }
}

export function resendAvailableAt(challenge: OtpChallengeRow): Date {
  return new Date(challenge.expires_at.getTime() - OTP_TTL_MS + OTP_RESEND_COOLDOWN_MS);
}
