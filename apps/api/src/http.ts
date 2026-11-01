import { CanActivate, ExecutionContext, Inject, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { jwtVerify } from 'jose';
import type { ZodType } from 'zod';
import { DomainError } from './errors';
import { AppContext } from './infra/context';
import { buf, safeEqual, sha256 } from './infra/crypto';
import type { Locale } from '@compound/i18n';

export const ADMIN_COOKIE = '__Host-cs_admin';
export const ADMIN_IDLE_MS = 30 * 60 * 1000;

export interface AdminPrincipal {
  id: string;
  compoundId: string;
  fullName: string;
  email: string;
  locale: Locale;
  sessionHash: Buffer;
}

export interface ResidentPrincipal {
  personId: string;
  deviceId: string;
  familyId: string;
}

export interface AppRequest extends Request {
  admin?: AdminPrincipal;
  resident?: ResidentPrincipal;
}

export function parse<T>(schema: ZodType<T>, value: unknown): T {
  return schema.parse(value ?? {});
}

export function localeOf(req: Request): Locale {
  return String(req.headers['accept-language'] ?? '').toLowerCase().startsWith('en') ? 'en' : 'ar';
}

export function clientMeta(req: Request) {
  return { ip: req.ip ?? null, userAgent: (req.headers['user-agent'] as string | undefined) ?? null };
}

const SAFE = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * @AdminOnly — session cookie (30-min idle, 12-h absolute) + CSRF synchroniser
 * token and Origin check on every mutation (05-auth §2).
 */
@Injectable()
export class AdminGuard implements CanActivate {
  constructor(@Inject(AppContext) private readonly ctx: AppContext) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<AppRequest>();
    const raw = req.cookies?.[ADMIN_COOKIE] as string | undefined;
    if (!raw) throw new DomainError('unauthenticated', 401);
    const idHash = sha256(raw);
    const now = this.ctx.now();
    const row = await this.ctx.db.system((tx) =>
      tx.one<any>(
        `SELECT s.csrf_token_hash, s.last_seen_at, s.expires_at, a.id, a.compound_id, a.full_name, a.email, a.locale, a.status
           FROM admin_session s JOIN admin_user a ON a.id = s.admin_user_id
          WHERE s.id_hash = $1 AND s.revoked_at IS NULL`,
        [idHash],
      ),
    );
    if (!row || row.status !== 'active') throw new DomainError('unauthenticated', 401);
    if (new Date(row.expires_at) <= now || now.getTime() - new Date(row.last_seen_at).getTime() > ADMIN_IDLE_MS) {
      throw new DomainError('unauthenticated', 401, { reason: 'session_expired' });
    }
    if (!SAFE.has(req.method)) {
      const origin = req.headers.origin;
      if (origin && origin !== this.ctx.config.PORTAL_ORIGIN && origin !== this.ctx.config.PUBLIC_API_URL) {
        throw new DomainError('csrf_invalid', 403);
      }
      const token = req.headers['x-csrf-token'];
      if (typeof token !== 'string' || !safeEqual(sha256(token), buf(row.csrf_token_hash))) {
        throw new DomainError('csrf_invalid', 403);
      }
    }
    // Sliding idle timeout. The SSE stream does not count as activity.
    if (!req.path.endsWith('/events/stream')) {
      await this.ctx.db.system((tx) => tx.query(`UPDATE admin_session SET last_seen_at = $2 WHERE id_hash = $1`, [idHash, now]));
    }
    req.admin = { id: row.id, compoundId: row.compound_id, fullName: row.full_name, email: row.email, locale: row.locale, sessionHash: idHash };
    return true;
  }
}

/** Resident bearer (JWT ES256, 15 min). Unit access is resolved per call, never from the token. */
@Injectable()
export class ResidentGuard implements CanActivate {
  constructor(@Inject(AppContext) private readonly ctx: AppContext) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<AppRequest>();
    const auth = req.headers.authorization;
    const queryToken = typeof req.query.access_token === 'string' && req.path.endsWith('/events/stream') ? req.query.access_token : undefined;
    const token = auth?.startsWith('Bearer ') ? auth.slice(7) : queryToken;
    if (!token) throw new DomainError('unauthenticated', 401);
    try {
      const { payload } = await jwtVerify(token, this.ctx.jwt.publicKey, {
        issuer: this.ctx.config.JWT_ISSUER,
        audience: 'app',
        currentDate: this.ctx.now(),
      });
      req.resident = { personId: String(payload.sub), deviceId: String(payload.did), familyId: String(payload.sid) };
    } catch {
      throw new DomainError('unauthenticated', 401);
    }
    return true;
  }
}

export function admin(req: AppRequest): AdminPrincipal {
  return req.admin!;
}
export function resident(req: AppRequest): ResidentPrincipal {
  return req.resident!;
}
