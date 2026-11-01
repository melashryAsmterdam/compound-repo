import Constants from 'expo-constants';

/** API base URL per EAS profile (development / preview / production) via EXPO_PUBLIC_API_URL. */
export const API_URL = (process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:4000').replace(/\/$/, '');

export const APP_VERSION: string = Constants.expoConfig?.version ?? '0.0.0';

type Extra = { minSupportedVersion?: string; brand?: { ar: string; en: string }; storeId?: { android?: string; ios?: string | null } };
const extra = (Constants.expoConfig?.extra ?? {}) as Extra;

/** Product name per language, from app.config.ts (pending trademark clearance — never hard-code it). */
export const BRAND = extra.brand ?? { ar: 'ساحة', en: 'Saha' };

/** Store page for M-27 Update required. */
export function storeUrl(platform: string): string {
  if (platform === 'ios') return extra.storeId?.ios ? `itms-apps://apps.apple.com/app/id${extra.storeId.ios}` : 'itms-apps://apps.apple.com/';
  return `market://details?id=${extra.storeId?.android ?? 'sa.compound.app'}`;
}

/**
 * M-01 step 1. The source of truth is GET /app/v1/meta (contract v1.1); this build-time value is only
 * the fallback when the meta call can't be made (offline first launch).
 */
export const MIN_SUPPORTED_VERSION: string = extra.minSupportedVersion ?? '0.0.0';

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

type Meta = { minSupportedVersion: { ios: string; android: string } };

/** True when this build is below the minimum the API reports for this platform (or the fallback). */
export function mustUpdate(version: string, platform: string, meta: Meta | null | undefined, fallback = MIN_SUPPORTED_VERSION): boolean {
  const min = meta ? (platform === 'ios' ? meta.minSupportedVersion.ios : meta.minSupportedVersion.android) : fallback;
  return isVersionBelow(version, min);
}
