import { isVersionBelow, mustUpdate } from '@/lib/config';
import { htmlToBlocks } from '@/lib/html';

jest.mock('expo-constants', () => ({ expoConfig: { version: '1.0.0', extra: {} } }));

describe('legal HTML → blocks', () => {
  it('keeps headings, paragraphs and list items, strips tags and scripts', () => {
    const html = '<h1>Privacy</h1><p>We &amp; you</p><ul><li>One</li><li><b>Two</b></li></ul><script>alert(1)</script>';
    expect(htmlToBlocks(html)).toEqual([
      { text: 'Privacy', heading: true, bullet: false },
      { text: 'We & you', heading: false, bullet: false },
      { text: 'One', heading: false, bullet: true },
      { text: 'Two', heading: false, bullet: true },
    ]);
  });
  it('falls back to plain text', () => {
    expect(htmlToBlocks('plain <i>text</i>')).toEqual([{ text: 'plain text' }]);
  });
});

describe('minimum version (M-01)', () => {
  it('compares semver-ish strings', () => {
    expect(isVersionBelow('1.0.0', '1.0.1')).toBe(true);
    expect(isVersionBelow('1.2.0', '1.10.0')).toBe(true);
    expect(isVersionBelow('2.0', '1.9.9')).toBe(false);
    expect(isVersionBelow('1.0.0', '1.0.0')).toBe(false);
  });
});

describe('minimum version from GET /app/v1/meta (contract v1.1)', () => {
  const meta = { minSupportedVersion: { ios: '1.2.0', android: '1.0.0' } };
  it('uses the per-platform minimum', () => {
    expect(mustUpdate('1.1.0', 'ios', meta)).toBe(true);
    expect(mustUpdate('1.1.0', 'android', meta)).toBe(false);
  });
  it('falls back to the build-time minimum when meta is unavailable', () => {
    expect(mustUpdate('1.0.0', 'ios', null, '1.0.1')).toBe(true);
    expect(mustUpdate('1.0.1', 'android', null, '1.0.1')).toBe(false);
  });
});
