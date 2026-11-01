import { Ionicons } from '@expo/vector-icons';
import { useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { CategoryIcon, RequestCard, VisitCard } from '@/components/requests';
import { Screen, useDelayed } from '@/components/Screen';
import { AutoText, Button, Card, Chevron, ErrorPanel, Ltr, Row, Skeleton, Text } from '@/components/ui';
import { useRequestActions } from '@/lib/actions';
import { formatDual, ltr } from '@/lib/format';
import { pushPermission } from '@/lib/push';
import { useAnnouncements, useRequests } from '@/lib/queries';
import { useLiveUpdates } from '@/lib/realtime';
import { homeAction, nextVisit, sortRequests } from '@/lib/requests';
import { useSession } from '@/lib/session';
import { readPrefs, writePrefs } from '@/lib/storage';
import { colors, space } from '@/lib/theme';

/** M-10 Home: what's open, what's new, fastest route to report a problem. */
export default function Home() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const { locale, unit } = useSession();
  useLiveUpdates();
  const open = useRequests('open', 50);
  const latest = useAnnouncements(1);
  const { confirm } = useRequestActions();
  const [pushOff, setPushOff] = useState(false);
  const skeleton = useDelayed(open.isPending);

  useEffect(() => {
    void (async () => {
      const [perm, prefs] = await Promise.all([pushPermission(), readPrefs()]);
      setPushOff(perm !== 'granted' && (prefs.pushReminderDismissals ?? 0) < 2);
    })();
  }, []);

  const list = sortRequests(open.data?.pages.flatMap((p) => p.items) ?? []);
  const action = homeAction(list);
  const visit = nextVisit(list);
  const announcement = latest.data?.pages[0]?.items[0];
  const refreshing = open.isRefetching || latest.isRefetching;

  return (
    <Screen
      edges={[]}
      refreshing={refreshing}
      onRefresh={() => {
        void qc.invalidateQueries({ queryKey: ['requests'] });
        void qc.invalidateQueries({ queryKey: ['announcements'] });
        void qc.invalidateQueries({ queryKey: ['notifications'] });
      }}
    >
      {action.kind === 'one' ? (
        <Card testID="home-action" style={{ borderColor: colors.success }}>
          <Text variant="label">{t('home.actionOne', { ref: ltr(action.request.ref) })}</Text>
          <Row style={{ flexWrap: 'wrap' }}>
            <Button title={t('detail.yesFixed')} onPress={() => void confirm(action.request as never)} style={{ flexGrow: 1 }} needsNetwork />
            <Button kind="secondary" title={t('detail.notFixed')} onPress={() => router.push(`/reopen/${action.request.id}`)} style={{ flexGrow: 1 }} needsNetwork />
          </Row>
        </Card>
      ) : action.kind === 'many' ? (
        <Card onPress={() => router.navigate('/(tabs)/requests')} style={{ borderColor: colors.success }}>
          <Row>
            <Text variant="label" style={{ flex: 1 }}>{t('home.actionMany', { count: action.count })}</Text>
            <Chevron />
          </Row>
        </Card>
      ) : null}

      {visit?.visit?.startAt && visit.visit.endAt ? (
        <Card onPress={() => router.push(`/requests/${visit.id}`)} style={{ padding: 0, borderWidth: 0 }}>
          <VisitCard startAt={visit.visit.startAt} endAt={visit.visit.endAt} title={t('home.nextVisit')} />
          <Row style={{ paddingHorizontal: space.lg, paddingBottom: space.md }}>
            <CategoryIcon code={visit.categoryCode} size={16} />
            <Ltr variant="small" color={colors.muted}>{visit.ref}</Ltr>
          </Row>
        </Card>
      ) : null}

      <Button testID="home-new-request" icon="add-circle-outline" title={t('home.newRequest')} onPress={() => router.push('/requests/new')} disabled={!unit} />

      <View style={{ gap: space.md }}>
        <Text variant="heading">{t('home.openRequests')}</Text>
        {open.isPending ? (
          skeleton ? <><Skeleton /><Skeleton /></> : null
        ) : open.error && !open.data ? (
          <ErrorPanel onRetry={() => void open.refetch()} />
        ) : list.length === 0 ? (
          <Text color={colors.muted}>{t('home.noOpen')}</Text>
        ) : (
          <>
            {list.slice(0, 3).map((r) => (
              <RequestCard key={r.id} r={r} onPress={() => router.push(`/requests/${r.id}`)} />
            ))}
            {list.length > 3 ? <Button kind="ghost" title={t('common.seeAll', { count: list.length })} onPress={() => router.navigate('/(tabs)/requests')} /> : null}
          </>
        )}
      </View>

      {announcement ? (
        <View style={{ gap: space.md }}>
          <Text variant="heading">{t('home.latestAnnouncement')}</Text>
          <Card onPress={() => router.push(`/announcements/${announcement.id}`)}>
            <Row>
              {!announcement.isRead ? <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: colors.accent }} /> : null}
              <AutoText variant="label" style={{ flex: 1 }}>{announcement.title}</AutoText>
            </Row>
            <Text variant="small" color={colors.muted}>{formatDual(announcement.sentAt, locale)}</Text>
            <AutoText numberOfLines={2} color={colors.muted}>{announcement.body}</AutoText>
          </Card>
          <Button kind="ghost" title={t('home.allAnnouncements')} onPress={() => router.navigate('/(tabs)/announcements')} />
        </View>
      ) : null}

      {pushOff ? (
        <Card>
          <Row>
            <Ionicons name="notifications-off-outline" size={22} color={colors.warning} />
            <Text variant="label" style={{ flex: 1 }}>{t('push.reminderTitle')}</Text>
          </Row>
          <Text color={colors.muted}>{t('push.reminderBody')}</Text>
          <Row>
            <Button title={t('push.turnOn')} onPress={() => router.push('/push-primer?from=home')} style={{ flexGrow: 1 }} />
            <Button
              kind="ghost"
              title={t('push.dismiss')}
              onPress={async () => {
                const p = await readPrefs();
                await writePrefs({ pushReminderDismissals: (p.pushReminderDismissals ?? 0) + 1 });
                setPushOff(false);
              }}
            />
          </Row>
        </Card>
      ) : null}

      <Card onPress={() => router.push('/contact')}>
        <Row>
          <Ionicons name="call-outline" size={22} color={colors.accent} />
          <Text variant="label" style={{ flex: 1 }}>{t('home.contact')}</Text>
          <Chevron />
        </Row>
      </Card>
    </Screen>
  );
}
