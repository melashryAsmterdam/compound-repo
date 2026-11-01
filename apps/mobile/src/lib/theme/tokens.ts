import { color, font, radius, space, touchTarget } from '@compound/ui-tokens';

/**
 * The app's single bridge to packages/ui-tokens (Saha v0.1.1). Everything visual in the app comes
 * through here and ./index.ts; no other file holds a colour, size or font value.
 */
export { color, radius, space, touchTarget };

export const fontFamily = {
  // Expo font names for the weights packages/ui-tokens defines (family: IBM Plex Sans Arabic).
  regular: 'IBMPlexSansArabic_400Regular',
  medium: 'IBMPlexSansArabic_500Medium',
  semibold: 'IBMPlexSansArabic_600SemiBold',
  bold: 'IBMPlexSansArabic_700Bold',
} as const;

export const fontSize = font.size;
export const lineHeightRatio = { arabic: font.lineHeight.arabic, latin: font.lineHeight.latin };
