import { I18nManager, type TextStyle } from 'react-native';
import { color, fontFamily, fontSize, lineHeightRatio, radius as r, space as s, touchTarget } from './tokens';

/**
 * Thin theme layer over packages/ui-tokens: screens read semantic names from here, never raw values.
 * The compound's own name and logo own the in-app header; the Saha mark is on the icon, splash and
 * sign-in only (spec §1.8, tokens brand rules).
 */
const n = color.neutral;
const m = color.semantic;

export const colors = {
  bg: n.background,
  surface: n.white,
  ink: n.text,
  muted: n.textMuted,
  faint: n.textFaint,
  line: n.line,
  accent: m.primary,
  accentPressed: m.primaryHover,
  accentInk: m.primaryInk,
  accentSoft: m.primarySoft,
  disabled: m.disabled,
  header: m.header,
  headerInk: n.white,
  headerMuted: color.green['100'],
  danger: m.danger,
  dangerSoft: m.dangerBg,
  info: m.info,
  infoSoft: m.infoBg,
  warning: m.warning,
  warningSoft: m.warningBg,
  success: m.success,
  successSoft: m.successBg,
  neutral: m.neutral,
  neutralSoft: m.neutralBg,
  visitCard: m.visitCard,
  visitLine: color.green['200'],
  decision: color.green['50'],
  decisionLine: color.green['200'],
  gold: color.accent.gold,
  markDot: color.accent.goldMark,
  /** Text and icons on dark or coloured fills (badges, toast, offline banner, photo viewer). */
  onDark: n.white,
  toast: n.text,
  /** Full-screen photo viewer backdrop and shadows. */
  scrim: n.text,
};

/** Request status chips and the reopened badge (spec §1.3 → tokens color.status). */
export const statusColors = color.status;

export const space = { xs: s[1], sm: s[2], md: s[3], lg: s[4], xl: s[6], xxl: s[8] };
export const radius = r;
export const MIN_TOUCH = touchTarget.mobileMin;
export const fonts = fontFamily;

/** Arabic needs taller lines than Latin (tokens: 1.6 vs 1.5). */
export function lineHeightFor(size: number, rtl: boolean = I18nManager.isRTL): number {
  return Math.round(size * (rtl ? lineHeightRatio.arabic : lineHeightRatio.latin));
}

const style = (size: number, fontFamily: string): TextStyle => ({ fontSize: size, lineHeight: lineHeightFor(size), fontFamily });

/** Text variants. Built once at start; the app reloads when the direction changes, so RTL is stable. */
export const type = {
  display: style(fontSize.display, fonts.bold),
  title: style(fontSize.title, fonts.bold),
  heading: style(fontSize.section, fonts.bold),
  body: style(fontSize.bodyLarge, fonts.regular),
  label: style(fontSize.body, fonts.semibold),
  small: style(fontSize.body, fonts.regular),
  caption: style(fontSize.caption, fonts.semibold),
  micro: style(fontSize.caption, fonts.semibold),
};

export const shadow = { shadowColor: colors.scrim, shadowOpacity: 0.18, shadowRadius: 8, shadowOffset: { width: 0, height: 4 }, elevation: 4 };

/** Header pattern (tokens.pattern): tile size and stroke opacity on green. */
export { pattern } from '@compound/ui-tokens';
