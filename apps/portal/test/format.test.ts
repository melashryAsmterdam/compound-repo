import { describe, expect, it } from 'vitest';
import { hijriOf } from '../lib/format';

describe('hijriOf (QA-09)', () => {
  it('gives the Umm al-Qura date for a picked day', () => {
    expect(hijriOf('2026-11-02', 'ar')).toBe('22 جمادى الأولى 1448 هـ');
    expect(hijriOf('2026-11-02', 'en')).toBe('Jumada I 22, 1448 AH');
  });
  it('is empty for no or partial input', () => {
    expect(hijriOf('', 'ar')).toBe('');
    expect(hijriOf('2026-11', 'en')).toBe('');
  });
});
