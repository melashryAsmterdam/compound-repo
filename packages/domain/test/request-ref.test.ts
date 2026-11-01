import { describe, expect, it } from 'vitest';
import { formatRequestRef, parseRequestRef } from '../src/index.js';

describe('request refs', () => {
  it('formats with five-digit padding', () => {
    expect(formatRequestRef(123)).toBe('REQ-00123');
    expect(formatRequestRef(123456)).toBe('REQ-123456');
  });
  it('parses REQ-, req and bare numbers; rejects anything else', () => {
    expect(parseRequestRef('REQ-00123')).toBe(123);
    expect(parseRequestRef(' req123 ')).toBe(123);
    expect(parseRequestRef('42')).toBe(42);
    expect(parseRequestRef('B-14')).toBeNull();
  });
});
