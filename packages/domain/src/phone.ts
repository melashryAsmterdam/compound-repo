import { DomainError } from './errors';

/**
 * Saudi mobile normalisation (K-4). Accepts +9665XXXXXXXX, 009665…, 9665…,
 * 05XXXXXXXX, 5XXXXXXXX, with spaces/dashes/brackets and Arabic-Indic or
 * Eastern Arabic (Persian) digits. Returns E.164 (+9665XXXXXXXX) or null.
 */
export function toWesternDigits(input: string): string {
  return input
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0));
}

export function normaliseSaudiMobile(input: string): string | null {
  let s = toWesternDigits(input).replace(/[\s\-().‎‏]/g, '');
  if (s.startsWith('+')) s = s.slice(1);
  else if (s.startsWith('00')) s = s.slice(2);
  if (!/^\d+$/.test(s)) return null;
  if (s.startsWith('966')) s = s.slice(3);
  if (s.startsWith('0')) s = s.slice(1);
  return /^5\d{8}$/.test(s) ? `+966${s}` : null;
}

/** +966512345678 → +9665*****678 */
export function maskPhone(e164: string): string {
  if (e164.length < 8) return '*'.repeat(e164.length);
  return `${e164.slice(0, 5)}${'*'.repeat(e164.length - 8)}${e164.slice(-3)}`;
}

/** noura@gmail.com → n***@gmail.com */
export function maskEmail(email: string): string {
  const at = email.indexOf('@');
  if (at < 1) return '***';
  return `${email[0]}***${email.slice(at)}`;
}

export function maskDestination(destination: string): string {
  return destination.includes('@') ? maskEmail(destination) : maskPhone(destination);
}

/**
 * Throwing form of `normaliseSaudiMobile` (kept from main; the mobile app imports it).
 * Same rule, one implementation: invalid input throws DomainError('phone_invalid', 422).
 */
export function normalise(input: string): string {
  const e164 = normaliseSaudiMobile(input);
  if (!e164) throw new DomainError('phone_invalid', 422);
  return e164;
}

/** Masked form kept from main (bullet characters): +9665•••••678. New code uses `maskPhone`. */
export function mask(e164: string): string {
  return e164.slice(0, 5) + '•'.repeat(Math.max(0, e164.length - 8)) + e164.slice(-3);
}
