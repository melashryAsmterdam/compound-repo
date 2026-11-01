'use client';

import { useInfiniteQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useMemo } from 'react';
import { AnnStatus, AudienceLabel, annTitle } from '@/components/announcement-bits';
import { Bdi, Button, Chip, Empty, ErrorPanel, PageHeader, Skeleton, cx } from '@/components/ui';
import { get, qs, type AdminAnnouncement } from '@/lib/api';
import { fullDate } from '@/lib/format';
import { useI18n } from '@/lib/i18n';

function List() {
  const { t, locale } = useI18n();
  const router = useRouter();
  const tab = useSearchParams().get('tab') === 'scheduled' ? 'scheduled' : 'sent';
  const q = useInfiniteQuery({
    queryKey: ['announcements'],
    initialPageParam: '',
    queryFn: ({ pageParam }) => get<{ items: AdminAnnouncement[]; nextCursor: string | null }>(`/admin/v1/announcements${qs({ cursor: pageParam || undefined, limit: 50 })}`),
    getNextPageParam: (p) => p.nextCursor ?? undefined,
  });
  const all = useMemo(() => q.data?.pages.flatMap((p) => p.items) ?? [], [q.data]);
  const rows = all.filter((a) => (tab === 'scheduled' ? a.status === 'scheduled' : a.status === 'sent' || a.status === 'sending'));

  return (
    <>
      <PageHeader title={t('ann.title')} actions={<Link href="/announcements/new" className="rounded-md bg-accent px-3 py-2 text-sm font-medium text-accent-ink">{t('ann.new')}</Link>} />
      <div role="tablist" className="mb-3 flex gap-2 border-b border-line">
        {(['sent', 'scheduled'] as const).map((k) => (
          <button key={k} role="tab" aria-selected={tab === k} onClick={() => router.replace(`/announcements${k === 'scheduled' ? '?tab=scheduled' : ''}`)} className={cx('-mb-px border-b-2 px-3 py-2 text-sm', tab === k ? 'border-accent font-medium' : 'border-transparent text-muted')}>
            {t(`ann.tab.${k}`)}
          </button>
        ))}
      </div>
      {q.isLoading ? (
        <Skeleton className="h-40 w-full" />
      ) : q.isError ? (
        <ErrorPanel onRetry={() => q.refetch()} />
      ) : rows.length === 0 ? (
        <Empty action={<Link href="/announcements/new" className="text-accent underline">{t('ann.new')}</Link>}>{t('ann.empty')}</Empty>
      ) : (
        <div className="relative overflow-x-auto rounded-lg border border-line bg-surface">
          <table className="w-full text-sm">
            <thead className="bg-canvas text-xs text-muted">
              <tr>{(['title', 'audience', 'when', 'recipients', 'read', 'sms', 'status'] as const).map((h) => <th key={h} className="px-3 py-2 text-start font-medium">{t(`ann.col.${h}`)}</th>)}</tr>
            </thead>
            <tbody>
              {rows.map((a) => {
                const pct = a.recipientCount ? Math.round(((a.readCount ?? 0) / a.recipientCount) * 100) : 0;
                return (
                  <tr key={a.id} className="cursor-pointer border-t border-line hover:bg-canvas" onClick={() => router.push(`/announcements/${a.id}`)}>
                    <td className="px-3 py-2">
                      <span dir="auto" className="font-medium">{annTitle(a, locale)}</span>
                      {a.titleAr && a.titleEn && <span className="ms-2"><Chip tone="neutral">AR + EN</Chip></span>}
                    </td>
                    <td className="px-3 py-2"><AudienceLabel a={a.audience} /></td>
                    <td className="px-3 py-2 text-xs">{fullDate(a.sentAt ?? a.scheduledAt ?? a.createdAt, locale)}</td>
                    <td className="px-3 py-2"><Bdi>{a.recipientCount ?? '—'}</Bdi></td>
                    <td className="px-3 py-2">{a.readCount !== null && a.readCount !== undefined && a.recipientCount ? t('ann.readOf', { read: a.readCount, total: a.recipientCount, pct }) : '—'}</td>
                    <td className="px-3 py-2"><Bdi>{a.sendSms ? a.smsCount ?? '…' : '—'}</Bdi></td>
                    <td className="px-3 py-2"><AnnStatus s={a.status} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {q.hasNextPage && <div className="p-3 text-center"><Button onClick={() => q.fetchNextPage()}>{t('common.loadMore')}</Button></div>}
        </div>
      )}
    </>
  );
}

export default function Page() {
  return (
    <Suspense>
      <List />
    </Suspense>
  );
}
