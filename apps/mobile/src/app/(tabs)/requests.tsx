import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, FlatList, Pressable, RefreshControl, View } from 'react-native';
import { RequestCard } from '@/components/requests';
import { useDelayed } from '@/components/Screen';
import { Button, EmptyState, ErrorPanel, OfflineBanner, Segmented, Skeleton } from '@/components/ui';
import { useRequests } from '@/lib/queries';
import { useLiveUpdates } from '@/lib/realtime';
import { sortRequests } from '@/lib/requests';
import { colors, radius, shadow, space } from '@/lib/theme';

/** M-11 My Requests: Open (default) / Closed, 25 per page, infinite scroll. */
export default function MyRequests() {
  const { t } = useTranslation();
  const [state, setState] = useState<'open' | 'closed'>('open');
  useLiveUpdates();
  const q = useRequests(state);
  const skeleton = useDelayed(q.isPending);
  const items = sortRequests(q.data?.pages.flatMap((p) => p.items) ?? []);

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <OfflineBanner />
      <View style={{ padding: space.lg, paddingBottom: 0 }}>
        <Segmented options={[{ value: 'open', label: t('requests.open') }, { value: 'closed', label: t('requests.closed') }]} value={state} onChange={setState} />
      </View>
      <FlatList
        testID="requests-list"
        data={items}
        keyExtractor={(r) => r.id}
        contentContainerStyle={{ padding: space.lg, gap: space.md, paddingBottom: 96 }}
        renderItem={({ item }) => <RequestCard r={item} onPress={() => router.push(`/requests/${item.id}`)} />}
        refreshControl={<RefreshControl refreshing={q.isRefetching && !q.isFetchingNextPage} onRefresh={() => void q.refetch()} />}
        onEndReachedThreshold={0.4}
        onEndReached={() => q.hasNextPage && !q.isFetchingNextPage && void q.fetchNextPage()}
        ListFooterComponent={q.isFetchingNextPage ? <ActivityIndicator color={colors.accent} /> : undefined}
        ListHeaderComponent={q.error ? <ErrorPanel cached={items.length > 0} onRetry={() => void q.refetch()} /> : undefined}
        ListEmptyComponent={<>{q.isPending ? (
            skeleton ? <View style={{ gap: space.md }}><Skeleton /><Skeleton /><Skeleton /></View> : null
          ) : q.error ? null : state === 'open' ? (
            <EmptyState icon="construct-outline" text={t('requests.emptyOpen')} action={<Button title={t('home.newRequest')} onPress={() => router.push('/requests/new')} />} />
          ) : (
            <EmptyState icon="archive-outline" text={t('requests.emptyClosed')} />
          )}</>}
      />
      {/* FAB at the bottom end corner (left in Arabic). */}
      <Pressable
        testID="fab-new-request"
        accessibilityRole="button"
        accessibilityLabel={t('home.newRequest')}
        onPress={() => router.push('/requests/new')}
        style={{ position: 'absolute', end: space.lg, bottom: space.lg, width: 60, height: 60, borderRadius: radius.pill, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center', ...shadow }}
      >
        <Ionicons name="add" size={30} color={colors.accentInk} />
      </Pressable>
    </View>
  );
}
