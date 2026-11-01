import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, FlatList, RefreshControl, View } from 'react-native';
import { useDelayed } from '@/components/Screen';
import { AutoText, Card, EmptyState, ErrorPanel, OfflineBanner, Row, Skeleton, Text } from '@/components/ui';
import { formatDual } from '@/lib/format';
import { useAnnouncements } from '@/lib/queries';
import { useSession } from '@/lib/session';
import { colors, space } from '@/lib/theme';

/** M-20 Announcements for the selected unit. */
export default function Announcements() {
  const { t } = useTranslation();
  const { locale } = useSession();
  const q = useAnnouncements();
  const skeleton = useDelayed(q.isPending);
  const items = q.data?.pages.flatMap((p) => p.items) ?? [];
  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <OfflineBanner />
      <FlatList
        data={items}
        keyExtractor={(a) => a.id}
        contentContainerStyle={{ padding: space.lg, gap: space.md }}
        refreshControl={<RefreshControl refreshing={q.isRefetching && !q.isFetchingNextPage} onRefresh={() => void q.refetch()} />}
        onEndReachedThreshold={0.4}
        onEndReached={() => q.hasNextPage && !q.isFetchingNextPage && void q.fetchNextPage()}
        ListFooterComponent={q.isFetchingNextPage ? <ActivityIndicator color={colors.accent} /> : undefined}
        ListHeaderComponent={q.error ? <ErrorPanel cached={items.length > 0} onRetry={() => void q.refetch()} /> : undefined}
        ListEmptyComponent={<>{q.isPending ? (skeleton ? <View style={{ gap: space.md }}><Skeleton /><Skeleton /></View> : null) : q.error ? null : (
            <EmptyState icon="megaphone-outline" text={t('announcements.empty')} />
          )}</>}
        renderItem={({ item: a }) => (
          <Card onPress={() => router.push(`/announcements/${a.id}`)} accessibilityLabel={`${a.isRead ? '' : t('announcements.unread') + ', '}${a.title}`}>
            <Row>
              {!a.isRead ? <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: colors.accent }} /> : null}
              <AutoText variant="label" style={{ flex: 1 }}>{a.title}</AutoText>
              {a.attachment ? <Ionicons name="attach" size={18} color={colors.muted} accessibilityLabel={t('announcements.attachment')} /> : null}
            </Row>
            <Text variant="small" color={colors.muted}>{formatDual(a.sentAt, locale)}</Text>
            <AutoText numberOfLines={2} color={colors.muted}>{a.body}</AutoText>
          </Card>
        )}
      />
    </View>
  );
}
