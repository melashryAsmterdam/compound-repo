import { Ionicons } from '@expo/vector-icons';
import { Image } from 'react-native';
import type { ComponentProps } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, View } from 'react-native';
import type { Photo, RequestEvent, RequestSummary } from '@/lib/api';
import { formatDual, formatRelative, formatTimeRange, formatVisitShort } from '@/lib/format';
import { useCategories } from '@/lib/queries';
import { categoryName, outcomeBadges, statusChip, timelineLine } from '@/lib/requests';
import { useSession } from '@/lib/session';
import { colors, MIN_TOUCH, radius, space } from '@/lib/theme';
import { AutoText, Card, Chevron, Ltr, Row, StatusChip, Text } from './ui';

const ICONS: Record<string, ComponentProps<typeof Ionicons>['name']> = {
  droplet: 'water-outline',
  zap: 'flash-outline',
  snowflake: 'snow-outline',
  'door-open': 'enter-outline',
  'paint-roller': 'brush-outline',
  bug: 'bug-outline',
  sparkles: 'sparkles-outline',
  ellipsis: 'ellipsis-horizontal-circle-outline',
};
const BY_CODE: Record<string, string> = {
  plumbing: 'droplet', electrical: 'zap', ac_hvac: 'snowflake', carpentry_doors: 'door-open',
  painting_walls: 'paint-roller', pest_control: 'bug', cleaning: 'sparkles', other: 'ellipsis',
};

export function CategoryIcon({ code, icon, size = 24 }: { code?: string; icon?: string; size?: number }) {
  const name = ICONS[icon ?? BY_CODE[code ?? 'other'] ?? 'ellipsis'] ?? 'construct-outline';
  return (
    <View style={{ width: size + 16, height: size + 16, borderRadius: radius.md, backgroundColor: colors.accentSoft, alignItems: 'center', justifyContent: 'center' }}>
      <Ionicons name={name} size={size} color={colors.accent} />
    </View>
  );
}

/** M-11 card, reused on Home. */
export function RequestCard({ r, onPress }: { r: RequestSummary; onPress: () => void }) {
  const { t } = useTranslation();
  const { locale } = useSession();
  const cats = useCategories();
  const name = categoryName(cats.data, r.categoryCode, locale);
  return (
    <Card onPress={onPress} testID={`request-card-${r.ref}`} accessibilityLabel={`${name}, ${r.ref}, ${t(statusChip(r).key)}`}>
      <Row>
        <CategoryIcon code={r.categoryCode} />
        <View style={{ flex: 1, gap: 2 }}>
          <Row style={{ justifyContent: 'space-between' }}>
            <Text variant="label" style={{ flexShrink: 1 }}>{name}</Text>
            <Ltr variant="small" color={colors.muted}>{r.ref}</Ltr>
          </Row>
          <AutoText variant="small" color={colors.muted} numberOfLines={1}>{r.description}</AutoText>
        </View>
        <Chevron />
      </Row>
      <Row style={{ flexWrap: 'wrap' }}>
        <StatusChip chip={statusChip(r)} />
        {outcomeBadges(r).map((b) => (
          <StatusChip key={b.key} chip={b} icon={b.key === 'status.reopened' ? 'refresh' : undefined} />
        ))}
        {r.hasUnreadUpdates ? <View accessibilityLabel={t('announcements.unread')} style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: colors.danger }} /> : null}
      </Row>
      {r.visit?.startAt && r.visit.endAt && (r.status === 'new' || r.status === 'in_progress') ? (
        <Row>
          <Ionicons name="calendar-outline" size={16} color={colors.accent} />
          <Text variant="small">{t('requests.visitLine', { when: formatVisitShort(r.visit.startAt, r.visit.endAt, locale) })}</Text>
        </Row>
      ) : null}
      <Text variant="small" color={colors.muted}>{t('requests.updated', { when: formatRelative(r.updatedAt, locale) })}</Text>
    </Card>
  );
}

