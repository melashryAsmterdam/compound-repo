import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AccessibilityInfo, Linking, Platform, Pressable, TextInput, View, type TextInputInstance } from 'react-native';
import { Screen } from '@/components/Screen';
import { useToast } from '@/components/Toast';
import { Button, Ltr, Text } from '@/components/ui';
import { ApiError, unwrap } from '@/lib/api';
import { deviceInput } from '@/lib/device';
import { getFlow, patchFlow } from '@/lib/flow';
import { formatCountdown } from '@/lib/format';
import { errorText } from '@/lib/i18n';
import { otpDigits } from '@/lib/phone';
import { useSession } from '@/lib/session';
import { colors, radius, space } from '@/lib/theme';

/** M-05 OTP verification, shared by activation and sign-in. */
export default function Otp() {
  const { t } = useTranslation();
  const toast = useToast();
  const { api, adoptTokens, handleRevoke } = useSession();
  const flow = getFlow();
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [challenge, setChallenge] = useState(flow?.challenge);
  const [now, setNow] = useState(Date.now());
  const [locked, setLocked] = useState(false);

  // Back from M-06 with an OTP error from activation/complete: show it here.
  useFocusEffect(
    useCallback(() => {
      const e = getFlow()?.lastError;
      if (!e) return;
      patchFlow({ lastError: undefined });
      setCode('');
      const msg = e === 'otp_invalid' ? t('otp.signInFailed') : e === 'otp_attempts_exceeded' ? t('otp.attemptsExceeded') : errorText(e);
      setError(msg);
      if (e === 'otp_attempts_exceeded') setLocked(true);
    }, [t]),
  );
  const input = useRef<TextInputInstance>(null);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  if (!flow || !challenge) {
    return (
      <Screen>
        <Button title={t('common.back')} onPress={() => router.replace('/sign-in')} />
      </Screen>
    );
  }

  const expiresIn = Date.parse(challenge.expiresAt) - now;
  const resendIn = challenge.resendAvailableAt ? Date.parse(challenge.resendAvailableAt) - now : 0;
  const expired = expiresIn <= 0;

  async function submit(value: string) {
    if (value.length !== 6 || busy || locked) return;
    setError(null);
    if (flow!.mode === 'activation') {
      // The code is sent with consent in one server transaction (activation/complete).
      patchFlow({ code: value, challenge });
      router.push('/consent');
      return;
    }
    setBusy(true);
    try {
      const pair = await unwrap(
        api.client.POST('/app/v1/auth/otp/verify', { body: { challengeId: challenge!.challengeId, code: value, device: await deviceInput() } }),
      );
      await adoptTokens(pair);
      router.dismissAll();
      router.replace('/(tabs)');
    } catch (e) {
      const c = e instanceof ApiError ? e.code : 'internal_error';
      if (c === 'no_active_units') return void handleRevoke(c);
      setCode('');
      showError(c);
    } finally {
      setBusy(false);
    }
  }

  /** QA-13: 5 wrong codes per challenge, across resends; after that only a new challenge works. */
  function showError(c: string) {
    const msg = c === 'otp_invalid' ? t('otp.signInFailed') : c === 'otp_attempts_exceeded' ? t('otp.attemptsExceeded') : errorText(c);
    setError(msg);
    if (c === 'otp_attempts_exceeded') setLocked(true);
    AccessibilityInfo.announceForAccessibility(msg);
    if (c !== 'otp_attempts_exceeded') input.current?.focus();
  }

  async function resend() {
    try {
      const next = await unwrap(api.client.POST('/app/v1/auth/otp/resend', { body: { challengeId: challenge!.challengeId } }));
      setChallenge(next);
      patchFlow({ challenge: next });
      setError(null);
      setCode('');
      toast(t('otp.resent'));
    } catch (e) {
      setError(errorText(e instanceof ApiError ? e.code : undefined));
    }
  }

  const phone = flow.contactPhone ?? flow.preview?.maskedDestination;
  return (
    <Screen>
      <Text>
        {t('otp.sentTo', { destination: '' })}
        <Ltr>{challenge.maskedDestination}</Ltr>
      </Text>
      {/* One field drawn as six boxes so OS autofill works; always LTR (M-05). */}
      <Pressable onPress={() => input.current?.focus()} accessibilityLabel={t('otp.codeLabel')} style={{ direction: 'ltr', flexDirection: 'row', justifyContent: 'center', gap: space.sm }}>
        {Array.from({ length: 6 }, (_, i) => (
          <View key={i} style={{ width: 46, height: 56, borderRadius: radius.md, borderWidth: 2, borderColor: error ? colors.danger : i === code.length ? colors.accent : colors.line, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' }}>
            <Text variant="title" style={{ writingDirection: 'ltr' }}>{code[i] ?? ''}</Text>
          </View>
        ))}
      </Pressable>
      <TextInput
        ref={input}
        testID="otp-input"
        accessibilityLabel={t('otp.codeLabel')}
        value={code}
        onChangeText={(v) => {
          const d = otpDigits(v);
          setCode(d);
          if (d.length === 6) void submit(d);
        }}
        autoFocus
        editable={!busy && !expired && !locked}
        keyboardType="number-pad"
        textContentType="oneTimeCode"
        autoComplete={Platform.OS === 'android' ? 'sms-otp' : 'one-time-code'}
        maxLength={12}
        style={{ position: 'absolute', opacity: 0, height: 1, width: 1 }}
      />
      {error ? <Text color={colors.danger} accessibilityLiveRegion="polite">{error}</Text> : null}
      <Text variant="small" color={expired ? colors.danger : colors.muted}>
        {expired ? t('otp.expired') : t('otp.validFor', { time: formatCountdown(expiresIn) })}
      </Text>
      {busy ? <Text color={colors.muted}>…</Text> : null}
      {locked ? (
        <Button testID="otp-start-again" title={t('otp.startAgain')} onPress={() => router.back()} />
      ) : challenge.resendsRemaining > 0 ? (
        <Button kind="ghost" testID="otp-resend" title={resendIn > 0 ? t('otp.resendIn', { time: formatCountdown(resendIn) }) : t('otp.resend')}
          disabled={resendIn > 0} onPress={resend} needsNetwork />
      ) : phone && flow.contactPhone ? (
        <Button kind="ghost" title={t('otp.needHelp')} onPress={() => void Linking.openURL(`tel:${flow.contactPhone}`)} />
      ) : (
        <Text variant="small" color={colors.muted}>{t('otp.needHelp')}</Text>
      )}
      {flow.mode === 'signIn' ? <Button kind="ghost" title={t('otp.changeNumber')} onPress={() => router.back()} /> : null}
    </Screen>
  );
}
