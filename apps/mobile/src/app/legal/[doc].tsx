import { Stack, useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Screen, useDelayed } from '@/components/Screen';
import { ErrorPanel, Skeleton, Text } from '@/components/ui';
import { htmlToBlocks } from '@/lib/html';
import { useLegal } from '@/lib/queries';
import { colors } from '@/lib/theme';

/** In-app reader for the privacy notice and terms (M-06, M-23), in the current language. */
export default function LegalReader() {
  const { doc } = useLocalSearchParams<{ doc: 'privacy_notice' | 'terms' }>();
  const { t } = useTranslation();
  const q = useLegal(doc === 'terms' ? 'terms' : 'privacy_notice');
  const skeleton = useDelayed(q.isPending);
  return (
    <Screen>
      <Stack.Screen options={{ title: doc === 'terms' ? t('settings.terms') : t('settings.privacyNotice') }} />
      {q.isPending ? (skeleton ? <Skeleton height={400} /> : null) : q.error ? (
        <ErrorPanel onRetry={() => void q.refetch()} />
      ) : (
        <>
          <Text variant="small" color={colors.muted}>{t('consent.version', { version: q.data.version })}</Text>
          {htmlToBlocks(q.data.html).map((b, i) => (
            <Text key={i} variant={b.heading ? 'heading' : 'body'}>{b.heading ? b.text : b.bullet ? `• ${b.text}` : b.text}</Text>
          ))}
        </>
      )}
    </Screen>
  );
}
