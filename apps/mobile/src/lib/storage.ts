import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';
import type { TokenStore } from './api';
import type { Locale } from './i18n/types';

/** Refresh token and installation id in Keychain / Keystore (05-auth: WHEN_UNLOCKED_THIS_DEVICE_ONLY). */
const SECURE_OPTS: SecureStore.SecureStoreOptions = { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY };
const K_REFRESH = 'cs.refreshToken';
const K_INSTALL = 'cs.installationId';

export const secureTokenStore: TokenStore = {
  getRefreshToken: () => SecureStore.getItemAsync(K_REFRESH, SECURE_OPTS),
  setRefreshToken: async (t) => {
    if (t) await SecureStore.setItemAsync(K_REFRESH, t, SECURE_OPTS);
    else await SecureStore.deleteItemAsync(K_REFRESH, SECURE_OPTS);
  },
};

export async function installationId(): Promise<string> {
  const existing = await SecureStore.getItemAsync(K_INSTALL, SECURE_OPTS);
  if (existing) return existing;
  const id = Crypto.randomUUID();
  await SecureStore.setItemAsync(K_INSTALL, id, SECURE_OPTS);
  return id;
}

/** Non-secret preferences. */
export interface Prefs {
  locale?: Locale;
  unitId?: string;
  biometric?: boolean;
  pushReminderDismissals?: number;
  lastIdentifier?: string;
}
const K_PREFS = 'cs.prefs';

export async function readPrefs(): Promise<Prefs> {
  try {
    return JSON.parse((await AsyncStorage.getItem(K_PREFS)) ?? '{}') as Prefs;
  } catch {
    return {};
  }
}

export async function writePrefs(patch: Partial<Prefs>): Promise<Prefs> {
  const next = { ...(await readPrefs()), ...patch };
  await AsyncStorage.setItem(K_PREFS, JSON.stringify(next));
  return next;
}

/** Sign-out clears everything personal: tokens, drafts, cached queries; keeps language and install id. */
export async function clearPersonalData(): Promise<void> {
  await secureTokenStore.setRefreshToken(null);
  const keys = await AsyncStorage.getAllKeys();
  await AsyncStorage.multiRemove(keys.filter((k) => k.startsWith('cs.draft.') || k === 'cs.queryCache'));
  const { locale } = await readPrefs();
  await AsyncStorage.setItem(K_PREFS, JSON.stringify(locale ? { locale } : {}));
}
