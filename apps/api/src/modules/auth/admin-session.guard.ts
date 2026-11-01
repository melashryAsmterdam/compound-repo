import { CanActivate, ExecutionContext, Inject, Injectable } from '@nestjs/common';
import { DomainError } from '@compound/domain';
import { adminCookieName, CONFIG, type Config } from '../../config.js';
import { Clock } from '../../infra/clock.js';
import { safeEqual, sha256 } from '../../infra/crypto.js';
import { Db } from '../../infra/db/db.service.js';
import { unauthenticated } from '../../infra/errors.js';
import type { AdminRequest } from './admin-context.js';

export const IDLE_TIMEOUT_MS = 30 * 60 * 1000;
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/** @AdminOnly — session cookie, 30-min idle timeout, CSRF token + Origin check on mutations. */
@Injectable()
export class AdminSessionGuard implements CanActivate {
  constructor(
    @Inject(Db) private readonly db: Db,
    @Inject(Clock) private readonly clock: Clock,
    @Inject(CONFIG) private readonly config: Config,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<AdminRequest>();
    const cookie = (req.cookies as Record<string, string | undefined>)[adminCookieName(this.config)];
    if (!cookie) throw unauthenticated();

    const mutating = !SAFE_METHODS.has(req.method);
    if (mutating) {
      const origin = req.headers.origin;
      if (origin && origin !== this.config.PORTAL_ORIGIN) throw new DomainError('forbidden', 403);
    }

    const idHash = sha256(cookie);
    const now = this.clock.now();
    const session = await this.db.global(async (q) => {
      const { rows } = await q.query<{
        admin_user_id: string;
        compound_id: string;
        csrf_token_hash: Buffer;
        last_seen_at: Date;
        expires_at: Date;
        revoked_at: Date | null;
      }>(
        `SELECT admin_user_id, compound_id, csrf_token_hash, last_seen_at, expires_at, revoked_at
         FROM admin_session WHERE id_hash = $1 FOR UPDATE`,
        [idHash],
      );
      const row = rows[0];
      if (
        !row ||
        row.revoked_at ||
        row.expires_at <= now ||
        now.getTime() - row.last_seen_at.getTime() > IDLE_TIMEOUT_MS
      ) {
        return null;
      }
      await q.query('UPDATE admin_session SET last_seen_at = $2 WHERE id_hash = $1', [idHash, now]);
      return row;
    });
    if (!session) throw unauthenticated();

    if (mutating) {
      const header = req.headers['x-csrf-token'];
      if (typeof header !== 'string' || !safeEqual(sha256(header), session.csrf_token_hash)) {
        throw new DomainError('csrf_invalid', 403);
      }
    }

    req.admin = {
      adminId: session.admin_user_id,
      compoundId: session.compound_id,
      sessionIdHash: idHash,
      ip: req.ip ?? null,
      userAgent: req.headers['user-agent'] ?? null,
    };
    return true;
  }
}
