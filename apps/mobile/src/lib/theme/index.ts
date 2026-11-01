import { I18nManager, type TextStyle } from 'react-native';
import { tokens } from './tokens';

/**
 * Thin theme layer: screens and components read semantic names from here, never raw values.
 * Raw values live in ./tokens (to be replaced by packages/ui-tokens). The app shows the
 * compound's own name and logo in its headers (screen spec §1.8).
 */
const c = tokens.color;

export const colors = {
  bg: c.neutral.background,
  surface: c.neutral.white,
  ink: c.neutral.text,
  muted: c.neutral.textMuted,
  line: c.neutral.line,
  accent: c.semantic.primary,
  accentInk: c.semantic.primaryInk,
  accentSoft: c.semantic.primarySoft,
  header: c.semantic.header,
  headerInk: c.semantic.headerInk,
  danger: c.semantic.danger,
  dangerSoft: c.semantic.dangerBg,
  info: c.semantic.info,
  infoSoft: c.semantic.infoBg,
  warning: c.semantic.warning,
  warningSoft: c.semantic.warningBg,
  success: c.semantic.success,
  successSoft: c.semantic.successBg,
  neutralSoft: c.semantic.neutralBg,
  visitCard: c.semantic.visitCard,
  /** Text and icons on dark or coloured fills (badges, toast, offline banner, photo viewer). */
  onDark: c.neutral.white,
  toast: c.semantic.toast,
  /** Full-screen photo viewer backdrop and shadows. */
  scrim: c.semantic.scrim,
};

const s = tokens.space;
export const space = { xs: s[1], sm: s[2], md: s[3], lg: s[4], xl: s[6], xxl: s[8] };
export const radius = tokens.radius;
export const MIN_TOUCH = tokens.touchTarget.mobileMin;
export const fonts = tokens.font.family;

/** Arabic needs taller lines than Latin (tokens: 1.6 vs 1.5). */
export function lineHeightFor(fontSize: number, rtl: boolean = I18nManager.isRTL): number {
  return Math.round(fontSize * (rtl ? tokens.font.lineHeight.arabic : tokens.font.lineHeight.latin));
}

const size = tokens.font.size;
const style = (fontSize: number, fontFamily: string): TextStyle => ({ fontSize, lineHeight: lineHeightFor(fontSize), fontFamily });

/** Text variants. Built once at start; the app reloads when the direction changes, so RTL is stable. */
export const type = {
  display: style(size.display, fonts.bold),
  title: style(size.title, fonts.bold),
  heading: style(size.section, fonts.bold),
  body: style(size.body, fonts.regular),
  label: style(size.label, fonts.medium),
  small: style(size.small, fonts.regular),
  caption: style(size.caption, fonts.medium),
  micro: style(size.micro, fonts.medium),
};

export const shadow = { shadowColor: colors.scrim, shadowOpacity: 0.2, shadowRadius: 6, shadowOffset: { width: 0, height: 2 }, elevation: 4 };
