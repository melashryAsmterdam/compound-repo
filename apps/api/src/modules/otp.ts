import { Inject, Injectable } from '@nestjs/common';
import { maskDestination } from '@compound/domain';
import { emailText, smsText, type Locale } from '@compound/i18n';
import { DomainError } from '../errors';
import { AppContext } from '../infra/context';
import { buf, hmac, newId, otpCode, safeEqual } from '../infra/crypto';
import { hit } from '../infra/ratelimit';

export type OtpPurpose = 'activation' | 'resident_login' | 'admin_mfa';

const TTL_MS = 5 * 60 * 1000;
const MAX_RESENDS = 3;
const MAX_ATTEMPTS = 5;
const RESEND_COOLDOWN_MS = 60 * 1000;
const HOUR = 3_600_000;

export interface OtpChallengeDto {
  challengeId: string;
  channel: 'sms' | 'email';
  maskedDestination: string;
  expiresAt: string;
  resendsRemaining: number;
  resendAvailableAt: string;
}

export interface VerifiedChallenge {
  id: string;
  purpose: OtpPurpose;
  subjectId: string | null;
  destination: string;
  channel: 'sms' | 'email';
}

/** OTP challenges (05-auth §3): 6 digits, HMAC-stored, 5 min, ≤3 resends, ≤5 wrong attempts. */
@Injectable()
export class OtpService {
  constructor(@Inject(AppContext) private readonly ctx: AppContext) {}

  private code(): string {
    const fixed = this.ctx.config.DEV_FIXED_OTP;
    return fixed && this.ctx.config.NODE_ENV !== 'production' ? fixed : otpCode();
  }

  private hash(id: string, code: string) {
    return hmac(this.ctx.config.OTP_PEPPER, `${id}:${code}`);
  }

