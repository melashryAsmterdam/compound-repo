import { Ionicons } from '@expo/vector-icons';
import { useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, View } from 'react-native';
import { Ltr, Text } from '@/components/ui';
import { unitLabel, useSession } from '@/lib/session';
import { colors, MIN_TOUCH, space } from '@/lib/theme';

/** M-24 Unit switcher sheet (only reachable with more than one unit). */
export default function UnitSwitcher() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const { me, unit, locale, selectUnit } = useSession();
  const compounds = new Set(me?.units.map((u) => u.compound?.id));
  return (
    <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.sm }}>
      {me?.units.map((u) => {
        const current = u.unitId === unit?.unitId;
        return (
          <Pressable
            key={u.unitId}
            testID={`unit-${u.number}`}
            accessibilityRole="radio"
            accessibilityState={{ selected: current }}
            onPress={async () => {
              await selectUnit(u.unitId!);
              void qc.invalidateQueries();
              router.back();
            }}
            style={{ minHeight: MIN_TOUCH + 12, flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.md, borderRadius: 12, backgroundColor: current ? colors.accentSoft : colors.surface, borderWidth: 1, borderColor: current ? colors.accent : colors.line }}
          >
            <Ionicons name="home-outline" size={22} color={colors.accent} />
            <View style={{ flex: 1 }}>
              <Ltr variant="label">{unitLabel(u)}</Ltr>
              {compounds.size > 1 && u.compound ? <Text variant="small" color={colors.muted}>{locale === 'ar' ? u.compound.nameAr : u.compound.nameEn}</Text> : null}
            </View>
            {current ? <Ionicons name="checkmark" size={22} color={colors.accent} accessibilityLabel={t('units.current')} /> : null}
          </Pressable>
        );
      })}
    </ScrollView>
  );
}
