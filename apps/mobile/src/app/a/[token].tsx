import { useQuery } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Image, Linking } from 'react-native';
import { Screen, useDelayed } from '@/components/Screen';
import { Button, Card, ErrorPanel, Ltr, Row, Skeleton, Text } from '@/components/ui';
import { ApiError, unwrap } from '@/lib/api';
import { setFlow } from '@/lib/flow';
import { errorText } from '@/lib/i18n';
import { useSession } from '@/lib/session';
import { colors, radius, space } from '@/lib/theme';

/** M-04 Activation preview: proves the invite is genuine before anything is entered (R1-AC2). */
export default function ActivationPreview() {
  const { token } = useLocalSearchParams<{ token: string }>();
  const { t } = useTranslation();
  const { api, locale, setLocale, status, signOut } = useSession();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notMe, setNotMe] = useState(false);
  const [signedInAck, setSignedInAck] = useState(false);

  const q = useQuery({
    queryKey: ['invitation', token],
    queryFn: () => unwrap(api.client.GET('/app/v1/invitations/{token}', { params: { path: { token: token! } } })),
    retry: false,
  });
  const showSkeleton = useDelayed(q.isPending);

  const langSwitch = (
    <Row style={{ justifyContent: 'flex-end' }}>
      <Button kind="ghost" title={locale === 'ar' ? 'English' : 'العربية'} onPress={() => void setLocale(locale === 'ar' ? 'en' : 'ar')} />
    </Row>
  );

  if (q.isPending) return <Screen>{langSwitch}{showSkeleton ? <Skeleton height={220} /> : null}</Screen>;

  if (q.error) {
    const err = q.error instanceof ApiError ? q.error : null;
    const phone = err?.problem?.compoundContactPhone;
    if (err?.code === 'invitation_used') {
      return (
        <Screen>
          {langSwitch}
          <Text variant="title">{t('activation.usedTitle')}</Text>
          <Text>{t('activation.usedBody')}</Text>
          <Button title={t('activation.signIn')} onPress={() => router.replace('/sign-in')} />
        </Screen>
      );
    }
    if (err && (err.status === 410 || err.status === 404 || err.status === 400)) {
      return (
        <Screen>
          {langSwitch}
          <Text variant="title" testID="invite-invalid">{t('activation.invalidTitle')}</Text>
          <Text>{t('activation.invalidBody')}</Text>
          {phone ? <Button icon="call" title={t('common.callManagement')} onPress={() => void Linking.openURL(`tel:${phone}`)} /> : null}
          <Button kind="ghost" title={t('activation.signIn')} onPress={() => router.replace('/sign-in')} />
        </Screen>
      );
    }
    return <Screen>{langSwitch}<ErrorPanel onRetry={() => void q.refetch()} /></Screen>;
  }

  const inv = q.data;
  const compound = locale === 'ar' ? inv.compoundNameAr : inv.compoundNameEn;
  const unit = inv.block && !inv.unitNumber.startsWith(inv.block) ? `${inv.block}-${inv.unitNumber}` : inv.unitNumber;

  async function activate() {
    setBusy(true);
    setError(null);
    try {
      const challenge = await unwrap(api.client.POST('/app/v1/activation/start', { body: { invitationToken: token! } }));
      setFlow({ mode: 'activation', challenge, preview: inv, ...(inv.compoundPhone ? { contactPhone: inv.compoundPhone } : {}) });
      router.push('/otp');
    } catch (e) {
      setError(errorText(e instanceof ApiError ? e.code : undefined));
    } finally {
      setBusy(false);
    }
  }

  // §2.1: opened while signed in → Continue (activation adds the unit) or sign out and use the invite.
  if (status === 'signedIn' && !signedInAck) {
    return (
      <Screen>
        <Text variant="title">{t('activation.alreadySignedIn')}</Text>
        <Text>{t('activation.alreadySignedInBody')}</Text>
        <Button title={t('common.continue')} onPress={() => setSignedInAck(true)} />
        <Button
          kind="secondary"
          title={t('activation.signOutAndUse')}
          onPress={async () => {
            await signOut();
            setSignedInAck(true);
          }}
        />
      </Screen>
    );
  }

  return (
    <Screen>
      {langSwitch}
      <Card style={{ alignItems: 'center', gap: space.md }}>
        {inv.compoundLogoUrl ? (
          <Image source={{ uri: inv.compoundLogoUrl }} accessibilityIgnoresInvertColors style={{ width: 72, height: 72, borderRadius: radius.md }} />
        ) : null}
        <Text variant="heading">{compound}</Text>
        <Text variant="title" testID="activation-welcome">{t('activation.welcome', { name: inv.fullName })}</Text>
        <Row>
          <Text color={colors.muted}>{t('activation.unit')}</Text>
          <Ltr variant="heading">{unit}</Ltr>
        </Row>
        <Text color={colors.muted} style={{ textAlign: 'center' }}>
          {t('activation.willSendCode', { destination: '' })}
          <Ltr color={colors.muted}>{inv.maskedDestination}</Ltr>
        </Text>
      </Card>
      {error ? <Text color={colors.danger}>{error}</Text> : null}
      <Button testID="activate" title={t('activation.activate')} onPress={activate} loading={busy} needsNetwork />
      <Button kind="ghost" title={t('activation.notMe')} onPress={() => setNotMe((v) => !v)} />
      {/* InvitationPreview has no compound phone yet (raised with the Architect), so no call button here. */}
      {notMe ? <Text>{t('activation.notMeBody')}</Text> : null}
    </Screen>
  );
}
