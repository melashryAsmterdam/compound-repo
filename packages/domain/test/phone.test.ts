import { describe, expect, it } from 'vitest';
import { mask, maskEmail, normalise, normaliseSaudiMobile, toWesternDigits } from '../src/index.js';

describe('normalise', () => {
  it.each([
    '0512345678',
    '512345678',
    '+966512345678',
    '00966512345678',
    '+966 51 234 5678',
    '051-234-5678',
    '٠٥١٢٣٤٥٦٧٨',
    '۰۵۱۲۳۴۵۶۷۸',
  ])('%s → +966512345678', (input) => {
    expect(normalise(input)).toBe('+966512345678');
  });

  it.each(['0112345678' /* Riyadh landline */, '+201001234567' /* Egypt */, '123', 'abc'])(
    'rejects %s',
    (input) => {
      expect(() => normalise(input)).toThrow('phone_invalid');
    },
  );
});

describe('helpers', () => {
  it('toWesternDigits', () => expect(toWesternDigits('ب-١٤ و ۲')).toBe('ب-14 و 2'));
  it('mask', () => expect(mask('+966512345678')).toBe('+9665•••••678'));
});

describe('normaliseSaudiMobile', () => {
  it('returns E.164 for a valid mobile and null otherwise', () => {
    expect(normaliseSaudiMobile('٠٥١٢٣٤٥٦٧٨')).toBe('+966512345678');
    expect(normaliseSaudiMobile('0112345678')).toBeNull();
    expect(normaliseSaudiMobile('abc')).toBeNull();
  });
});

describe('maskEmail', () => {
  it('keeps the first letter and the domain', () => {
    expect(maskEmail('noura@gmail.com')).toBe('n***@gmail.com');
    expect(maskEmail('@x')).toBe('***');
  });
});

// QA-01: the mobile app imports these three; removing any of them breaks resident sign-in.
describe('exports the mobile app depends on', () => {
  it('keeps mask, normalise and toWesternDigits', async () => {
    const domain = await import('../src/index.js');
    for (const name of ['mask', 'normalise', 'toWesternDigits']) expect(typeof (domain as Record<string, unknown>)[name]).toBe('function');
  });
});
