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
