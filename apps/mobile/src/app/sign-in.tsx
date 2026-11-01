import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { GreenHero, HeroPill, SahaMark, useLightStatusBar } from '@/components/brand';
import { Screen } from '@/components/Screen';
import { Button, Field, Row, Segmented, Text } from '@/components/ui';
import { ApiError, unwrap } from '@/lib/api';
import { setFlow } from '@/lib/flow';
import { BRAND } from '@/lib/config';
import { errorText } from '@/lib/i18n';
import { localPart, parseEmail, parseSaudiMobile, toWesternDigits } from '@/lib/phone';
import { useSession } from '@/lib/session';
import { readPrefs, writePrefs } from '@/lib/storage';
import { colors, MIN_TOUCH, radius, space, type } from '@/lib/theme';

/**
 * M-03 Sign in. With `?activate=1` the same form starts activation by the invited mobile/email —
 * the iOS deferred-deep-link path of ADR-009 (`/activation/start {phone}`).
 */
export default function SignIn() {
  const { t } = useTranslation();
  const { api, locale, setLocale } = useSession();
  const insets = useSafeAreaInsets();
  useLightStatusBar();
  const { activate } = useLocalSearchParams<{ activate?: string }>();
  const activation = activate === '1';
  const [mode, setMode] = useState<'phone' | 'email'>('phone');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void readPrefs().then((p) => {
      if (p.lastIdentifier?.startsWith('+966')) setPhone(localPart(p.lastIdentifier));
    });
  }, []);

  const e164 = parseSaudiMobile(phone);
  const mail = parseEmail(email);
  const valid = mode === 'phone' ? Boolean(e164) : Boolean(mail);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const body = mode === 'phone' ? { phone: e164! } : { email: mail! };
      const challenge = await unwrap(
        activation ? api.client.POST('/app/v1/activation/start', { body }) : api.client.POST('/app/v1/auth/otp/start', { body }),
      );
      const identifier = mode === 'phone' ? e164! : mail!;
      await writePrefs({ lastIdentifier: identifier });
      setFlow({ mode: activation ? 'activation' : 'signIn', challenge, identifier });
      router.push('/otp');
    } catch (e) {
      setError(errorText(e instanceof ApiError ? e.code : undefined));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen edges={['bottom']} contentStyle={{ paddingTop: 0 }}>
      {/* M-03 green hero with the pattern and the Saha mark (product identity lives here, not in tabs). */}
      <GreenHero testID="signin-hero" bottomRadius={radius.xl + space.xs}
        style={{ marginHorizontal: -space.lg, paddingTop: insets.top + space.sm, paddingBottom: space.xl, paddingHorizontal: space.lg, gap: space.sm }}>
        <Row style={{ justifyContent: 'flex-end' }}>
          <HeroPill title={locale === 'ar' ? 'English' : 'العربية'} onPress={() => void setLocale(locale === 'ar' ? 'en' : 'ar')} />
        </Row>
        <View style={{ alignItems: 'center', gap: space.sm }}>
          <SahaMark size={72} inverse label={BRAND[locale]} />
          <Text variant="title" color={colors.headerInk}>{BRAND[locale]}</Text>
          <Text variant="title" color={colors.headerInk} style={{ marginTop: space.sm, textAlign: 'center' }}>{t('signIn.title')}</Text>
          <Text color={colors.headerMuted} style={{ textAlign: 'center' }}>{t('signIn.subtitle')}</Text>
        </View>
      </GreenHero>
      <Segmented
        options={[{ value: 'phone', label: t('signIn.mobileTab') }, { value: 'email', label: t('signIn.emailTab') }]}
        value={mode}
        onChange={(m) => {
          setMode(m);
          setTouched(false);
        }}
      />
      {mode === 'phone' ? (
        <View style={{ gap: space.xs }}>
          <Text variant="label">{t('signIn.mobileLabel')}</Text>
          {/* Phone is LTR inside an RTL form: +966 always on the left (M-03 RTL note). */}
          <View style={{ flexDirection: 'row', direction: 'ltr', borderWidth: 1, borderColor: touched && !e164 ? colors.danger : colors.line, borderRadius: radius.md, backgroundColor: colors.surface, overflow: 'hidden' }}>
            <View style={{ paddingHorizontal: space.md, justifyContent: 'center', backgroundColor: colors.neutralSoft }}>
              <Text style={{ writingDirection: 'ltr' }}>+966</Text>
            </View>
            <TextInput
              testID="phone-input"
              accessibilityLabel={t('signIn.mobileLabel')}
              value={phone}
              onChangeText={(v) => setPhone(toWesternDigits(v))}
              onBlur={() => {
                setTouched(true);
                if (e164) setPhone(localPart(e164));
              }}
              keyboardType="phone-pad"
              textContentType="telephoneNumber"
              autoComplete="tel"
              placeholder="5XXXXXXXX"
              placeholderTextColor={colors.muted}
              maxLength={16}
              editable={!busy}
              style={[type.body, { flex: 1, minHeight: MIN_TOUCH + 4, paddingHorizontal: space.md, color: colors.ink, writingDirection: 'ltr', textAlign: 'left' }]}
            />
          </View>
          {touched && !e164 ? <Text variant="small" color={colors.danger}>{t('signIn.phoneInvalid')}</Text> : null}
        </View>
      ) : (
        <Field
          testID="email-input"
          label={t('signIn.emailLabel')}
          value={email}
          onChangeText={setEmail}
          onBlur={() => setTouched(true)}
          keyboardType="email-address"
          autoCapitalize="none"
          autoComplete="email"
          editable={!busy}
          style={{ writingDirection: 'ltr', textAlign: 'left' }}
          error={touched && !mail ? t('signIn.emailInvalid') : null}
        />
      )}
      {error ? <Text color={colors.danger} accessibilityLiveRegion="polite">{error}</Text> : null}
      <Button testID="send-code" title={t('signIn.sendCode')} onPress={submit} loading={busy} disabled={!valid} needsNetwork />
      {!activation ? (
        <View style={{ gap: space.sm }}>
          <Text variant="small" color={colors.muted}>{t('signIn.inviteHint')}</Text>
          <Button kind="ghost" title={t('activation.activate')} onPress={() => router.push('/sign-in?activate=1')} />
        </View>
      ) : null}
    </Screen>
  );
}
