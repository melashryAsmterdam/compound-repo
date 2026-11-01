import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';

/** UUID v7 (RFC 9562): 48-bit ms timestamp + random; time-ordered primary keys. */
export function newId(): string {
  const b = randomBytes(16);
  const ms = BigInt(Date.now());
  for (let i = 0; i < 6; i++) b[i] = Number((ms >> BigInt(8 * (5 - i))) & 0xffn);
  b[6] = (b[6]! & 0x0f) | 0x70;
  b[8] = (b[8]! & 0x3f) | 0x80;
  const h = b.toString('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
export const sha256 = (s: string | Buffer) => createHash('sha256').update(s).digest();
/** 32 random bytes → 43-char base64url (activation links, sessions, refresh tokens). */
export const randomToken = () => randomBytes(32).toString('base64url');
export const otpCode = () => String(randomInt(0, 1_000_000)).padStart(6, '0');
export const hmac = (key: string, s: string) => createHmac('sha256', key).update(s).digest();

/**
 * Link token derived from a server secret and a row id (B3): 43-char base64url like randomToken(),
 * but the worker can recompute it at send time, so the raw token is never stored (DB or job
 * payload). Only sha256(token) is persisted.
 */
export const derivedToken = (secret: string, purpose: 'invitation' | 'password_reset', id: string) =>
  hmac(secret, `${purpose}:${id}`).toString('base64url');

export function safeEqual(a: Buffer | Uint8Array, b: Buffer | Uint8Array): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/** bytea values come back as Uint8Array (PGlite) or Buffer (pg). */
export const buf = (v: unknown) => Buffer.from(v as Uint8Array);
