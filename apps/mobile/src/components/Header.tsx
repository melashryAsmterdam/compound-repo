import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Image, Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useUnreadCount } from '@/lib/queries';
import { unitLabel, useSession } from '@/lib/session';
import { colors, MIN_TOUCH, radius, space } from '@/lib/theme';
import { IconButton, Ltr, Row, Text } from './ui';
import { Ionicons } from '@expo/vector-icons';

/** Header for M-10, M-11, M-20: compound logo, unit (opens M-24 when >1 unit), bell with unread count. */
export function UnitHeader({ title }: { title?: string }) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const { me, unit, locale } = useSession();
  const unread = useUnreadCount();
  const many = (me?.units.length ?? 0) > 1;
  const c = unit?.compound;
  return (
    <View style={{ paddingTop: insets.top, backgroundColor: colors.surface, borderBottomWidth: 1, borderColor: colors.line }}>
      <Row style={{ paddingHorizontal: space.lg, minHeight: 56, justifyContent: 'space-between' }}>
        <Pressable
          disabled={!many}
          onPress={() => router.push('/unit-switcher')}
          accessibilityRole={many ? 'button' : 'header'}
          accessibilityLabel={`${c ? (locale === 'ar' ? c.nameAr : c.nameEn) : ''} ${unitLabel(unit)}`}
          style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: MIN_TOUCH, flexShrink: 1 }}
        >
          {c?.logoUrl ? <Image source={{ uri: c.logoUrl }} style={{ width: 32, height: 32, borderRadius: radius.sm }} /> : null}
          <View style={{ flexShrink: 1 }}>
            {title ? <Text variant="heading">{title}</Text> : null}
            <Row gap={4}>
              <Text variant={title ? 'small' : 'heading'} color={title ? colors.muted : colors.ink} numberOfLines={1}>
                {c ? (locale === 'ar' ? c.nameAr : c.nameEn) : ''}
              </Text>
              <Ltr variant={title ? 'small' : 'heading'} color={title ? colors.muted : colors.ink}>{unitLabel(unit)}</Ltr>
              {many ? <Ionicons name="chevron-down" size={16} color={colors.muted} /> : null}
            </Row>
          </View>
        </Pressable>
        <IconButton icon="notifications-outline" label={t('home.notifications', { count: unread })} badge={unread} onPress={() => router.push('/notifications')} />
      </Row>
    </View>
  );
}
