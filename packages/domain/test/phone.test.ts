import { describe, expect, it } from 'vitest';
import { mask, normalise, toWesternDigits } from '../src/index.js';

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
