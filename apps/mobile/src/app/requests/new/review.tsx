import { Ionicons } from '@expo/vector-icons';
import { useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Image, View } from 'react-native';
import { CategoryIcon } from '@/components/requests';
import { Screen } from '@/components/Screen';
import { AutoText, Button, Card, Ltr, Row, Text } from '@/components/ui';
import { ApiError, REVOKE_CODES, unwrap, type RequestDetail } from '@/lib/api';
import { createBody, locationText } from '@/lib/drafts';
import { errorText } from '@/lib/i18n';
import { invalidateRequest, qk, useCategories } from '@/lib/queries';
import { categoryName } from '@/lib/requests';
import { unitLabel, useSession } from '@/lib/session';
import { colors, radius, space } from '@/lib/theme';
import { useDraft } from '@/lib/useDraft';

/** M-14 New request, step 3: review, submit with Idempotency-Key, success. */
export default function Review() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const { api, locale, unit, handleRevoke } = useSession();
  const cats = useCategories();
  const { draft, discard } = useDraft();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<RequestDetail | null>(null);

  if (created) {
    return (
      <Screen contentStyle={{ flexGrow: 1, justifyContent: 'center', alignItems: 'center' }}
        footer={
          <>
            <Button testID="view-request" title={t('newRequest.viewRequest')} onPress={() => {
              router.dismissAll();
              router.push(`/requests/${created.id}`);
            }} />
            <Button kind="ghost" title={t('common.done')} onPress={() => router.dismissAll()} />
          </>
        }>
        <Ionicons name="checkmark-circle" size={96} color={colors.success} />
        <Text variant="title" testID="request-sent">{t('newRequest.successTitle')}</Text>
        <Ltr variant="display" color={colors.accent}>{created.ref}</Ltr>
        <Text color={colors.muted} style={{ textAlign: 'center' }}>{t('newRequest.successBody')}</Text>
      </Screen>
    );
  }

  if (!draft?.categoryCode || !unit) return null;
  const label = (k: string) => t(`locations.${k}`);
  const location = locationText(draft, label);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const r = await unwrap(
        api.client.POST('/app/v1/units/{unitId}/requests', {
          params: { path: { unitId: unit!.unitId! }, header: { 'Idempotency-Key': draft!.idempotencyKey } },
          body: createBody(draft!, label),
        }),
      );
      qc.setQueryData(qk.request(r.id), r);
      invalidateRequest(qc);
      await discard();
      setCreated(r);
    } catch (e) {
      const code = e instanceof ApiError ? e.code : 'internal_error';
      if (REVOKE_CODES.has(code)) return void handleRevoke(code);
      if (code === 'validation_failed') {
        router.back();
        return;
      }
      // Draft and its idempotency key stay saved, so Try again never duplicates (R2-AC5).
      setError(e instanceof ApiError && (e.isNetwork || e.status >= 500) ? t('newRequest.savedOffline') : errorText(code));
    } finally {
      setBusy(false);
    }
  }

  const Section = ({ title, onEdit, children }: { title: string; onEdit: () => void; children: React.ReactNode }) => (
    <Card>
      <Row style={{ justifyContent: 'space-between' }}>
        <Text variant="small" color={colors.muted}>{title}</Text>
        <Button kind="ghost" title={t('common.edit')} onPress={onEdit} style={{ minHeight: 36, paddingHorizontal: space.sm }} />
      </Row>
      {children}
    </Card>
  );

  return (
    <Screen footer={
      <>
        {error ? <Text color={colors.danger} accessibilityLiveRegion="polite">{error}</Text> : null}
        <Button testID="submit-request" title={error ? t('common.tryAgain') : t('newRequest.submit')} onPress={submit} loading={busy} needsNetwork />
      </>
    }>
      <Text variant="small" color={colors.muted}>{t('newRequest.step', { step: 3 })}</Text>
      <Text variant="title">{t('newRequest.reviewTitle')}</Text>
      <Row>
        <Text color={colors.muted}>{t('newRequest.unit')}</Text>
        <Ltr variant="label">{unitLabel(unit)}</Ltr>
      </Row>
      <Section title={t('newRequest.category')} onEdit={() => router.dismissTo('/requests/new')}>
        <Row>
          <CategoryIcon code={draft.categoryCode} size={20} />
          <Text variant="label">{categoryName(cats.data, draft.categoryCode, locale)}</Text>
        </Row>
      </Section>
      <Section title={t('newRequest.description')} onEdit={() => router.back()}>
        <AutoText>{draft.description.trim()}</AutoText>
        <Text variant="small" color={colors.muted}>{t('newRequest.location')}: {location ?? t('newRequest.none')}</Text>
        <Text variant="small" color={colors.muted}>{t('newRequest.preferredTime')}: {draft.preferredSlot ? t(`slots.${draft.preferredSlot}`) : t('newRequest.none')}</Text>
      </Section>
      {draft.photos.length ? (
        <Section title={t('newRequest.photos')} onEdit={() => router.back()}>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
            {draft.photos.map((p) => <Image key={p.localId} source={{ uri: p.uri }} style={{ width: 64, height: 64, borderRadius: radius.md }} />)}
          </View>
        </Section>
      ) : null}
    </Screen>
  );
}
