/// <reference types="node" />
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { screen } from '@testing-library/react-native';
import { color, font } from '@compound/ui-tokens';
import { StatusChip } from '@/components/ui';
import SignIn from '@/app/sign-in';
import Settings from '@/app/(tabs)/settings';
import { colors, lineHeightFor, statusColors, type } from '@/lib/theme';
import { json, mockFetch, renderScreen } from './render';

const SRC = join(process.cwd(), 'src');
const files = (dir: string): string[] =>
  readdirSync(dir).flatMap((f: string) => (statSync(join(dir, f)).isDirectory() ? files(join(dir, f)) : [join(dir, f)]));

describe('Saha tokens are the only source of visual values', () => {
  it('no colour literals or raw font sizes outside the theme bridge', () => {
    const offenders = files(SRC)
      .filter((f) => !f.includes(join('lib', 'theme')))
      .flatMap((f) => readFileSync(f, 'utf8').split('\n').map((l: string, i: number) => [f, i + 1, l] as const))
      .filter(([, , l]) => /['"]#[0-9A-Fa-f]{3,8}['"]|rgba?\(|fontSize:\s*\d|fontFamily:\s*['"]/.test(l))
      .map(([f, n]) => `${f.replace(SRC, 'src')}:${n}`);
    expect(offenders).toEqual([]);
  });

  it('theme colours come from packages/ui-tokens', () => {
    expect(colors.accent).toBe(color.semantic.primary);
    expect(colors.header).toBe(color.semantic.header);
    expect(colors.visitCard).toBe(color.accent.sand);
    expect(statusColors.reopened).toEqual(color.status.reopened);
  });

  it('Arabic line height is 1.6, Latin 1.5', () => {
    expect(font.lineHeight.arabic).toBe(1.6);
    expect(lineHeightFor(20, true)).toBe(32);
    expect(lineHeightFor(20, false)).toBe(30);
    expect(type.body.fontSize).toBe(font.size.bodyLarge);
  });
});

describe('status chips (spec §1.3)', () => {
  const flat = (s: unknown) => Object.assign({}, ...([s].flat(Infinity) as object[]));
  it.each(['new', 'in_progress', 'closed', 'cancelled'] as const)('%s uses its token colours', async (tone) => {
    await renderScreen(<StatusChip chip={{ key: `status.${tone}`, tone }} />, { fetch: mockFetch({}).fetch });
    expect(flat(screen.getByTestId(`chip-${tone}`).props.style).backgroundColor).toBe(color.status[tone].bg);
  });
  it('done is an outline; reopened is a red badge with an icon; awaiting has a dot', async () => {
    await renderScreen(
      <>
        <StatusChip chip={{ key: 'status.done', tone: 'done' }} />
        <StatusChip chip={{ key: 'status.reopened', params: { count: 2 }, tone: 'reopened' }} />
        <StatusChip chip={{ key: 'status.awaiting', tone: 'awaiting' }} />
      </>,
      { fetch: mockFetch({}).fetch },
    );
    expect(flat(screen.getByTestId('chip-done').props.style).borderColor).toBe(color.status.done.border);
    expect(flat(screen.getByTestId('chip-reopened').props.style).backgroundColor).toBe(color.semantic.danger);
    expect(screen.getByText('Reopened ×2')).toBeTruthy();
    expect(screen.getByTestId('chip-awaiting')).toBeTruthy();
  });
});

describe('Saha identity on screen', () => {
  it.each(['en', 'ar'] as const)('M-03 has the green hero with the Saha mark (%s)', async (locale) => {
    await renderScreen(<SignIn />, { fetch: mockFetch({}).fetch, locale });
    expect(flatStyle(screen.getByTestId('signin-hero')).backgroundColor).toBe(color.semantic.header);
    expect(screen.getByLabelText(locale === 'ar' ? 'ساحة' : 'Saha')).toBeTruthy();
  });
  it('Settings footer reads "Saha · Version"', async () => {
    await renderScreen(<Settings />, { fetch: mockFetch({ 'GET /app/v1/me': () => json(200, {}) }).fetch, signedIn: true });
    expect(await screen.findByText(/^Saha · Version /)).toBeTruthy();
  });
});

function flatStyle(node: { props: { style?: unknown } }) {
  return Object.assign({}, ...([node.props.style].flat(Infinity).filter(Boolean) as object[]));
}
