import { router } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { PhotoPicker } from '@/components/PhotoPicker';
import { CategoryIcon } from '@/components/requests';
import { Screen } from '@/components/Screen';
import { Button, Card, Chevron, Field, Row, SelectChip, Text } from '@/components/ui';
import {
  canProceed, DESCRIPTION_MAX, descriptionValid, LOCATION_KEYS, LOCATION_MAX, photosBlocking, REQUEST_PHOTOS_MAX, type Slot,
} from '@/lib/drafts';
import { useCategories } from '@/lib/queries';
import { categoryName } from '@/lib/requests';
import { useSession } from '@/lib/session';
import { colors, space } from '@/lib/theme';
import { useDraft } from '@/lib/useDraft';

/** M-13 New request, step 2: description, location, preferred time, photos. */
export default function Details() {
  const { t } = useTranslation();
  const { locale } = useSession();
  const cats = useCategories();
  const { draft, update, addPhoto, retryPhoto, removePhoto } = useDraft();
  const [touched, setTouched] = useState(false);
  if (!draft) return null;

  const blocking = photosBlocking(draft.photos);
  const descErr = touched && !descriptionValid(draft.description) ? t('newRequest.descriptionShort') : null;
  const slots: Slot[] = ['morning', 'afternoon', 'evening'];

  return (
    <Screen
      footer={
        <>
          {blocking.failed ? <Text variant="small" color={colors.danger}>{t('newRequest.uploadFailedHint', { count: blocking.failed })}</Text> : null}
          <Button testID="details-next" title={t('common.next')} disabled={!canProceed(draft)} onPress={() => router.push('/requests/new/review')} />
        </>
      }
    >
      <Text variant="small" color={colors.muted}>{t('newRequest.step', { step: 2 })}</Text>
      <Text variant="title">{t('newRequest.detailsTitle')}</Text>
      {draft.categoryCode ? (
        <Card onPress={() => router.back()} accessibilityLabel={`${t('newRequest.category')}: ${categoryName(cats.data, draft.categoryCode, locale)}`}>
          <Row>
            <CategoryIcon code={draft.categoryCode} size={20} />
            <Text variant="label" style={{ flex: 1 }}>{categoryName(cats.data, draft.categoryCode, locale)}</Text>
            <Text variant="small" color={colors.accent}>{t('common.edit')}</Text>
            <Chevron />
          </Row>
        </Card>
      ) : null}
      <Field
        testID="description-input"
        label={t('newRequest.description')}
        placeholder={t('newRequest.descriptionPlaceholder')}
        value={draft.description}
        onChangeText={(v) => update({ description: v.slice(0, DESCRIPTION_MAX) })}
        onBlur={() => setTouched(true)}
        multiline
        maxLength={DESCRIPTION_MAX}
        error={descErr}
        counter={t('common.charCount', { count: draft.description.length, max: DESCRIPTION_MAX })}
      />
      <View style={{ gap: space.sm }}>
        <Text variant="label">{t('newRequest.location')} · <Text variant="small" color={colors.muted}>{t('common.optional')}</Text></Text>
        <Row style={{ flexWrap: 'wrap' }}>
          {LOCATION_KEYS.map((k) => (
            <SelectChip key={k} label={t(`locations.${k}`)} selected={draft.locationKey === k} onPress={() => update({ locationKey: draft.locationKey === k ? undefined : k })} />
          ))}
        </Row>
        {draft.locationKey === 'other' ? (
          <Field label={t('newRequest.locationOther')} value={draft.locationOther ?? ''} maxLength={LOCATION_MAX} onChangeText={(v) => update({ locationOther: v })} />
        ) : null}
      </View>
      <View style={{ gap: space.sm }}>
        <Text variant="label">{t('newRequest.preferredTime')} · <Text variant="small" color={colors.muted}>{t('common.optional')}</Text></Text>
        <Row style={{ flexWrap: 'wrap' }}>
          {slots.map((s) => (
            <SelectChip key={s} label={t(`slots.${s}`)} selected={draft.preferredSlot === s} onPress={() => update({ preferredSlot: draft.preferredSlot === s ? undefined : s })} />
          ))}
        </Row>
      </View>
      <View style={{ gap: space.sm }}>
        <Text variant="label">{t('newRequest.photos')} · <Text variant="small" color={colors.muted}>{t('common.optional')}</Text></Text>
        <PhotoPicker photos={draft.photos} max={REQUEST_PHOTOS_MAX} onAdd={addPhoto} onRetry={retryPhoto} onRemove={removePhoto} />
      </View>
    </Screen>
  );
}
