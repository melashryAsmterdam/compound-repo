import {
  IBMPlexSansArabic_400Regular, IBMPlexSansArabic_500Medium, IBMPlexSansArabic_600SemiBold, IBMPlexSansArabic_700Bold, useFonts,
} from '@expo-google-fonts/ibm-plex-sans-arabic';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import * as Notifications from 'expo-notifications';
import { router, Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AppState } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ToastProvider } from '@/components/Toast';
import { ApiError } from '@/lib/api';
import { i18n } from '@/lib/i18n';
import { hrefFor, parseLink } from '@/lib/links';
import '@/lib/network';
import { ackReceived, notificationData } from '@/lib/push';
import { applyDirection, SessionProvider, useSession } from '@/lib/session';
import { readPrefs } from '@/lib/storage';
import { colors, fonts } from '@/lib/theme';

void SplashScreen.preventAutoHideAsync();

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      gcTime: 24 * 3600 * 1000,
      retry: (n, e) => !(e instanceof ApiError && e.status >= 400 && e.status < 500) && n < 2,
      networkMode: 'offlineFirst',
    },
    mutations: { networkMode: 'online' },
  },
});

const LOCK_AFTER_MS = 5 * 60 * 1000;

export default function RootLayout() {
  const [fontsLoaded] = useFonts({ IBMPlexSansArabic_400Regular, IBMPlexSansArabic_500Medium, IBMPlexSansArabic_600SemiBold, IBMPlexSansArabic_700Bold });
  const [localeReady, setLocaleReady] = useState(false);

  useEffect(() => {
    void (async () => {
      const { locale } = await readPrefs();
      const l = locale ?? 'ar';
      await i18n.changeLanguage(l);
      // First launch defaults to Arabic: flip the native layout to RTL once (reloads if needed).
      if (applyDirection(l)) return;
      setLocaleReady(true);
    })();
  }, []);

  useEffect(() => {
    if (fontsLoaded && localeReady) void SplashScreen.hideAsync();
  }, [fontsLoaded, localeReady]);

  if (!fontsLoaded || !localeReady) return null;

  return (
    <SafeAreaProvider>
      <QueryClientProvider client={queryClient}>
        <SessionProvider>
          <ToastProvider>
            <AppEffects />
            <StatusBar style="dark" />
            <Navigator />
          </ToastProvider>
        </SessionProvider>
      </QueryClientProvider>
    </SafeAreaProvider>
  );
}

function Navigator() {
  const { t } = useTranslation();
  const header = {
    headerTitleStyle: { fontFamily: fonts.bold, color: colors.ink },
    headerStyle: { backgroundColor: colors.surface },
    headerTintColor: colors.accent,
    headerBackButtonDisplayMode: 'minimal' as const,
    contentStyle: { backgroundColor: colors.bg },
  };
  return (
    <Stack screenOptions={header}>
      <Stack.Screen name="index" options={{ headerShown: false }} />
      <Stack.Screen name="language" options={{ headerShown: false }} />
      <Stack.Screen name="sign-in" options={{ title: t('signIn.title'), headerShown: false }} />
      <Stack.Screen name="a/[token]" options={{ title: '' }} />
      <Stack.Screen name="otp" options={{ title: t('otp.title') }} />
      <Stack.Screen name="consent" options={{ title: t('consent.title') }} />
      <Stack.Screen name="push-primer" options={{ headerShown: false, gestureEnabled: false }} />
      <Stack.Screen name="biometric-setup" options={{ headerShown: false, gestureEnabled: false }} />
      <Stack.Screen name="lock" options={{ headerShown: false, gestureEnabled: false, animation: 'fade' }} />
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen name="requests/new" options={{ headerShown: false, presentation: 'fullScreenModal' }} />
      <Stack.Screen name="requests/[id]" options={{ title: '' }} />
      <Stack.Screen name="reopen/[id]" options={{ title: t('reopen.title'), presentation: 'modal' }} />
      <Stack.Screen name="photos" options={{ headerShown: false, presentation: 'fullScreenModal', animation: 'fade' }} />
      <Stack.Screen name="announcements/[id]" options={{ title: t('announcements.title') }} />
      <Stack.Screen name="notifications" options={{ title: t('notifications.title') }} />
      <Stack.Screen name="unit-switcher" options={{ title: t('units.title'), presentation: 'formSheet', sheetAllowedDetents: [0.5, 1] }} />
      <Stack.Screen name="contact" options={{ title: t('contact.title'), presentation: 'formSheet', sheetAllowedDetents: [0.4] }} />
      <Stack.Screen name="privacy" options={{ title: t('privacy.title') }} />
      <Stack.Screen name="legal/[doc]" options={{ title: '' }} />
      <Stack.Screen name="revoked" options={{ headerShown: false, gestureEnabled: false }} />
      <Stack.Screen name="update-required" options={{ headerShown: false, gestureEnabled: false }} />
    </Stack>
  );
}

/** Push taps, receipt acks, revoke routing and the 5-minute biometric re-lock (M-09). */
function AppEffects() {
  const { api, status, revoked } = useSession();
  const backgroundAt = useRef<number | null>(null);

  useEffect(() => {
    const received = Notifications.addNotificationReceivedListener((n) => {
      void ackReceived(api, notificationData(n).notificationId);
      void queryClient.invalidateQueries({ queryKey: ['notifications'] });
    });
    const tapped = Notifications.addNotificationResponseReceivedListener((r) => {
      const { notificationId, deepLink } = notificationData(r.notification);
      void ackReceived(api, notificationId);
      if (notificationId) {
        void api.client.POST('/app/v1/notifications/{notificationId}/read', { params: { path: { notificationId } } }).catch(() => undefined);
      }
      const href = hrefFor(parseLink(deepLink));
      if (href && status === 'signedIn') router.push(href as never);
    });
    return () => {
      received.remove();
      tapped.remove();
    };
  }, [api, status]);

  useEffect(() => {
    if (revoked && status === 'signedOut') router.replace('/revoked');
  }, [revoked, status]);

  useEffect(() => {
    const sub = AppState.addEventListener('change', async (s) => {
      if (s === 'background') backgroundAt.current = Date.now();
      if (s === 'active' && backgroundAt.current && status === 'signedIn') {
        const away = Date.now() - backgroundAt.current;
        backgroundAt.current = null;
        if (away > LOCK_AFTER_MS && (await readPrefs()).biometric) router.push('/lock');
      }
    });
    return () => sub.remove();
  }, [status]);

  return null;
}
