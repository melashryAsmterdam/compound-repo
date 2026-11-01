import { parsePhoneNumberFromString } from 'libphonenumber-js/max';
import { DomainError } from './errors.js';

const ARABIC_INDIC = '٠١٢٣٤٥٦٧٨٩';
const PERSIAN = '۰۱۲۳۴۵۶۷۸۹';

/** Map Arabic-Indic and Persian digits to Western digits (K-4). */
export function toWesternDigits(input: string): string {
  return input.replace(/[٠-٩۰-۹]/g, (d) => {
    const i = ARABIC_INDIC.indexOf(d);
    return String(i >= 0 ? i : PERSIAN.indexOf(d));
  });
}

/**
 * Normalise a Saudi mobile number to E.164 (+9665XXXXXXXX). Accepts 05…, 5…, +966…, 00966…
 * with any digit script and common separators (ADR-015). MVP accepts Saudi mobiles only.
 */
export function normalise(input: string): string {
  const cleaned = toWesternDigits(input).replace(/[\s\-().]/g, '').replace(/^00/, '+');
  const parsed = parsePhoneNumberFromString(cleaned, 'SA');
  if (!parsed || parsed.country !== 'SA' || !parsed.isValid() || parsed.getType() !== 'MOBILE') {
    throw new DomainError('phone_invalid', 422);
  }
  return parsed.number;
}

/** Masked form for logs and message_delivery rows: +9665•••••123. */
export function mask(e164: string): string {
  return e164.slice(0, 5) + '•'.repeat(Math.max(0, e164.length - 8)) + e164.slice(-3);
}

/**
 * Portal/API variant: same accepted inputs, but returns null instead of throwing and does not
 * need libphonenumber's metadata (K-4). Saudi mobiles only: +9665XXXXXXXX.
 */
export function normaliseSaudiMobile(input: string): string | null {
  let s = toWesternDigits(input).replace(/[\s\-().‎‏]/g, '');
  if (s.startsWith('+')) s = s.slice(1);
  else if (s.startsWith('00')) s = s.slice(2);
  if (!/^\d+$/.test(s)) return null;
  if (s.startsWith('966')) s = s.slice(3);
  if (s.startsWith('0')) s = s.slice(1);
  return /^5\d{8}$/.test(s) ? `+966${s}` : null;
}

/** +966512345678 → +9665*****678 (ASCII mask for logs and the portal). */
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
