'use client';

import type { AdminRequestSummary, Category } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { useCategories } from '@/lib/queries';
import { Chip } from './ui';

const ICON: Record<string, string> = { droplet: '💧', zap: '⚡', snowflake: '❄️', 'door-open': '🚪', 'paint-roller': '🖌️', bug: '🐜', sparkles: '✨', ellipsis: '•••' };

export function StatusChip({ status }: { status: string }) {
  const { t } = useI18n();
  return <Chip tone={status}>{t(`status.${status}` as any)}</Chip>;
}

export function OutcomeBadge({ r }: { r: Pick<AdminRequestSummary, 'outcome' | 'reopenCount'> }) {
  const { t } = useI18n();
  if (!r.outcome) return null;
  if (r.outcome === 'reopened')
    return (
      <Chip tone="danger">
        <span aria-hidden>↺</span> {t('outcome.reopened', { n: r.reopenCount })}
      </Chip>
    );
  if (r.outcome === 'awaiting_confirmation') return <Chip tone="done">● {t('outcome.awaiting_confirmation')}</Chip>;
  return <Chip tone="closed">{r.outcome === 'confirmed' ? '✓ ' : ''}{t(`outcome.${r.outcome}` as any)}</Chip>;
}

export function useCategoryName() {
  const { locale } = useI18n();
  const cats = useCategories();
  return (code: string) => {
    const c = cats.data?.find((x: Category) => x.code === code);
    return c ? (locale === 'ar' ? c.nameAr : c.nameEn) : code;
  };
}

export function CategoryLabel({ code }: { code: string }) {
  const name = useCategoryName();
  const cats = useCategories();
  const icon = cats.data?.find((c) => c.code === code)?.icon;
  return (
    <span className="inline-flex items-center gap-1 whitespace-nowrap">
      <span aria-hidden>{icon ? ICON[icon] ?? '•' : '•'}</span>
      {name(code)}
    </span>
  );
}
