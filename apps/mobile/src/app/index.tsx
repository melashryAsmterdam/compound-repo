import * as Application from 'expo-application';
import { Redirect } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Platform, View } from 'react-native';
import { Text } from '@/components/ui';
import { APP_VERSION, isVersionBelow, MIN_SUPPORTED_VERSION } from '@/lib/config';
import { tokenFromReferrer } from '@/lib/links';
import { useSession } from '@/lib/session';
import { readPrefs, writePrefs } from '@/lib/storage';
import { colors } from '@/lib/theme';
import { useTranslation } from 'react-i18next';

/** M-01 Splash / boot: decides where to go, in the order of the screen spec. */
export default function Boot() {
  const { restore } = useSession();
  const { t } = useTranslation();
  const [target, setTarget] = useState<string | null>(null);

  useEffect(() => {
    let done = false;
    const go = (href: string) => {
      if (!done) {
        done = true;
        setTarget(href);
      }
    };
    void (async () => {
      if (isVersionBelow(APP_VERSION, MIN_SUPPORTED_VERSION)) return go('/update-required');
      const prefs = await readPrefs();
      // Android deferred deep link (ADR-009): first launch after install from an invite.
      if (Platform.OS === 'android' && !prefs.locale) {
        const token = tokenFromReferrer(await Application.getInstallReferrerAsync().catch(() => null));
        if (token) {
          await writePrefs({ locale: 'ar' });
          return go(`/a/${token}`);
        }
      }
      if (!prefs.locale) return go('/language');
      const r = await restore();
      if (r === 'revoked') return go('/revoked');
      if (r === 'signedOut') return go('/sign-in');
      return go(prefs.biometric && r === 'signedIn' ? '/lock' : '/(tabs)');
    })();
  }, [restore]);

  if (target) return <Redirect href={target as never} />;
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg, gap: 16 }}>
      <Text variant="title" color={colors.accent}>{t('boot.appName')}</Text>
      <ActivityIndicator color={colors.accent} />
    </View>
  );
}
