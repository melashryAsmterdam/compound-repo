import { router } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Screen } from '@/components/Screen';
import { Button, Card, Field, Text } from '@/components/ui';
import { ApiError, unwrap } from '@/lib/api';
import { formatDual } from '@/lib/format';
import { errorText } from '@/lib/i18n';
import { useSession } from '@/lib/session';
import { colors } from '@/lib/theme';

type Kind = 'access' | 'correction' | 'deletion';

/**
 * M-25 Privacy and my data (PDPL rights path, K-6). The consent date/version line in the spec needs a
 * field on ResidentMe that the contract doesn't have yet (raised with the Architect).
 */
export default function Privacy() {
  const { t } = useTranslation();
  const { api, locale } = useSession();
  const [kind, setKind] = useState<Kind | null>(null);
  const [details, setDetails] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function send() {
    if (!kind) return;
    setBusy(true);
    setError(null);
    try {
      const r = await unwrap(api.client.POST('/app/v1/privacy/requests', { body: { type: kind, ...(details.trim() ? { details: details.trim() } : {}) } }));
      setResult(t('privacy.received', { date: r.dueAt ? formatDual(r.dueAt, locale) : '' }));
      setKind(null);
      setDetails('');
    } catch (e) {
      setError(errorText(e instanceof ApiError ? e.code : undefined));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen>
      <Text>{t('privacy.intro')}</Text>
      <Button kind="ghost" title={t('consent.readPrivacy')} onPress={() => router.push('/legal/privacy_notice')} />
      {result ? <Card><Text variant="label" color={colors.success}>{result}</Text></Card> : null}
      {(['access', 'correction', 'deletion'] as const).map((k) => (
        <Card key={k} onPress={() => setKind(kind === k ? null : k)} accessibilityLabel={t(`privacy.${k}`)}>
          <Text variant="label" color={k === 'deletion' ? colors.danger : colors.ink}>{t(`privacy.${k}`)}</Text>
          {kind === k ? (
            <>
              {k === 'deletion' ? <Text variant="small" color={colors.danger}>{t('privacy.deletionWarning')}</Text> : null}
              <Field label={t('privacy.details')} value={details} onChangeText={setDetails} multiline maxLength={1000}
                counter={t('common.charCount', { count: details.length, max: 1000 })} />
              {error ? <Text color={colors.danger}>{error}</Text> : null}
              <Button kind={k === 'deletion' ? 'danger' : 'primary'} title={t('privacy.send')} onPress={send} loading={busy} needsNetwork />
            </>
          ) : null}
        </Card>
      ))}
    </Screen>
  );
}
