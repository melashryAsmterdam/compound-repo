import { hrefFor, parseLink, tokenFromReferrer } from '@/lib/links';
import { localPart, maskEmail, maskPhone, otpDigits, parseEmail, parseSaudiMobile } from '@/lib/phone';

const TOKEN = 'abcdefghijABCDEFGHIJ0123456789_-abcdefghijk';

describe('Saudi mobile input (K-4)', () => {
  it.each(['0551234567', '551234567', '+966551234567', '00966551234567', '٠٥٥١٢٣٤٥٦٧', '055 123 4567'])('%s → E.164', (v) => {
    expect(parseSaudiMobile(v)).toBe('+966551234567');
  });
  it.each(['0112345678', '12345', '+971501234567', ''])('rejects %s', (v) => {
    expect(parseSaudiMobile(v)).toBeNull();
  });
  it('local part and masking', () => {
    expect(localPart('+966551234567')).toBe('551234567');
    expect(maskPhone('+966551234567')).toBe('+9665*****567');
    expect(maskEmail('noura@example.sa')).toBe('n****@example.sa');
  });
  it('emails are lower-cased and validated', () => {
    expect(parseEmail(' Noura@Example.SA ')).toBe('noura@example.sa');
    expect(parseEmail('nope')).toBeNull();
  });
  it('OTP accepts paste and Arabic-Indic digits', () => {
    expect(otpDigits('١٢٣ 456')).toBe('123456');
    expect(otpDigits('code: 9876543')).toBe('987654');
  });
});

describe('deep links', () => {
  it('parses compoundapp:// (v1.1) and legacy compound://', () => {
    expect(parseLink('compound://requests/abc')).toEqual({ kind: 'request', id: 'abc' });
    expect(parseLink('compoundapp://announcements/x1')).toEqual({ kind: 'announcement', id: 'x1' });
    expect(parseLink('compound://notifications')).toEqual({ kind: 'notifications' });
    expect(parseLink(`https://go.compound.example.sa/a/${TOKEN}`)).toEqual({ kind: 'activation', token: TOKEN });
    expect(parseLink('https://go.compound.example.sa/a/short')).toEqual({ kind: 'unknown' });
    expect(parseLink(undefined)).toEqual({ kind: 'unknown' });
  });
  it('maps to routes', () => {
    expect(hrefFor({ kind: 'request', id: 'abc' })).toBe('/requests/abc');
    expect(hrefFor({ kind: 'announcement', id: 'a' })).toBe('/announcements/a');
    expect(hrefFor({ kind: 'notifications' })).toBe('/notifications');
    expect(hrefFor({ kind: 'activation', token: TOKEN })).toBe(`/a/${TOKEN}`);
    expect(hrefFor({ kind: 'unknown' })).toBeNull();
  });
  it('reads the token from the Play install referrer (ADR-009)', () => {
    expect(tokenFromReferrer(`activation_token=${TOKEN}&utm_source=invite`)).toBe(TOKEN);
    expect(tokenFromReferrer(`token=${TOKEN}`)).toBe(TOKEN);
    expect(tokenFromReferrer('utm_source=google-play')).toBeNull();
    expect(tokenFromReferrer(null)).toBeNull();
  });
});
