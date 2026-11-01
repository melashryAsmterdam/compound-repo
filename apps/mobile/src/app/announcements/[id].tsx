import { useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Image, Linking, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Screen, useDelayed } from '@/components/Screen';
import { AutoText, Button, Card, ErrorPanel, Row, Skeleton, Text } from '@/components/ui';
import { ApiError } from '@/lib/api';
import { formatDual } from '@/lib/format';
import { useAnnouncement } from '@/lib/queries';
import { useSession } from '@/lib/session';
import { colors, radius } from '@/lib/theme';
import { setViewerPhotos } from '@/lib/viewer';

/** M-21 Announcement detail; opening it records the read (A5-AC5). */
export default function AnnouncementDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t } = useTranslation();
  const qc = useQueryClient();
  const { locale, unit } = useSession();
  const q = useAnnouncement(id!);
  const skeleton = useDelayed(q.isPending);

  useEffect(() => {
    if (q.data) {
      void qc.invalidateQueries({ queryKey: ['announcements'] });
      void qc.invalidateQueries({ queryKey: ['notifications'] });
    }
  }, [q.data, qc]);

  if (q.isPending) return <Screen>{skeleton ? <Skeleton height={300} /> : null}</Screen>;
  if (q.error) {
    if (q.error instanceof ApiError && q.error.status === 404) {
      return (
        <Screen>
          <Text variant="heading">{t('announcements.removed')}</Text>
          <Button title={t('common.back')} onPress={() => router.back()} />
        </Screen>
      );
    }
    return <Screen><ErrorPanel onRetry={() => void q.refetch()} /></Screen>;
  }

  const a = q.data;
  const compound = unit?.compound ? (locale === 'ar' ? unit.compound.nameAr : unit.compound.nameEn) : '';
  const other = a.locale && a.locale !== locale;
  const isImage = a.attachment?.contentType?.startsWith('image/');
  return (
    <Screen>
      <AutoText variant="title">{a.title}</AutoText>
      {compound ? <Text color={colors.muted}>{t('announcements.from', { compound })}</Text> : null}
      <Text variant="small" color={colors.muted}>{formatDual(a.sentAt, locale, { time: true })}</Text>
      {other ? <Text variant="small" color={colors.warning}>{a.locale === 'en' ? t('announcements.onlyEnglish') : t('announcements.onlyArabic')}</Text> : null}
      <AutoText dataDetectorType="all">{a.body}</AutoText>
      {a.attachment ? (
        isImage ? (
          <Pressable accessibilityRole="imagebutton" accessibilityLabel={t('announcements.attachment')} onPress={() => {
            setViewerPhotos([{ id: a.id, url: a.attachment!.url!, width: 0, height: 0 }]);
            router.push('/photos?index=0');
          }}>
            <Image source={{ uri: a.attachment.url }} resizeMode="cover" style={{ width: '100%', height: 220, borderRadius: radius.lg, backgroundColor: colors.neutralSoft }} />
          </Pressable>
        ) : (
          <Card onPress={() => void Linking.openURL(a.attachment!.url!)} accessibilityLabel={t('announcements.openAttachment')}>
            <Row>
              <Ionicons name="document-attach-outline" size={24} color={colors.accent} />
              <Text variant="label" style={{ flex: 1 }}>{t('announcements.openAttachment')}</Text>
            </Row>
          </Card>
        )
      ) : null}
    </Screen>
  );
}
