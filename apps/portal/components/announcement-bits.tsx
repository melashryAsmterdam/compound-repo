'use client';

import type { AdminAnnouncement } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { Chip } from './ui';

export function AudienceLabel({ a }: { a: AdminAnnouncement['audience'] }) {
  const { t } = useI18n();
  if (a.type === 'blocks') return <>{t('ann.audience.blocks', { list: (a.blocks ?? []).join('، ') })}</>;
  if (a.type === 'units') return <>{t('ann.audience.units', { n: a.unitIds?.length ?? 0 })}</>;
  return <>{t('ann.audience.all')}</>;
}

export function AnnStatus({ s }: { s: string }) {
  const { t } = useI18n();
  return <Chip tone={s === 'sent' ? 'active' : s === 'scheduled' ? 'invited' : s === 'deleted' ? 'neutral' : 'in_progress'}>{t(`ann.status.${s}` as any)}</Chip>;
}

export function annTitle(a: AdminAnnouncement, locale: 'ar' | 'en') {
  return (locale === 'ar' ? a.titleAr ?? a.titleEn : a.titleEn ?? a.titleAr) ?? '';
}
