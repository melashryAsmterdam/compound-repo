import { Ionicons } from '@expo/vector-icons';
import * as LocalAuthentication from 'expo-local-authentication';
import { router } from 'expo-router';
import { useState } from 'react';
import { useBiometricKind } from '@/lib/biometric';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { Screen } from '@/components/Screen';
import { useToast } from '@/components/Toast';
import { Button, Text } from '@/components/ui';
import { writePrefs } from '@/lib/storage';
import { colors, space } from '@/lib/theme';

/** M-08 Biometric unlock setup (optional, R1-AC5). */
export default function BiometricSetup() {
  const { t } = useTranslation();
  const toast = useToast();
  const { kind } = useBiometricKind();
  const [error, setError] = useState<string | null>(null);

  const finish = () => {
    router.replace('/(tabs)');
    toast(t('push.welcome'));
  };

  return (
    <Screen edges={['top', 'bottom']} contentStyle={{ flexGrow: 1, justifyContent: 'center' }}>
      <View style={{ alignItems: 'center', gap: space.lg }}>
        <Ionicons name={kind === 'face' ? 'scan-outline' : 'finger-print-outline'} size={96} color={colors.accent} />
        <Text variant="title" style={{ textAlign: 'center' }}>{kind === 'face' ? t('biometric.setupTitleFace') : t('biometric.setupTitleFinger')}</Text>
        <Text color={colors.muted} style={{ textAlign: 'center' }}>{t('biometric.setupBody')}</Text>
      </View>
      {error ? <Text color={colors.danger}>{error}</Text> : null}
      <Button
        title={t('biometric.turnOn')}
        onPress={async () => {
          const r = await LocalAuthentication.authenticateAsync({ promptMessage: t('biometric.prompt') });
          if (r.success) {
            await writePrefs({ biometric: true });
            finish();
          } else setError(t('biometric.setupFailed'));
        }}
      />
      <Button kind="ghost" title={t('biometric.skip')} onPress={finish} />
    </Screen>
  );
}
