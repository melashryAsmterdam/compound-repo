import { mask, normalise, toWesternDigits } from '@compound/domain';

export { toWesternDigits };

/** Saudi mobile in any accepted form (K-4) → E.164, or null when invalid. */
export function parseSaudiMobile(input: string): string | null {
  try {
    return normalise(input);
  } catch {
    return null;
  }
}

/** E.164 → the local part shown next to the fixed +966 prefix on M-03 ("5XXXXXXXX"). */
export function localPart(e164: string): string {
  return e164.replace(/^\+966/, '');
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
export function parseEmail(input: string): string | null {
  const v = input.trim().toLowerCase();
  return EMAIL.test(v) ? v : null;
}

/** Masked for display outside admin screens (§1.7): +9665*****678. */
export function maskPhone(e164: string | null | undefined): string {
  return e164 ? mask(e164).replace(/•/g, '*') : '';
}

export function maskEmail(email: string | null | undefined): string {
  if (!email) return '';
  const [user = '', domain = ''] = email.split('@');
  return `${user.slice(0, 1)}${'*'.repeat(Math.max(1, user.length - 1))}@${domain}`;
}

/** Only digits, Western, max 6 — for OTP fields that accept paste and Arabic-Indic digits. */
export function otpDigits(input: string): string {
  return toWesternDigits(input).replace(/\D/g, '').slice(0, 6);
}
