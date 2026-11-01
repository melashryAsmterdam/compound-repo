import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { Linking, Platform } from 'react-native';
import type { ResidentApi } from './api';
import { APP_VERSION } from './config';
import { currentLocale } from './i18n';

export type PushPermission = 'granted' | 'denied' | 'undetermined';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
  }),
});

export async function pushPermission(): Promise<PushPermission> {
  const p = await Notifications.getPermissionsAsync();
  if (p.granted) return 'granted';
  return p.canAskAgain ? 'undetermined' : 'denied';
}

/** M-07: ask the OS, then register the device. Returns the resulting permission. */
export async function requestPush(api: ResidentApi): Promise<PushPermission> {
  const current = await pushPermission();
  if (current === 'denied') {
    await Linking.openSettings();
    return current;
  }
  const res = await Notifications.requestPermissionsAsync();
  await registerDevice(api);
  return res.granted ? 'granted' : 'denied';
}

/** PUT /app/v1/devices/current with the native FCM/APNs token (architecture §6) and permission state. */
export async function registerDevice(api: ResidentApi): Promise<void> {
  const granted = (await pushPermission()) === 'granted';
  let pushToken: string | null = null;
  if (granted && Device.isDevice) {
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('default', { name: 'Default', importance: Notifications.AndroidImportance.HIGH });
    }
    try {
      pushToken = (await Notifications.getDevicePushTokenAsync()).data as string;
    } catch {
      pushToken = null;
    }
  }
  await api.client.PUT('/app/v1/devices/current', {
    body: { pushToken, pushEnabled: granted && Boolean(pushToken), locale: currentLocale(), appVersion: APP_VERSION },
  });
}

export function notificationData(n: Notifications.Notification): { notificationId?: string; deepLink?: string } {
  return (n.request.content.data ?? {}) as { notificationId?: string; deepLink?: string };
}

/** Receipt ack cancels the pending SMS fallback on the server (architecture §6). */
export async function ackReceived(api: ResidentApi, notificationId: string | undefined): Promise<void> {
  if (!notificationId) return;
  await api.client
    .POST('/app/v1/notifications/{notificationId}/received', { params: { path: { notificationId } } })
    .catch(() => undefined);
}
