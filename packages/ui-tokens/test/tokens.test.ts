import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { color, contrastRatio, cssVariables, source, toCss, tokens, TOKENS_VERSION } from '../src/index.js';

const json = JSON.parse(readFileSync(new URL('../saha-ui-tokens-v0.1.2.json', import.meta.url), 'utf8'));

describe('ui-tokens', () => {
  it('mirrors the Saha v0.1.2 JSON exactly', () => {
    expect(json.$version).toBe(`${TOKENS_VERSION}-proposal`);
    expect(JSON.parse(JSON.stringify(source.color))).toEqual(json.color);
    for (const key of ['font', 'space', 'radius', 'elevation', 'touchTarget', 'pattern'] as const) {
      expect(JSON.parse(JSON.stringify(source[key]))).toEqual(json[key]);
    }
    expect(source.brand.name).toEqual(json.brand.name);
    expect(source.brand.mark).toBe(json.brand.mark);
  });

  it('resolves every reference to a colour', () => {
    const values = [...Object.values(color.semantic), ...Object.values(color.status).flatMap((s) => Object.values(s))];
    for (const v of values) expect(v).toMatch(/^(#[0-9A-F]{6}|transparent)$/);
    expect(color.semantic.primary).toBe('#006C35');
    expect(color.status.new).toEqual({ fg: '#1F5FA8', bg: '#E7EFF9' });
    expect(color.status.done.border).toBe('#006C35');
  });

  it('matches the documented contrast on white', () => {
    const named: Record<string, string> = {
      'green.600': color.green[600], 'green.700': color.green[700], 'green.800': color.green[800],
      text: color.neutral.text, textMuted: color.neutral.textMuted, textFaint: color.neutral.textFaint, gold: color.accent.gold,
    };
    for (const [k, documented] of Object.entries(json.contrastOnWhite as Record<string, number>)) {
      expect(Math.abs(contrastRatio(named[k]!, '#FFFFFF') - documented), k).toBeLessThanOrEqual(0.05);
    }
  });

  it('keeps every status badge at >= 4.5:1 (rule: all text >= 4.5:1)', () => {
    for (const [status, { fg, bg }] of Object.entries(color.status)) {
      const against = bg === 'transparent' ? '#FFFFFF' : bg;
      expect(contrastRatio(fg, against), status).toBeGreaterThanOrEqual(4.5);
    }
    // v0.1.2: cancelled moved off neutralBg, where textFaint was only 4.42:1.
    expect(contrastRatio(color.neutral.textFaint, color.semantic.neutralBg)).toBeLessThan(4.5);
    expect(color.status.cancelled).toEqual({ fg: '#66726A', bg: '#FFFFFF', border: '#E1E7E3' });
    expect(contrastRatio(color.semantic.primaryInk, color.semantic.primary)).toBeGreaterThanOrEqual(4.5);
  });

  it('exposes CSS variables and a tokens.css that is up to date', () => {
    const vars = cssVariables();
    expect(vars['--saha-primary']).toBe('#006C35');
    expect(vars['--saha-status-in-progress-fg']).toBe('#8A5A00');
    expect(vars['--saha-space-4']).toBe('16px');
    expect(vars['--saha-radius-md']).toBe('12px');
    const onDisk = readFileSync(new URL('../tokens.css', import.meta.url), 'utf8');
    expect(onDisk, 'run pnpm --filter @compound/ui-tokens gen:css').toBe(toCss());
    expect(tokens.version).toBe('0.1.2');
  });
});
