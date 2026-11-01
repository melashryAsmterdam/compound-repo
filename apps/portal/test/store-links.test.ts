import { describe, expect, it } from 'vitest';
import { playStoreLink } from '../lib/store-links';

describe('playStoreLink (QA-05, ADR-009)', () => {
  const token = 'aB3_-xYz'.padEnd(43, 'q');
  it('adds referrer=activation_token%3D<token>', () => {
    expect(playStoreLink(token)).toBe(`https://play.google.com/store/apps/details?id=sa.compound.app&referrer=activation_token%3D${token}`);
  });
  it('keeps a configured listing URL', () => {
    const u = new URL(playStoreLink(token, 'https://play.google.com/store/apps/details?id=sa.compound.app.preview&hl=ar'));
    expect(u.searchParams.get('id')).toBe('sa.compound.app.preview');
    expect(u.searchParams.get('hl')).toBe('ar');
    expect(u.searchParams.get('referrer')).toBe(`activation_token=${token}`);
  });
});
