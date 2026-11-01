import { Ionicons } from '@expo/vector-icons';
import { useQueryClient } from '@tanstack/react-query';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActionSheetIOS, Alert, Platform, RefreshControl, ScrollView, View, type ScrollViewInstance } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { CategoryIcon, PhotoStrip, TimelineItem, VisitCard } from '@/components/requests';
import { useDelayed } from '@/components/Screen';
import { AutoText, Button, Card, ErrorPanel, IconButton, Ltr, OfflineBanner, Row, Skeleton, StatusChip, Text } from '@/components/ui';
import { useRequestActions } from '@/lib/actions';
import { ApiError, type Photo, type RequestEvent } from '@/lib/api';
import { formatDual } from '@/lib/format';
import { qk, useCategories, useNotifications, useRequest } from '@/lib/queries';
import { useLiveUpdates } from '@/lib/realtime';
import { categoryName, orderedTimeline, outcomeBadges, statusChip, visitCardState, wasRescheduled } from '@/lib/requests';
import { unitLabel, useSession } from '@/lib/session';
import { colors, radius, space } from '@/lib/theme';
import { setViewerPhotos } from '@/lib/viewer';

/** M-15 Request detail: decision bar, visit card, summary, timeline (oldest → newest). No composer (R3-AC4). */
export default function RequestDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t } = useTranslation();
  const qc = useQueryClient();
  const { api, locale } = useSession();
  useLiveUpdates();
  const q = useRequest(id!);
  const cats = useCategories();
  const notifications = useNotifications();
  const { confirm, cancel } = useRequestActions();
  const skeleton = useDelayed(q.isPending);
  const [expanded, setExpanded] = useState(false);
  const scroll = useRef<ScrollViewInstance>(null);
  const lastCount = useRef(0);

  // Mark this request's unread notifications read on open (M-15 data).
  useEffect(() => {
    const unread = notifications.data?.pages.flatMap((p) => p.items).filter((n) => n.requestId === id && !n.isRead) ?? [];
    if (!unread.length) return;
    void Promise.all(
      unread.map((n) => api.client.POST('/app/v1/notifications/{notificationId}/read', { params: { path: { notificationId: n.id } } })),
    ).then(() => qc.invalidateQueries({ queryKey: qk.notifications }));
  }, [id, notifications.data, api, qc]);

  const r = q.data;
  const timeline = orderedTimeline<RequestEvent>(r?.timeline ?? []);
  useEffect(() => {
    if (timeline.length !== lastCount.current) {
      lastCount.current = timeline.length;
      setTimeout(() => scroll.current?.scrollToEnd({ animated: true }), 50);
    }
  }, [timeline.length]);

  const openPhotos = (photos: Photo[], index: number) => {
    setViewerPhotos(photos);
    router.push(`/photos?index=${index}`);
  };

  const menu = () => {
    if (!r) return;
    const options = [t('detail.cancelRequest'), t('common.close')];
    if (Platform.OS === 'ios') {
      ActionSheetIOS.showActionSheetWithOptions({ options, destructiveButtonIndex: 0, cancelButtonIndex: 1 }, (i) => i === 0 && void cancel(r));
    } else {
      Alert.alert(t('detail.moreActions'), undefined, [
        { text: options[0]!, style: 'destructive', onPress: () => void cancel(r) },
        { text: options[1]!, style: 'cancel' },
      ]);
    }
  };

  const header = (
    <Stack.Screen
      options={{
        title: r?.ref ?? '',
        headerRight: r?.allowedActions?.includes('cancel')
          ? () => <IconButton icon="ellipsis-vertical" label={t('detail.moreActions')} onPress={menu} color={colors.accent} />
          : undefined,
      }}
    />
  );

  if (q.isPending) return <View style={{ padding: space.lg, gap: space.md }}>{header}{skeleton ? <><Skeleton height={120} /><Skeleton height={240} /></> : null}</View>;
  if (q.error && !r) {
    const notFound = q.error instanceof ApiError && (q.error.status === 404 || q.error.status === 403);
    return (
      <View style={{ padding: space.lg, gap: space.md }}>
        {header}
        {notFound ? (
          <>
            <Text variant="heading">{t('detail.notAvailable')}</Text>
            <Button title={t('common.back')} onPress={() => router.back()} />
          </>
        ) : (
          <ErrorPanel onRetry={() => void q.refetch()} />
        )}
      </View>
    );
  }
  if (!r) return null;

  const visitState = visitCardState(r);
  const canDecide = r.allowedActions?.includes('confirm') || r.allowedActions?.includes('reopen');
  const closed = r.status === 'closed' || r.status === 'cancelled';
  const visits = timeline.filter((e) => e.type === 'visit_scheduled' || e.type === 'visit_rescheduled');
  const prevVisit = (e: RequestEvent): RequestEvent['visit'] => {
    const i = visits.findIndex((v) => v.id === e.id);
    return i > 0 ? visits[i - 1]!.visit : undefined;
  };

  return (
    <SafeAreaView edges={['bottom']} style={{ flex: 1, backgroundColor: colors.bg }}>
      {header}
      <OfflineBanner />
      <ScrollView ref={scroll} contentContainerStyle={{ padding: space.lg, gap: space.lg }}
        refreshControl={<RefreshControl refreshing={q.isRefetching} onRefresh={() => void q.refetch()} />}>
        <Row style={{ flexWrap: 'wrap' }}>
          <StatusChip chip={statusChip(r)} icon={r.closeReason === 'confirmed' ? 'checkmark' : undefined} />
          {outcomeBadges(r).map((b) => <StatusChip key={b.key} chip={b} />)}
        </Row>

        {canDecide ? (
          <Card testID="decision-bar" style={{ backgroundColor: colors.decision, borderColor: colors.decisionLine }}>
            <Text variant="label">{t('detail.decision')}</Text>
            {r.autoCloseAt ? <Text variant="small" color={colors.muted}>{t('detail.autoClose', { date: formatDual(r.autoCloseAt, locale) })}</Text> : null}
            {r.allowedActions?.includes('confirm') ? <Button testID="confirm-fixed" icon="checkmark" title={t('detail.yesFixed')} onPress={() => void confirm(r)} needsNetwork /> : null}
            {r.allowedActions?.includes('reopen') ? <Button testID="reopen" kind="secondary" title={t('detail.notFixed')} onPress={() => router.push(`/reopen/${r.id}`)} needsNetwork /> : null}
          </Card>
        ) : null}

        {visitState !== 'hidden' && r.visit?.startAt && r.visit.endAt ? (
          <VisitCard startAt={r.visit.startAt} endAt={r.visit.endAt} past={visitState === 'past'} rescheduled={wasRescheduled(timeline)} />
        ) : null}

        <Card>
          <Row>
            <CategoryIcon code={r.categoryCode} />
            <View style={{ flex: 1 }}>
              <Text variant="heading">{categoryName(cats.data, r.categoryCode, locale)}</Text>
              <Ltr variant="small" color={colors.muted}>{unitLabel(r.unit)}</Ltr>
            </View>
          </Row>
          <Text variant="small" color={colors.muted}>{t('detail.created')}: {formatDual(r.createdAt, locale)}</Text>
          {r.locationInUnit ? <Text variant="small" color={colors.muted}>{t('detail.location')}: {r.locationInUnit}</Text> : null}
          {r.preferredSlot ? <Text variant="small" color={colors.muted}>{t('detail.preferredTime')}: {t(`slots.${r.preferredSlot}`)}</Text> : null}
          <AutoText numberOfLines={expanded ? undefined : 6}>{r.description}</AutoText>
          {r.description.length > 280 ? <Button kind="ghost" title={expanded ? t('detail.showLess') : t('detail.showMore')} onPress={() => setExpanded((v) => !v)} /> : null}
          <PhotoStrip photos={r.photos ?? []} onOpen={(i) => openPhotos(r.photos ?? [], i)} />
        </Card>

        {r.reopenCount > 0 && r.status === 'in_progress' ? (
          <Row testID="reopen-callout" style={{ backgroundColor: colors.dangerSoft, borderColor: colors.danger, borderWidth: 1.5, padding: space.md, borderRadius: radius.md }}>
            <Ionicons name="refresh" size={18} color={colors.danger} />
            <Text variant="label" color={colors.danger} style={{ flex: 1 }}>{t('detail.reopenedBanner', { count: r.reopenCount })}</Text>
          </Row>
        ) : null}

        <Text variant="heading">{t('detail.timeline')}</Text>
        <View testID="timeline" style={{ gap: space.md, borderStartWidth: 2, borderColor: colors.line, paddingStart: space.md }}>
          {timeline.map((e) => <TimelineItem key={e.id} e={e} onOpenPhoto={openPhotos} previousVisit={prevVisit(e)} />)}
        </View>

        {closed ? (
          <Card>
            <Text variant="label">{t('detail.closedFooter')}</Text>
            <Button kind="secondary" title={t('detail.createNew')} onPress={() => router.push(`/requests/new?category=${r.categoryCode}`)} />
          </Card>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}
