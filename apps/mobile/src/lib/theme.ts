/**
 * Neutral placeholder tokens until packages/ui-tokens exists (screen spec §1.8). The app shows the
 * compound's own name and logo; it never carries the vendor brand.
 */
export const colors = {
  bg: '#F6F7F7',
  surface: '#FFFFFF',
  ink: '#1B1F1F',
  muted: '#5C6666',
  line: '#DDE2E2',
  accent: '#0F5E59',
  accentInk: '#FFFFFF',
  accentSoft: '#E3F0EE',
  danger: '#B42318',
  dangerSoft: '#FDECEA',
  info: '#1D4ED8',
  infoSoft: '#E6EEFD',
  warning: '#8A5300',
  warningSoft: '#FDF1DC',
  success: '#146C2E',
  successSoft: '#E5F4EA',
  neutralSoft: '#ECEEEE',
};

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 };
export const radius = { sm: 6, md: 10, lg: 14, pill: 999 };
export const MIN_TOUCH = 44;

export const fonts = {
  regular: 'IBMPlexSansArabic_400Regular',
  medium: 'IBMPlexSansArabic_500Medium',
  bold: 'IBMPlexSansArabic_700Bold',
};

export const type = {
  title: { fontSize: 22, lineHeight: 34, fontFamily: fonts.bold },
  heading: { fontSize: 18, lineHeight: 28, fontFamily: fonts.bold },
  body: { fontSize: 16, lineHeight: 24, fontFamily: fonts.regular },
  label: { fontSize: 14, lineHeight: 22, fontFamily: fonts.medium },
  small: { fontSize: 13, lineHeight: 20, fontFamily: fonts.regular },
};
