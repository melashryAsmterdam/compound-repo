/**
 * Saha (ساحة) design tokens v0.1.1, shared by apps/portal and apps/mobile.
 *
 * Source of truth: ../saha-ui-tokens-v0.1.1.json (copied byte-for-byte from the Library,
 * compound-app/design). `source` below mirrors it; a test fails if the two drift. Everything else
 * is derived: `{color.x.y}` references are resolved, and `cssVariables()` / tokens.css give the
 * web the same values as CSS custom properties.
 *
 * Kept in one file with no relative imports so Metro, Next.js and Vitest all consume it from
 * source without a build step.
 */

export const TOKENS_VERSION = '0.1.1';

export const source = {
  color: {
    green: {
      50: '#EAF6EF',
      100: '#D2ECDD',
      200: '#A6D8BB',
      300: '#6FBE91',
      400: '#3A9F67',
      500: '#158249',
      600: '#006C35',
      700: '#005A2C',
      800: '#004722',
      900: '#003318',
    },
    accent: { sand: '#F8F1E1', gold: '#8C6A1F', goldMark: '#C9A85A' },
    neutral: {
      white: '#FFFFFF',
      background: '#F5F8F6',
      line: '#E1E7E3',
      textMuted: '#4F5C55',
      textFaint: '#66726A',
      text: '#14211A',
    },
    semantic: {
      primary: '{color.green.600}',
      primaryHover: '{color.green.700}',
      primaryInk: '#FFFFFF',
      primarySoft: '{color.green.50}',
      header: '{color.green.700}',
      disabled: '{color.green.200}',
      info: '#1F5FA8',
      infoBg: '#E7EFF9',
      warning: '#8A5A00',
      warningBg: '#FDF1D8',
      success: '{color.green.600}',
      successBg: '{color.green.50}',
      neutral: '#4B5563',
      neutralBg: '#EEF1EF',
      danger: '#B42318',
      dangerBg: '#FDE8E6',
      visitCard: '{color.accent.sand}',
    },
    status: {
      new: { fg: '{color.semantic.info}', bg: '{color.semantic.infoBg}' },
      in_progress: { fg: '{color.semantic.warning}', bg: '{color.semantic.warningBg}' },
      done: { fg: '{color.semantic.success}', bg: 'transparent', border: '{color.semantic.success}' },
      closed: { fg: '{color.semantic.neutral}', bg: '{color.semantic.neutralBg}' },
      cancelled: { fg: '{color.neutral.textFaint}', bg: '{color.semantic.neutralBg}' },
      reopened: { fg: '#FFFFFF', bg: '{color.semantic.danger}' },
    },
  },
  font: {
    family: 'IBM Plex Sans Arabic',
    weight: { regular: 400, medium: 500, semibold: 600, bold: 700 },
    size: { caption: 12, body: 14, bodyLarge: 16, section: 18, title: 22, display: 28 },
    lineHeight: { arabic: 1.6, latin: 1.5 },
    letterSpacing: { arabic: 0 },
  },
  space: { 1: 4, 2: 8, 3: 12, 4: 16, 5: 20, 6: 24, 8: 32, 10: 40 },
  radius: { sm: 8, md: 12, lg: 16, xl: 22, pill: 999 },
  elevation: { card: '0 1px 2px rgba(20,33,26,.06)', overlay: '0 12px 32px rgba(20,33,26,.18)' },
  touchTarget: { mobileMin: 44, portalMin: 32 },
  pattern: {
    name: 'Eight-point star lattice (Najdi-inspired)',
    tile: 56,
    opacityOnGreen: 0.13,
    opacityOnWhite: 0.08,
    use: 'Headers, sign-in and splash only; never behind long text.',
  },
  brand: {
    name: { ar: 'ساحة', en: 'Saha' },
    mark: 'Four rounded squares (units) around a central square with a gold dot (#C9A85A) for management; field green.600, figure white. Inverse: white field, green.600 figure.',
  },
} as const;

type Source = typeof source;

function lookup(path: string): string {
  let node: unknown = source;
  for (const key of path.split('.')) {
    if (node === null || typeof node !== 'object' || !(key in node)) {
      throw new Error(`ui-tokens: unknown reference {${path}}`);
    }
    node = (node as Record<string, unknown>)[key];
  }
  if (typeof node !== 'string') throw new Error(`ui-tokens: {${path}} is not a value`);
  return resolveValue(node);
}

