import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Linking, View } from 'react-native';
import { Screen } from '@/components/Screen';
import { Button, Text } from '@/components/ui';
import { ltr } from '@/lib/format';
import { useSession } from '@/lib/session';
import { colors, space } from '@/lib/theme';

/** M-27 Access revoked. */
export default function Revoked() {
  const { t } = useTranslation();
  const { revoked, clearRevoked } = useSession();
  return (
    <Screen edges={['top', 'bottom']} contentStyle={{ flexGrow: 1, justifyContent: 'center' }}>
      <View style={{ alignItems: 'center', gap: space.lg }}>
        <Ionicons name="lock-closed-outline" size={80} color={colors.muted} />
        <Text variant="title" style={{ textAlign: 'center' }}>{t('system.revokedTitle')}</Text>
        <Text style={{ textAlign: 'center' }} testID="revoked-body">
          {revoked?.unitLabel ? t('system.revokedBody', { unit: ltr(revoked.unitLabel) }) : t('system.revokedBodyGeneric')}
        </Text>
      </View>
      {revoked?.phone ? <Button icon="call" title={t('common.callManagement')} onPress={() => void Linking.openURL(`tel:${revoked.phone}`)} /> : null}
      <Button kind="secondary" title={t('common.ok')} onPress={() => {
        clearRevoked();
        router.replace('/sign-in');
      }} />
    </Screen>
  );
}
