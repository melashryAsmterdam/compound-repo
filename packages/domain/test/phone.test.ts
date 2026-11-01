import { describe, expect, it } from 'vitest';
import { maskDestination, maskEmail, maskPhone, normaliseSaudiMobile, toWesternDigits } from '../src';

describe('normaliseSaudiMobile (K-4)', () => {
  it.each([
    ['+966512345678'],
    ['00966512345678'],
    ['966512345678'],
    ['0512345678'],
    ['512345678'],
    ['+966 51 234 5678'],
    ['(051) 234-5678'],
    ['٠٥١٢٣٤٥٦٧٨'],
    ['۰۵۱۲۳۴۵۶۷۸'],
    ['‎+966512345678'],
  ])('%s → +966512345678', (input) => expect(normaliseSaudiMobile(input)).toBe('+966512345678'));

  it.each([['0112345678'], ['+971512345678'], ['05123'], ['05123456789'], ['abc'], [''], ['+9665123x5678']])(
    'rejects %s',
    (input) => expect(normaliseSaudiMobile(input)).toBeNull(),
  );

  it('converts digits', () => expect(toWesternDigits('B-١٤')).toBe('B-14'));
});

describe('masking', () => {
  it('phone', () => {
    expect(maskPhone('+966512345678')).toBe('+9665*****678');
    expect(maskPhone('+12')).toBe('***');
  });
  it('email', () => {
    expect(maskEmail('noura@gmail.com')).toBe('n***@gmail.com');
    expect(maskEmail('@x')).toBe('***');
  });
  it('destination', () => {
    expect(maskDestination('a@b.sa')).toBe('a***@b.sa');
    expect(maskDestination('+966512345678')).toBe('+9665*****678');
  });
});
