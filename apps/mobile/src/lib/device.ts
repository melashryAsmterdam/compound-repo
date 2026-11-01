import { Platform } from 'react-native';
import { APP_VERSION } from './config';
import { currentLocale } from './i18n';
import { installationId } from './storage';

/** DeviceInput for otp/verify and activation/complete. */
export async function deviceInput() {
  return {
    installationId: await installationId(),
    platform: (Platform.OS === 'ios' ? 'ios' : 'android') as 'ios' | 'android',
    appVersion: APP_VERSION,
    locale: currentLocale(),
  };
}
