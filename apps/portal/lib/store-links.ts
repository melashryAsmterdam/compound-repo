/** Store links on the W-01 invite page. */
export const DEFAULT_PLAY_STORE_URL = 'https://play.google.com/store/apps/details?id=sa.compound.app';
export const DEFAULT_APP_STORE_URL = 'https://apps.apple.com/';

/**
 * Google Play link that carries the invite through install (ADR-009, QA-05): the app reads
 * `activation_token` from the Play Install Referrer and continues activation after first launch.
 */
export function playStoreLink(token: string, base = process.env.PLAY_STORE_URL || DEFAULT_PLAY_STORE_URL): string {
  const url = new URL(base);
  url.searchParams.set('referrer', `activation_token=${token}`);
  return url.toString();
}
