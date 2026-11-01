import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Image, Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useUnreadCount } from '@/lib/queries';
import { unitLabel, useSession } from '@/lib/session';
import { colors, MIN_TOUCH, radius, space } from '@/lib/theme';
import { GreenHero, useLightStatusBar } from './brand';
import { IconButton, Ltr, Row, Text } from './ui';
import { Ionicons } from '@expo/vector-icons';

/** Green header (tokens semantic.header + pattern) for M-10, M-11, M-20: the compound's own logo, unit (opens M-24 when >1 unit), bell with unread count. */
export function UnitHeader({ title }: { title?: string }) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  useLightStatusBar();
  const { me, unit, locale } = useSession();
  const unread = useUnreadCount();
  const many = (me?.units.length ?? 0) > 1;
  const c = unit?.compound;
  return (
    <GreenHero style={{ paddingTop: insets.top }}>
      <Row testID="unit-header" style={{ paddingHorizontal: space.lg, paddingTop: space.sm, paddingBottom: space.lg, minHeight: 64, justifyContent: 'space-between' }}>
        <Pressable
          disabled={!many}
          onPress={() => router.push('/unit-switcher')}
          accessibilityRole={many ? 'button' : 'header'}
          accessibilityLabel={`${c ? (locale === 'ar' ? c.nameAr : c.nameEn) : ''} ${unitLabel(unit)}`}
          style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: MIN_TOUCH, flexShrink: 1 }}
        >
          {/* The compound's own logo on a white tile; never recoloured (tokens brand rules). */}
          <View style={{ width: 36, height: 36, borderRadius: radius.sm, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
            {c?.logoUrl ? (
              <Image source={{ uri: c.logoUrl }} resizeMode="contain" style={{ width: 36, height: 36 }} />
            ) : (
              <Text variant="heading" color={colors.header}>{(c ? (locale === 'ar' ? c.nameAr : c.nameEn) : '').trim().charAt(0)}</Text>
            )}
          </View>
          <View style={{ flexShrink: 1 }}>
            {title ? <Text variant="heading" color={colors.headerInk}>{title}</Text> : null}
            <Row gap={4}>
              <Text variant={title ? 'small' : 'heading'} color={title ? colors.headerMuted : colors.headerInk} numberOfLines={1}>
                {c ? (locale === 'ar' ? c.nameAr : c.nameEn) : ''}
              </Text>
              <Ltr variant={title ? 'small' : 'heading'} color={title ? colors.headerMuted : colors.headerInk}>{unitLabel(unit)}</Ltr>
              {many ? <Ionicons name="chevron-down" size={16} color={colors.headerMuted} /> : null}
            </Row>
          </View>
        </Pressable>
        <IconButton icon="notifications-outline" color={colors.headerInk} label={t('home.notifications', { count: unread })} badge={unread} onPress={() => router.push('/notifications')} />
      </Row>
    </GreenHero>
  );
}
