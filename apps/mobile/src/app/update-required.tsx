import { useTranslation } from 'react-i18next';
import { Linking, Platform } from 'react-native';
import { Screen } from '@/components/Screen';
import { Button, Text } from '@/components/ui';
import { storeUrl } from '@/lib/config';

/** M-27 Update required. */
export default function UpdateRequired() {
  const { t } = useTranslation();
  return (
    <Screen edges={['top', 'bottom']} contentStyle={{ flexGrow: 1, justifyContent: 'center' }}>
      <Text variant="title" style={{ textAlign: 'center' }}>{t('system.updateTitle')}</Text>
      <Button title={t('system.update')} onPress={() => void Linking.openURL(storeUrl(Platform.OS))} />
    </Screen>
  );
}
