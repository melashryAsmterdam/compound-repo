import { Ionicons } from '@expo/vector-icons';
import * as LocalAuthentication from 'expo-local-authentication';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { Screen } from '@/components/Screen';
import { useToast } from '@/components/Toast';
import { Button, Text } from '@/components/ui';
import { pushPermission, registerDevice, requestPush, type PushPermission } from '@/lib/push';
import { useSession } from '@/lib/session';
import { colors, space } from '@/lib/theme';

/** M-07 Notification permission primer (R1-AC6). */
export default function PushPrimer() {
  const { t } = useTranslation();
  const toast = useToast();
  const { api } = useSession();
  const [perm, setPerm] = useState<PushPermission>('undetermined');
  const { from } = useLocalSearchParams<{ from?: string }>();

  useEffect(() => {
    void pushPermission().then(setPerm);
  }, []);

  async function next() {
    if (from === 'home') return router.back();
    const hasBio = (await LocalAuthentication.hasHardwareAsync()) && (await LocalAuthentication.isEnrolledAsync());
    if (hasBio) router.replace('/biometric-setup');
    else {
      router.replace('/(tabs)');
      toast(t('push.welcome'));
    }
  }

  return (
    <Screen edges={['top', 'bottom']} contentStyle={{ flexGrow: 1, justifyContent: 'center', alignItems: 'stretch' }}>
      <View style={{ alignItems: 'center', gap: space.lg }}>
        <Ionicons name="notifications-circle-outline" size={96} color={colors.accent} />
        <Text variant="title" style={{ textAlign: 'center' }}>{t('push.title')}</Text>
        <Text style={{ textAlign: 'center' }} color={colors.muted}>{t('push.body')}</Text>
      </View>
      <Button
        testID="push-allow"
        title={perm === 'denied' ? t('push.openSettings') : t('push.allow')}
        onPress={async () => {
          await requestPush(api).catch(() => undefined);
          await next();
        }}
      />
      <Button
        kind="ghost"
        title={t('push.notNow')}
        onPress={async () => {
          await registerDevice(api).catch(() => undefined);
          await next();
        }}
      />
    </Screen>
  );
}
