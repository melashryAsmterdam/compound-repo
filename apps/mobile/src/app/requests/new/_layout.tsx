import { Stack, useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { DraftProvider } from '@/lib/useDraft';
import { colors, fonts } from '@/lib/theme';
import type { CategoryCode } from '@/lib/types';

export default function NewRequestLayout() {
  const { t } = useTranslation();
  const { category } = useLocalSearchParams<{ category?: CategoryCode }>();
  return (
    <DraftProvider initialCategory={category}>
      <Stack
        screenOptions={{
          headerTitleStyle: { fontFamily: fonts.bold },
          headerTintColor: colors.accent,
          headerBackButtonDisplayMode: 'minimal',
          contentStyle: { backgroundColor: colors.bg },
          title: t('home.newRequest'),
        }}
      />
    </DraftProvider>
  );
}
