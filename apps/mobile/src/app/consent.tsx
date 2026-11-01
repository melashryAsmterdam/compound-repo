import { useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Screen } from '@/components/Screen';
import { Button, Row, Text } from '@/components/ui';
import { ApiError, unwrap } from '@/lib/api';
import { deviceInput } from '@/lib/device';
import { getFlow, patchFlow } from '@/lib/flow';
import { errorText } from '@/lib/i18n';
import { qk, useLegal } from '@/lib/queries';
import { useSession } from '@/lib/session';
import { colors, MIN_TOUCH, space } from '@/lib/theme';

/** M-06 PDPL consent; completes activation in one server call with the OTP code (R1-AC4). */
export default function Consent() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const { api, locale, adoptTokens } = useSession();
  const flow = getFlow();
  const privacy = useLegal('privacy_notice');
  const terms = useLegal('terms');
  const [agreed, setAgreed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const versions = {
    privacyNoticeVersion: privacy.data?.version ?? flow?.preview?.privacyNoticeVersion,
    termsVersion: terms.data?.version ?? flow?.preview?.termsVersion,
  };
  const ready = Boolean(versions.privacyNoticeVersion && versions.termsVersion);

  async function agree() {
    if (!flow?.code) return router.back();
    setBusy(true);
    setError(null);
    try {
      const pair = await unwrap(
        api.client.POST('/app/v1/activation/complete', {
          body: {
            challengeId: flow.challenge.challengeId,
            code: flow.code,
            consent: { privacyNoticeVersion: versions.privacyNoticeVersion!, termsVersion: versions.termsVersion!, locale },
            device: await deviceInput(),
          },
        }),
      );
      await adoptTokens(pair);
      router.dismissAll();
      router.replace('/push-primer');
    } catch (e) {
      const code = e instanceof ApiError ? e.code : 'internal_error';
      if (code === 'consent_version_outdated') {
        setAgreed(false);
        await qc.invalidateQueries({ queryKey: ['legal'] });
        setError(t('consent.outdated'));
      } else if (code.startsWith('otp_')) {
        // The code is wrong or spent: M-05 shows why (and, after 5 tries, asks for a fresh challenge).
        patchFlow({ code: undefined, lastError: code });
        router.back();
      } else {
        setError(errorText(code));
      }
    } finally {
      setBusy(false);
    }
  }

  const bullets = ['b1', 'b2', 'b3', 'b4', 'b5'] as const;
  return (
    <Screen
      footer={<Button testID="consent-agree" title={t('consent.agree')} onPress={agree} loading={busy} disabled={!agreed || !ready} needsNetwork />}
    >
      <Text variant="title">{t('consent.title')}</Text>
      <View style={{ gap: space.md }}>
        {bullets.map((b) => (
          <Row key={b} style={{ alignItems: 'flex-start' }}>
            <Ionicons name="checkmark-circle-outline" size={20} color={colors.accent} />
            <Text style={{ flex: 1 }}>{t(`consent.${b}`)}</Text>
          </Row>
        ))}
      </View>
      <Button kind="ghost" title={t('consent.readPrivacy')} onPress={() => router.push('/legal/privacy_notice')} />
      <Button kind="ghost" title={t('consent.readTerms')} onPress={() => router.push('/legal/terms')} />
      <Pressable
        testID="consent-check"
        accessibilityRole="checkbox"
        accessibilityState={{ checked: agreed }}
        onPress={() => setAgreed((v) => !v)}
        style={{ flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: MIN_TOUCH }}
      >
        <Ionicons name={agreed ? 'checkbox' : 'square-outline'} size={26} color={colors.accent} />
        <Text style={{ flex: 1 }}>{t('consent.agreeLabel')}</Text>
      </Pressable>
      {error ? <Text color={colors.danger} accessibilityLiveRegion="polite">{error}</Text> : null}
    </Screen>
  );
}
