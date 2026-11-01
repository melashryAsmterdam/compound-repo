import Constants from 'expo-constants';

/** API base URL per EAS profile (development / preview / production) via EXPO_PUBLIC_API_URL. */
export const API_URL = (process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:4000').replace(/\/$/, '');

export const APP_VERSION: string = Constants.expoConfig?.version ?? '0.0.0';

/** M-01 step 1. Source of truth is still open with the Architect (screen spec §9: min app version source). */
export const MIN_SUPPORTED_VERSION: string =
  (Constants.expoConfig?.extra as { minSupportedVersion?: string } | undefined)?.minSupportedVersion ?? '0.0.0';

export function isVersionBelow(version: string, min: string): boolean {
  const a = version.split('.').map((n) => Number.parseInt(n, 10) || 0);
  const b = min.split('.').map((n) => Number.parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    if (x !== y) return x < y;
  }
  return false;
}
