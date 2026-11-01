/**
 * The only file that holds raw design values. It mirrors the shape of packages/ui-tokens
 * (Saha tokens v0.1.1) so that, once that package is on main, this file becomes
 * `export { tokens } from '@compound/ui-tokens'` and nothing else in the app changes.
 * Until then the values are the neutral placeholders the app has always used.
 */
export const tokens = {
  color: {
    neutral: {
      white: '#FFFFFF',
      black: '#000000',
      background: '#F6F7F7',
      line: '#DDE2E2',
      textMuted: '#5C6666',
      text: '#1B1F1F',
    },
    semantic: {
      primary: '#0F5E59',
      primaryInk: '#FFFFFF',
      primarySoft: '#E3F0EE',
      header: '#FFFFFF',
      headerInk: '#1B1F1F',
      info: '#1D4ED8',
      infoBg: '#E6EEFD',
      warning: '#8A5300',
      warningBg: '#FDF1DC',
      success: '#146C2E',
      successBg: '#E5F4EA',
      neutralBg: '#ECEEEE',
      danger: '#B42318',
      dangerBg: '#FDECEA',
      visitCard: '#E3F0EE',
      toast: '#1B1F1F',
      scrim: '#000000',
    },
  },
  font: {
    family: {
      regular: 'IBMPlexSansArabic_400Regular',
      medium: 'IBMPlexSansArabic_500Medium',
      bold: 'IBMPlexSansArabic_700Bold',
    },
    size: { micro: 11, caption: 12, small: 13, label: 14, body: 16, section: 18, title: 22, display: 30 },
    lineHeight: { arabic: 1.6, latin: 1.5 },
  },
  space: { 1: 4, 2: 8, 3: 12, 4: 16, 6: 24, 8: 32 },
  radius: { sm: 6, md: 10, lg: 14, pill: 999 },
  touchTarget: { mobileMin: 44 },
} as const;
