import { router, Stack } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Alert, Linking, Pressable, View } from 'react-native';
import { CategoryIcon } from '@/components/requests';
import { Screen, useDelayed } from '@/components/Screen';
import { ErrorPanel, IconButton, Ltr, Skeleton, Text } from '@/components/ui';
import { hasContent } from '@/lib/drafts';
import { useCategories } from '@/lib/queries';
import { orderCategories } from '@/lib/requests';
import { useSession } from '@/lib/session';
import { colors, MIN_TOUCH, radius, space } from '@/lib/theme';
import { useDraft } from '@/lib/useDraft';

/** M-12 New request, step 1: category grid (8 fixed categories, "Other" last). */
export default function PickCategory() {
  const { t } = useTranslation();
  const { locale, unit } = useSession();
  const cats = useCategories();
  const { draft, update, discard } = useDraft();
  const skeleton = useDelayed(cats.isPending);
  const phone = unit?.compound?.contactPhone;

  const close = () => {
    if (draft && hasContent(draft)) {
      Alert.alert(t('common.discardTitle'), undefined, [
        { text: t('common.keepEditing'), style: 'cancel' },
        { text: t('common.discard'), style: 'destructive', onPress: async () => {
          await discard();
          router.dismiss();
        } },
      ]);
    } else router.dismiss();
  };

  return (
    <Screen>
      <Stack.Screen options={{ headerLeft: () => <IconButton icon="close" label={t('common.close')} onPress={close} color={colors.accent} /> }} />
      <Text variant="small" color={colors.muted}>{t('newRequest.step', { step: 1 })}</Text>
      <Text variant="title">{t('newRequest.categoryTitle')}</Text>
      {phone ? (
        <Pressable accessibilityRole="link" onPress={() => void Linking.openURL(`tel:${phone}`)} style={{ minHeight: MIN_TOUCH, justifyContent: 'center' }}>
          <Text variant="small" color={colors.danger}>
            {t('newRequest.emergency', { phone: '' })}
            <Ltr variant="small" color={colors.danger}>{phone}</Ltr>
          </Text>
        </Pressable>
      ) : null}
      {cats.isPending ? (
        skeleton ? <Skeleton height={320} /> : null
      ) : cats.error && !cats.data ? (
        <ErrorPanel onRetry={() => void cats.refetch()} />
      ) : (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.md }}>
          {orderCategories(cats.data ?? []).map((c) => {
            const selected = draft?.categoryCode === c.code;
            return (
              <Pressable
                key={c.code}
                testID={`category-${c.code}`}
                accessibilityRole="button"
                accessibilityState={{ selected }}
                onPress={() => {
                  update({ categoryCode: c.code });
                  router.push('/requests/new/details');
                }}
                style={{ width: '47%', flexGrow: 1, minHeight: 104, borderRadius: radius.lg, borderWidth: selected ? 2 : 1, borderColor: selected ? colors.accent : colors.line, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center', gap: space.sm, padding: space.md }}
              >
                <CategoryIcon icon={c.icon} code={c.code} size={28} />
                <Text variant="label" style={{ textAlign: 'center' }}>{locale === 'ar' ? c.nameAr : c.nameEn}</Text>
              </Pressable>
            );
          })}
        </View>
      )}
    </Screen>
  );
}
