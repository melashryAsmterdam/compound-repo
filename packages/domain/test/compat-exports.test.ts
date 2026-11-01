import { describe, expect, it } from 'vitest';
import * as domain from '../src/index';
import { availableCommands, DomainError, mask, normalise, toWesternDigits } from '../src/index';

// QA-01 / build review B1: these exports were on main before the portal landed and the
// mobile app (apps/mobile/src/lib/phone.ts) imports some of them. Removing one breaks a consumer.
describe('exports kept from main', () => {
  it.each(['mask', 'normalise', 'toWesternDigits', 'planSmsFallback', 'isQuietHour', 'availableCommands', 'DomainError'])(
    '%s is exported',
    (name) => {
      expect(typeof (domain as Record<string, unknown>)[name]).toBe('function');
    },
  );
});

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

  it.each(['0112345678' /* Riyadh landline */, '+201001234567' /* Egypt */, '123', 'abc'])('rejects %s', (input) => {
    expect(() => normalise(input)).toThrow(DomainError);
    expect(() => normalise(input)).toThrow('phone_invalid');
  });
});

describe('helpers', () => {
  it('toWesternDigits', () => expect(toWesternDigits('ب-١٤ و ۲')).toBe('ب-14 و 2'));
  it('mask', () => expect(mask('+966512345678')).toBe('+9665•••••678'));
  it('DomainError default message is its code', () => {
    const e = new DomainError('x', 400);
    expect(e.message).toBe('x');
    expect(e.status).toBe(400);
  });
});

describe('availableCommands', () => {
  it('admin', () => {
    expect(availableCommands('new', 'admin')).toEqual(['start', 'complete']);
    expect(availableCommands('in_progress', 'admin')).toEqual(['complete']);
    expect(availableCommands('closed', 'admin')).toEqual([]);
  });
  it('resident', () => {
    expect(availableCommands('done', 'resident')).toEqual(['confirm', 'reopen']);
    expect(availableCommands('new', 'resident')).toEqual(['cancel']);
    expect(availableCommands('in_progress', 'resident')).toEqual([]);
  });
  it('system', () => {
    expect(availableCommands('done', 'system')).toEqual(['auto_close']);
    expect(availableCommands('new', 'system')).toEqual([]);
  });
});
