import { router } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, View } from 'react-native';
import { Screen } from '@/components/Screen';
import { Button, Text } from '@/components/ui';
import type { Locale } from '@/lib/i18n';
import { useSession } from '@/lib/session';
import { colors, MIN_TOUCH, radius, space } from '@/lib/theme';
import { getLocales } from 'expo-localization';

/** M-02 Language choice (first launch). Arabic pre-selected; an English device pre-selects English (Q-25). */
export default function LanguageScreen() {
  const { setLocale } = useSession();
  const { t } = useTranslation();
  const [choice, setChoice] = useState<Locale>(getLocales()[0]?.languageCode === 'en' ? 'en' : 'ar');
  const [restarting, setRestarting] = useState(false);
  const options: { value: Locale; label: string }[] = [
    { value: 'ar', label: 'العربية' },
    { value: 'en', label: 'English' },
  ];
  return (
    <Screen edges={['top', 'bottom']} contentStyle={{ flexGrow: 1, justifyContent: 'center' }}>
      <Text variant="title" style={{ textAlign: 'center' }}>{choice === 'ar' ? 'اختر لغتك' : 'Choose your language'}</Text>
      <View accessibilityRole="radiogroup" style={{ gap: space.md }}>
        {options.map((o) => (
          <Pressable key={o.value} testID={`lang-${o.value}`} accessibilityRole="radio" accessibilityState={{ selected: choice === o.value }} accessibilityLanguage={o.value}
            onPress={() => setChoice(o.value)}
            style={{ minHeight: MIN_TOUCH + 20, borderRadius: radius.lg, borderWidth: 2, borderColor: choice === o.value ? colors.accent : colors.line, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' }}>
            <Text variant="heading">{o.label}</Text>
          </Pressable>
        ))}
      </View>
      {restarting ? <Text style={{ textAlign: 'center' }} color={colors.muted}>{t('common.restartForLanguage')}</Text> : null}
      <Button
        testID="lang-continue"
        title={choice === 'ar' ? 'متابعة' : 'Continue'}
        onPress={async () => {
          const r = await setLocale(choice);
          if (r.restarting) setRestarting(true);
          else router.replace('/sign-in');
        }}
      />
    </Screen>
  );
}