  /**
   * Create a challenge. When `deliver` is false (unknown sign-in number) the
   * challenge exists but nothing is sent, so responses never reveal registration.
   */
  async issue(opts: {
    purpose: OtpPurpose;
    subjectId: string | null;
    destination: string;
    channel: 'sms' | 'email';
    locale: Locale;
    ip: string | null;
    compoundId?: string | null;
    deliver?: boolean;
  }): Promise<OtpChallengeDto> {
    const now = this.ctx.now();
    const id = newId();
    const code = this.code();
    await this.ctx.db.system(async (tx) => {
      await hit(tx, `otp:dest:h:${opts.destination}`, this.ctx.config.OTP_DEST_HOURLY_LIMIT, HOUR, 'rate_limited', now);
      await hit(tx, `otp:dest:d:${opts.destination}`, 50, 24 * HOUR, 'rate_limited', now);
      if (opts.ip) await hit(tx, `otp:ip:${opts.ip}`, this.ctx.config.OTP_IP_HOURLY_LIMIT, HOUR, 'rate_limited', now);
    });
    await this.ctx.db.system((tx) =>
      tx.query(
        `INSERT INTO otp_challenge (id, purpose, subject_id, destination, channel, code_hash, expires_at, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [id, opts.purpose, opts.subjectId, opts.destination, opts.channel, this.hash(id, code), new Date(now.getTime() + TTL_MS), now],
      ),
    );
    if (opts.deliver !== false) await this.send(id, opts.destination, opts.channel, code, opts.locale, opts.compoundId ?? null);
    return this.dto({ id, channel: opts.channel, destination: opts.destination, expires_at: new Date(now.getTime() + TTL_MS), resends: 0, created_at: now });
  }

  async resend(challengeId: string, purposes: OtpPurpose[], locale: Locale): Promise<OtpChallengeDto> {
    const now = this.ctx.now();
    const row = await this.ctx.db.system((tx) => tx.one<any>(`SELECT * FROM otp_challenge WHERE id = $1`, [challengeId]));
    if (!row || !purposes.includes(row.purpose) || row.consumed_at) throw new DomainError('otp_expired', 400);
    if (row.resends >= MAX_RESENDS) throw new DomainError('otp_resend_limit', 429);
    const lastSent = new Date(row.created_at);
    if (now.getTime() - lastSent.getTime() < RESEND_COOLDOWN_MS) throw new DomainError('rate_limited', 429, { resendAvailableAt: new Date(lastSent.getTime() + RESEND_COOLDOWN_MS).toISOString() });
    const code = this.code();
    const expiresAt = new Date(now.getTime() + TTL_MS);
    await this.ctx.db.system(async (tx) => {
      await hit(tx, `otp:dest:h:${row.destination}`, this.ctx.config.OTP_DEST_HOURLY_LIMIT, HOUR, 'rate_limited', now);
      await tx.query(
        `UPDATE otp_challenge SET code_hash = $2, expires_at = $3, resends = resends + 1, attempts = 0, created_at = $4 WHERE id = $1`,
        [challengeId, this.hash(challengeId, code), expiresAt, now],
      );
    });
    // A subject-less challenge (unknown sign-in number) is never delivered.
    if (row.subject_id) await this.send(challengeId, row.destination, row.channel, code, locale, null);
    return this.dto({ id: challengeId, channel: row.channel, destination: row.destination, expires_at: expiresAt, resends: row.resends + 1, created_at: now });
  }

  /** Verify and consume. Wrong attempts are committed even though the call fails. */
  async verify(challengeId: string, code: string, purposes: OtpPurpose[]): Promise<VerifiedChallenge> {
    const now = this.ctx.now();
    const row = await this.ctx.db.system((t) => t.one<any>(`SELECT * FROM otp_challenge WHERE id = $1`, [challengeId]));
    if (!row || !purposes.includes(row.purpose)) throw new DomainError('otp_invalid', 400);
    if (row.consumed_at || new Date(row.expires_at) <= now) throw new DomainError('otp_expired', 400);
    if (row.attempts >= MAX_ATTEMPTS) throw new DomainError('otp_attempts_exceeded', 400);
    const good = row.subject_id !== null && safeEqual(this.hash(challengeId, code), buf(row.code_hash));
    if (!good) {
      const r = await this.ctx.db.system((t) => t.one<{ attempts: number }>(`UPDATE otp_challenge SET attempts = attempts + 1 WHERE id = $1 RETURNING attempts`, [challengeId]));
      throw new DomainError(r!.attempts >= MAX_ATTEMPTS ? 'otp_attempts_exceeded' : 'otp_invalid', 400);
    }
    const done = await this.ctx.db.system((t) => t.query(`UPDATE otp_challenge SET consumed_at = $2 WHERE id = $1 AND consumed_at IS NULL RETURNING id`, [challengeId, now]));
    if (done.length === 0) throw new DomainError('otp_expired', 400);
    return { id: row.id, purpose: row.purpose, subjectId: row.subject_id, destination: row.destination, channel: row.channel };
  }

  private async send(challengeId: string, destination: string, channel: 'sms' | 'email', code: string, locale: Locale, compoundId: string | null) {
    const deliveryId = newId();
    await this.ctx.db.system((tx) =>
      tx.query(
        `INSERT INTO message_delivery (id, compound_id, otp_challenge_id, channel, destination_masked, provider, status, attempts)
         VALUES ($1,$2,$3,$4,$5,$6,'queued',0)`,
        [deliveryId, compoundId, challengeId, channel, maskDestination(destination), channel === 'sms' ? this.ctx.sms.provider : this.ctx.email.provider],
      ),
    );
    let providerMessageId: string | null = null;
    let status = 'sent';
    let failure: string | null = null;
    try {
      if (channel === 'sms') ({ providerMessageId } = await this.ctx.sms.send({ to: destination, text: smsText('otp', locale, { code }) }));
      else {
        const t = emailText('otp', locale, { code });
        ({ providerMessageId } = await this.ctx.email.send({ to: destination, subject: t.title, text: t.body }));
      }
    } catch (e) {
      status = 'failed';
      failure = String((e as Error).message).slice(0, 200);
    }
    await this.ctx.db.system((tx) =>
      tx.query(`UPDATE message_delivery SET status = $2, provider_message_id = $3, failure_reason = $4, attempts = 1, updated_at = now() WHERE id = $1`, [deliveryId, status, providerMessageId, failure]),
    );
  }

  private dto(r: { id: string; channel: 'sms' | 'email'; destination: string; expires_at: Date; resends: number; created_at: Date }): OtpChallengeDto {
    return {
      challengeId: r.id,
      channel: r.channel,
      maskedDestination: maskDestination(r.destination),
      expiresAt: r.expires_at.toISOString(),
      resendsRemaining: Math.max(0, MAX_RESENDS - r.resends),
      resendAvailableAt: new Date(r.created_at.getTime() + RESEND_COOLDOWN_MS).toISOString(),
    };
  }
}