/** Resolve a `{a.b.c}` reference (recursively); plain values are returned unchanged. */
export function resolveValue(value: string): string {
  const m = /^\{([^}]+)\}$/.exec(value);
  return m ? lookup(m[1]!) : value;
}

function resolveTree<T>(tree: T): Resolved<T> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(tree as Record<string, unknown>)) {
    out[k] = typeof v === 'string' ? resolveValue(v) : resolveTree(v);
  }
  return out as Resolved<T>;
}

type Resolved<T> = { readonly [K in keyof T]: T[K] extends string ? string : Resolved<T[K]> };

export type RequestStatusKey = keyof Source['color']['status'];

/** Colours with every reference resolved to a hex value (or `transparent`). */
export const color = {
  green: source.color.green,
  accent: source.color.accent,
  neutral: source.color.neutral,
  semantic: resolveTree(source.color.semantic),
  status: resolveTree(source.color.status) as Readonly<
    Record<RequestStatusKey, { readonly fg: string; readonly bg: string; readonly border?: string }>
  >,
};

export const font = source.font;
export const space = source.space;
export const radius = source.radius;
export const elevation = source.elevation;
export const touchTarget = source.touchTarget;
export const pattern = source.pattern;
export const brand = source.brand;

export const tokens = { version: TOKENS_VERSION, color, font, space, radius, elevation, touchTarget, pattern, brand };

const kebab = (s: string) => s.replace(/_/g, '-').replace(/[A-Z]/g, (c) => '-' + c.toLowerCase());
const px = (n: number) => `${n}px`;

/** Every token as a CSS custom property, `--saha-…`. Lengths are in px. */
export function cssVariables(): Record<string, string> {
  const v: Record<string, string> = {};
  for (const [k, hex] of Object.entries(color.green)) v[`--saha-green-${k}`] = hex;
  for (const [k, hex] of Object.entries(color.accent)) v[`--saha-${kebab(k)}`] = hex;
  for (const [k, hex] of Object.entries(color.neutral)) v[`--saha-${kebab(k)}`] = hex;
  for (const [k, hex] of Object.entries(color.semantic)) v[`--saha-${kebab(k)}`] = hex;
  for (const [status, c] of Object.entries(color.status)) {
    for (const [part, hex] of Object.entries(c)) v[`--saha-status-${kebab(status)}-${part}`] = hex;
  }
  v['--saha-font-family'] = `'${font.family}', system-ui, sans-serif`;
  for (const [k, n] of Object.entries(font.weight)) v[`--saha-font-weight-${kebab(k)}`] = String(n);
  for (const [k, n] of Object.entries(font.size)) v[`--saha-font-size-${kebab(k)}`] = px(n);
  for (const [k, n] of Object.entries(font.lineHeight)) v[`--saha-line-height-${kebab(k)}`] = String(n);
  for (const [k, n] of Object.entries(space)) v[`--saha-space-${k}`] = px(n);
  for (const [k, n] of Object.entries(radius)) v[`--saha-radius-${kebab(k)}`] = px(n);
  for (const [k, s] of Object.entries(elevation)) v[`--saha-shadow-${kebab(k)}`] = s;
  v['--saha-touch-min'] = px(touchTarget.portalMin);
  return v;
}

/** The stylesheet written to tokens.css (`pnpm --filter @compound/ui-tokens gen:css`). */
export function toCss(selector = ':root'): string {
  const lines = Object.entries(cssVariables()).map(([k, val]) => `  ${k}: ${val};`);
  return `/* Generated from @compound/ui-tokens v${TOKENS_VERSION}. Do not edit; run gen:css. */\n${selector} {\n${lines.join('\n')}\n}\n`;
}

/** WCAG 2.x contrast ratio between two #RRGGBB colours. */
export function contrastRatio(a: string, b: string): number {
  const lum = (hex: string) => {
    const [r, g, bl] = [1, 3, 5].map((i) => {
      const c = parseInt(hex.slice(i, i + 2), 16) / 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    }) as [number, number, number];
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}
