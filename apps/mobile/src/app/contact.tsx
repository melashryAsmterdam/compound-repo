import { useTranslation } from 'react-i18next';
import { Linking, View } from 'react-native';
import { Button, Ltr, Text } from '@/components/ui';
import { useSession } from '@/lib/session';
import { colors, space } from '@/lib/theme';

/** M-26 Contact management, including emergencies (Q-21). */
export default function Contact() {
  const { t } = useTranslation();
  const { unit, locale } = useSession();
  const c = unit?.compound;
  return (
    <View style={{ padding: space.lg, gap: space.md }}>
      {c ? <Text variant="heading">{locale === 'ar' ? c.nameAr : c.nameEn}</Text> : null}
      {c?.contactPhone ? (
        <>
          <Text color={colors.muted}>{t('contact.urgent')}</Text>
          <Ltr variant="title">{c.contactPhone}</Ltr>
          <Button icon="call" title={t('contact.call')} onPress={() => void Linking.openURL(`tel:${c.contactPhone}`)} />
        </>
      ) : (
        <Text color={colors.muted}>{t('contact.unavailable')}</Text>
      )}
    </View>
  );
}
