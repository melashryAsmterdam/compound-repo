import { Ionicons } from '@expo/vector-icons';
import { useQueryClient } from '@tanstack/react-query';
import { router, Stack } from 'expo-router';
import type { ComponentProps } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Pressable, RefreshControl, SectionList, View } from 'react-native';
import { useDelayed } from '@/components/Screen';
import { useToast } from '@/components/Toast';
import { Button, EmptyState, ErrorPanel, OfflineBanner, Row, Skeleton, Text } from '@/components/ui';
import type { AppNotification } from '@/lib/api';
import { dayBucket, formatRelative } from '@/lib/format';
import { hrefFor, parseLink } from '@/lib/links';
import { qk, useNotifications } from '@/lib/queries';
import { useSession } from '@/lib/session';
import { colors, MIN_TOUCH, space } from '@/lib/theme';

const ICON: Record<AppNotification['type'], ComponentProps<typeof Ionicons>['name']> = {
  request_status_changed: 'swap-horizontal-outline',
  request_comment: 'chatbubble-ellipses-outline',
  visit_scheduled: 'calendar-outline',
  visit_rescheduled: 'calendar-outline',
  visit_reminder: 'alarm-outline',
  announcement: 'megaphone-outline',
  request_auto_closed: 'checkmark-done-outline',
  access_revoked: 'lock-closed-outline',
};

/** M-22 Notifications, grouped Today / Yesterday / Earlier. */
export default function Notifications() {
  const { t } = useTranslation();
  const toast = useToast();
  const qc = useQueryClient();
  const { api, locale } = useSession();
  const q = useNotifications();
  const skeleton = useDelayed(q.isPending);
  const items = q.data?.pages.flatMap((p) => p.items) ?? [];
  const unread = q.data?.pages[0]?.unreadCount ?? 0;

  const groups = (['today', 'yesterday', 'earlier'] as const)
    .map((b) => ({ key: b, title: t(`notifications.${b}`), data: items.filter((n) => dayBucket(n.createdAt) === b) }))
    .filter((g) => g.data.length);

  const open = async (n: AppNotification) => {
    if (!n.isRead) {
      await api.client.POST('/app/v1/notifications/{notificationId}/read', { params: { path: { notificationId: n.id } } }).catch(() => undefined);
      void qc.invalidateQueries({ queryKey: qk.notifications });
    }
    const href = hrefFor(
      n.requestId ? { kind: 'request', id: n.requestId } : n.announcementId ? { kind: 'announcement', id: n.announcementId } : parseLink(n.deepLink),
    );
    if (href && href !== '/notifications') router.push(href as never);
    else if (n.type === 'access_revoked') toast(t('notifications.gone'));
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <Stack.Screen
        options={{
          headerRight: unread
            ? () => (
                <Button kind="ghost" title={t('notifications.markAll')} style={{ minHeight: 36, paddingHorizontal: space.sm }} onPress={async () => {
                  await api.client.POST('/app/v1/notifications/read-all').catch(() => undefined);
                  void qc.invalidateQueries({ queryKey: qk.notifications });
                }} />
              )
            : undefined,
        }}
      />
      <OfflineBanner />
      <SectionList
        sections={groups}
        keyExtractor={(n) => n.id}
        contentContainerStyle={{ paddingBottom: space.xl }}
        refreshControl={<RefreshControl refreshing={q.isRefetching && !q.isFetchingNextPage} onRefresh={() => void q.refetch()} />}
        onEndReached={() => q.hasNextPage && !q.isFetchingNextPage && void q.fetchNextPage()}
        ListFooterComponent={q.isFetchingNextPage ? <ActivityIndicator color={colors.accent} /> : undefined}
        ListHeaderComponent={q.error ? <View style={{ padding: space.lg }}><ErrorPanel cached={items.length > 0} onRetry={() => void q.refetch()} /></View> : undefined}
        ListEmptyComponent={<>{q.isPending ? (skeleton ? <View style={{ padding: space.lg, gap: space.md }}><Skeleton /><Skeleton /></View> : null) : q.error ? null : <EmptyState icon="notifications-outline" text={t('notifications.empty')} />}</>}
        renderSectionHeader={({ section }) => (
          <Text variant="small" color={colors.muted} style={{ paddingHorizontal: space.lg, paddingTop: space.lg, paddingBottom: space.xs }}>{section.title}</Text>
        )}
        renderItem={({ item: n }) => (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${n.isRead ? '' : t('announcements.unread') + ', '}${n.title}`}
            onPress={() => void open(n)}
            style={{ minHeight: MIN_TOUCH + 16, paddingHorizontal: space.lg, paddingVertical: space.md, backgroundColor: n.isRead ? colors.surface : colors.accentSoft, borderBottomWidth: 1, borderColor: colors.line }}
          >
            <Row style={{ alignItems: 'flex-start' }}>
              <Ionicons name={ICON[n.type] ?? 'notifications-outline'} size={22} color={colors.accent} />
              <View style={{ flex: 1, gap: 2 }}>
                <Text variant={n.isRead ? 'body' : 'label'}>{n.title}</Text>
                {n.body ? <Text variant="small" color={colors.muted} numberOfLines={2}>{n.body}</Text> : null}
                <Text variant="small" color={colors.muted}>{formatRelative(n.createdAt, locale)}</Text>
              </View>
              {!n.isRead ? <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: colors.accent, marginTop: 8 }} /> : null}
            </Row>
          </Pressable>
        )}
      />
    </View>
  );
}
