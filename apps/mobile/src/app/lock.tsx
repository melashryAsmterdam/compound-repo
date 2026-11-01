import { Ionicons } from '@expo/vector-icons';
import * as LocalAuthentication from 'expo-local-authentication';
import { router } from 'expo-router';
import { useCallback, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Image, View } from 'react-native';
import { Screen } from '@/components/Screen';
import { Button, Text } from '@/components/ui';
import { useSession } from '@/lib/session';
import { colors, radius, space } from '@/lib/theme';

/** M-09 Biometric lock (cold start, or after 5 minutes in the background). */
export default function Lock() {
  const { t } = useTranslation();
  const { unit, locale, signOut } = useSession();

  const unlock = useCallback(async () => {
    const r = await LocalAuthentication.authenticateAsync({ promptMessage: t('biometric.prompt'), disableDeviceFallback: false });
    if (r.success) {
      if (router.canGoBack()) router.back();
      else router.replace('/(tabs)');
    }
  }, [t]);

  useEffect(() => {
    void unlock();
  }, [unlock]);

  const c = unit?.compound;
  return (
    <Screen edges={['top', 'bottom']} contentStyle={{ flexGrow: 1, justifyContent: 'center' }}>
      <View style={{ alignItems: 'center', gap: space.lg }}>
        {c?.logoUrl ? <Image source={{ uri: c.logoUrl }} style={{ width: 80, height: 80, borderRadius: radius.md }} /> : <Ionicons name="lock-closed-outline" size={80} color={colors.accent} />}
        {c ? <Text variant="heading">{locale === 'ar' ? c.nameAr : c.nameEn}</Text> : null}
      </View>
      <Button icon="finger-print" title={t('biometric.unlock')} onPress={unlock} />
      <Button
        kind="ghost"
        title={t('biometric.useCode')}
        onPress={async () => {
          await signOut();
          router.replace('/sign-in');
        }}
      />
    </Screen>
  );
}
