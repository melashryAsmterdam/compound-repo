import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';

/** 256-bit random token, base64url (43 chars). */
export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

export function sha256(value: string): Buffer {
  return createHash('sha256').update(value).digest();
}

export function hmac(value: string, pepper: string): Buffer {
  return createHmac('sha256', pepper).update(value).digest();
}

export function sixDigitCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, '0');
}

export function safeEqual(a: Buffer, b: Buffer): boolean {
  return a.length === b.length && timingSafeEqual(a, b);
}

/** n***@gmail.com — for responses, logs and delivery rows. */
export function maskEmail(email: string): string {
  const [local = '', domain = ''] = email.split('@');
  return `${local.slice(0, 1)}***@${domain}`;
}