export function VisitCard({ startAt, endAt, past, rescheduled, title }: { startAt: string; endAt: string; past?: boolean; rescheduled?: boolean; title?: string }) {
  const { t } = useTranslation();
  const { locale } = useSession();
  return (
    <View testID="visit-card" accessibilityRole="summary"
      style={{ backgroundColor: past ? colors.neutralSoft : colors.visitCard, borderRadius: radius.lg, padding: space.lg, gap: space.xs, borderWidth: 1, borderColor: past ? colors.line : colors.accent }}>
      <Row>
        <Ionicons name="calendar" size={20} color={past ? colors.muted : colors.accent} />
        <Text variant="label" color={past ? colors.muted : colors.accent} style={{ flex: 1 }}>
          {past ? t('detail.visitWas', { when: '' }).trim() : (title ?? t('detail.visitScheduled'))}
        </Text>
        {rescheduled && !past ? <StatusChip chip={{ key: 'detail.rescheduled', tone: 'warning' }} /> : null}
      </Row>
      <Text color={past ? colors.muted : colors.ink}>{formatDual(startAt, locale)}</Text>
      <Ltr variant="heading" color={past ? colors.muted : colors.ink}>{formatTimeRange(startAt, endAt, locale)}</Ltr>
    </View>
  );
}

export function PhotoStrip({ photos, onOpen }: { photos: Photo[]; onOpen: (index: number) => void }) {
  const { t } = useTranslation();
  if (!photos.length) return null;
  return (
    <Row style={{ flexWrap: 'wrap' }}>
      {photos.map((p, i) => (
        <Pressable key={p.id} accessibilityRole="imagebutton" accessibilityLabel={t('photos.photo', { index: i + 1, total: photos.length })} onPress={() => onOpen(i)}>
          <Image source={{ uri: p.thumbnailUrl ?? p.url }} style={{ width: 72, height: 72, borderRadius: radius.md, backgroundColor: colors.neutralSoft }} />
        </Pressable>
      ))}
    </Row>
  );
}

/** M-15 timeline entry. Management on the start side, the resident's own entries on the end side. */
export function TimelineItem({ e, onOpenPhoto, previousVisit }: { e: RequestEvent; onOpenPhoto: (photos: Photo[], i: number) => void; previousVisit?: RequestEvent['visit'] }) {
  const { t } = useTranslation();
  const { locale } = useSession();
  const line = timelineLine(e, (s) => t(`status.${s}`));
  const when = formatRelative(e.createdAt, locale);
  const fullWhen = formatDual(e.createdAt, locale, { time: true });
  const bubble = line.kind === 'comment' || line.kind === 'visit';
  return (
    <View
      accessible
      accessibilityLabel={`${t(line.key, line.params)}${line.body ? `. ${line.body}` : ''}. ${fullWhen}`}
      style={{ alignItems: line.side === 'end' ? 'flex-end' : line.side === 'start' ? 'flex-start' : 'center', gap: 2 }}
    >
      <View style={{
        maxWidth: '88%',
        backgroundColor: bubble ? colors.surface : line.side === 'end' ? colors.accentSoft : 'transparent',
        borderWidth: bubble ? 1 : 0,
        borderColor: colors.line,
        borderRadius: radius.lg,
        paddingHorizontal: bubble || line.side === 'end' ? space.md : 0,
        paddingVertical: space.sm,
        gap: space.xs,
      }}>
        <Text variant={line.kind === 'status' || line.kind === 'system' ? 'small' : 'label'} color={line.kind === 'status' || line.kind === 'system' ? colors.muted : colors.ink}
          style={{ textAlign: line.side === 'center' ? 'center' : undefined }}>
          {t(line.key, line.params)}
        </Text>
        {line.kind === 'visit' && e.visit?.startAt && e.visit.endAt ? (
          <View style={{ gap: 2 }}>
            {e.type === 'visit_rescheduled' && previousVisit?.startAt && previousVisit.endAt ? (
              <Ltr variant="small" color={colors.muted} style={{ textDecorationLine: 'line-through' }}>
                {formatVisitShort(previousVisit.startAt, previousVisit.endAt, locale)}
              </Ltr>
            ) : null}
            <Text>{formatDual(e.visit.startAt, locale)}</Text>
            <Ltr variant="label">{formatTimeRange(e.visit.startAt, e.visit.endAt, locale)}</Ltr>
          </View>
        ) : null}
        {line.body ? <AutoText>{line.body}</AutoText> : null}
        {e.photos?.length ? <PhotoStrip photos={e.photos} onOpen={(i) => onOpenPhoto(e.photos!, i)} /> : null}
      </View>
      <Text variant="small" color={colors.muted} style={{ minHeight: 0 }}>{when}</Text>
    </View>
  );
}

export const TOUCH = MIN_TOUCH;
