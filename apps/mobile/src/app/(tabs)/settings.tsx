import { router } from 'expo-router';
import { useEffect, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Alert, Linking, Pressable, Switch, View } from 'react-native';
import { Screen } from '@/components/Screen';
import { useToast } from '@/components/Toast';
import { Chevron, Ltr, Row, Text } from '@/components/ui';
import { unwrap } from '@/lib/api';
import { useBiometricKind } from '@/lib/biometric';
import { APP_VERSION, BRAND } from '@/lib/config';
import { maskEmail, maskPhone } from '@/lib/phone';
import { pushPermission } from '@/lib/push';
import { unitLabel, useSession } from '@/lib/session';
import { readPrefs, writePrefs } from '@/lib/storage';
import { colors, MIN_TOUCH, radius, space } from '@/lib/theme';
import * as LocalAuthentication from 'expo-local-authentication';

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View style={{ gap: space.xs }}>
      <Text variant="small" color={colors.muted}>{title}</Text>
      <View style={{ backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.line }}>{children}</View>
    </View>
  );
}

function Item({ label, value, note, onPress, right, testID, danger }: {
  label: string; value?: ReactNode; note?: string; onPress?: () => void; right?: ReactNode; testID?: string; danger?: boolean;
}) {
  const body = (
    <Row style={{ minHeight: MIN_TOUCH + 8, paddingHorizontal: space.lg, paddingVertical: space.sm, borderBottomWidth: 1, borderColor: colors.line }}>
      <View style={{ flex: 1, gap: 2 }}>
        <Text color={danger ? colors.danger : colors.ink}>{label}</Text>
        {note ? <Text variant="small" color={colors.muted}>{note}</Text> : null}
      </View>
      {typeof value === 'string' ? <Text color={colors.muted}>{value}</Text> : value}
      {right ?? (onPress ? <Chevron /> : null)}
    </Row>
  );
  return onPress ? <Pressable testID={testID} accessibilityRole="button" onPress={onPress}>{body}</Pressable> : body;
}

/** M-23 Settings. */
export default function Settings() {
  const { t } = useTranslation();
  const toast = useToast();
  const { api, me, unit, locale, setLocale, signOut, refreshMe } = useSession();
  const bio = useBiometricKind();
  const [osPush, setOsPush] = useState(true);
  const [biometric, setBiometric] = useState(false);
  const [saving, setSaving] = useState<string | null>(null);

  useEffect(() => {
    void pushPermission().then((p) => setOsPush(p === 'granted'));
    void readPrefs().then((p) => setBiometric(Boolean(p.biometric)));
  }, []);

  async function toggleMute(enabled: boolean) {
    setSaving('mute');
    try {
      await unwrap(api.client.PATCH('/app/v1/me', { body: { muteAnnouncements: !enabled } }));
      await refreshMe();
    } catch {
      toast(t('settings.saveFailed'));
    } finally {
      setSaving(null);
    }
  }

  async function toggleBiometric(on: boolean) {
    if (on) {
      const r = await LocalAuthentication.authenticateAsync({ promptMessage: t('biometric.prompt') });
      if (!r.success) return toast(t('biometric.setupFailed'));
    }
    await writePrefs({ biometric: on });
    setBiometric(on);
  }

  return (
    <Screen edges={[]}>
      <Group title={t('settings.profile')}>
        <Item label={me?.fullName ?? ''} note={t('settings.nameNote')} />
        {me?.phone ? <Item label={t('settings.mobile')} value={<Ltr color={colors.muted}>{maskPhone(me.phone)}</Ltr>} /> : null}
        {me?.email ? <Item label={t('settings.email')} value={<Ltr color={colors.muted}>{maskEmail(me.email)}</Ltr>} /> : null}
      </Group>
      <Group title={t('settings.unit')}>
        <Item label={t('units.current')} value={<Ltr color={colors.muted}>{unitLabel(unit)}</Ltr>} />
        {(me?.units.length ?? 0) > 1 ? <Item label={t('settings.switchUnit')} onPress={() => router.push('/unit-switcher')} /> : null}
      </Group>
      <Group title={t('common.language')}>
        {(['ar', 'en'] as const).map((l) => (
          <Item
            key={l}
            testID={`settings-lang-${l}`}
            label={l === 'ar' ? 'العربية' : 'English'}
            right={locale === l ? <Text color={colors.accent}>✓</Text> : <View />}
            onPress={locale === l ? undefined : async () => {
              const r = await setLocale(l);
              if (r.restarting) toast(t('common.restartForLanguage'));
            }}
          />
        ))}
      </Group>
      <Group title={t('settings.notifications')}>
        {!osPush ? <Item label={t('settings.osOff')} onPress={() => void Linking.openSettings()} /> : null}
        <Item label={t('settings.requestUpdates')} note={t('settings.requestUpdatesNote')} right={<Switch value disabled accessibilityLabel={t('settings.requestUpdates')} />} />
        <Item
          label={t('settings.announcements')}
          right={saving === 'mute' ? <ActivityIndicator /> : (
            <Switch testID="mute-switch" accessibilityLabel={t('settings.announcements')} value={!me?.muteAnnouncements} onValueChange={toggleMute} trackColor={{ true: colors.accent }} />
          )}
        />
      </Group>
      {bio.available ? (
        <Group title={t('settings.security')}>
          <Item
            label={bio.kind === 'face' ? t('settings.biometricFace') : t('settings.biometricFinger')}
            right={<Switch value={biometric} onValueChange={toggleBiometric} trackColor={{ true: colors.accent }} accessibilityLabel={bio.kind === 'face' ? t('settings.biometricFace') : t('settings.biometricFinger')} />}
          />
        </Group>
      ) : null}
      <Group title={t('settings.privacy')}>
        <Item label={t('settings.contact')} onPress={() => router.push('/contact')} />
        <Item label={t('settings.privacy')} onPress={() => router.push('/privacy')} />
        <Item label={t('settings.terms')} onPress={() => router.push('/legal/terms')} />
        <Item label={t('settings.privacyNotice')} onPress={() => router.push('/legal/privacy_notice')} />
      </Group>
      <Group title=" ">
        <Item
          testID="sign-out"
          danger
          label={t('settings.signOut')}
          onPress={() =>
            Alert.alert(t('settings.signOutConfirm'), undefined, [
              { text: t('common.cancel'), style: 'cancel' },
              { text: t('settings.signOut'), style: 'destructive', onPress: async () => {
                await signOut();
                router.replace('/sign-in');
              } },
            ])
          }
        />
      </Group>
      <Text variant="small" color={colors.muted} style={{ textAlign: 'center' }}>{t('settings.version', { brand: BRAND[locale], version: APP_VERSION })}</Text>
    </Screen>
  );
}
