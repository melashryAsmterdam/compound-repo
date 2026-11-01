'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { AnnStatus, AudienceLabel, annTitle } from '@/components/announcement-bits';
import { Bdi, Button, Card, Dialog, ErrorPanel, Skeleton, useToast } from '@/components/ui';
import { ApiError, del, get, type AdminAnnouncement } from '@/lib/api';
import { fullDate } from '@/lib/format';
import { useErrorText, useI18n } from '@/lib/i18n';

export default function AnnouncementDetail() {
  const { id } = useParams<{ id: string }>();
  const { t, locale } = useI18n();
  const err = useErrorText();
  const toast = useToast();
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ['announcements', id],
    queryFn: () => get<AdminAnnouncement>(`/admin/v1/announcements/${id}`),
    // Read counts update live for the first hour after sending (spec P-16).
    refetchInterval: (query) => {
      const a = query.state.data;
      if (!a) return false;
      if (a.status === 'sending') return 2000;
      return a.sentAt && Date.now() - new Date(a.sentAt).getTime() < 3_600_000 ? 15_000 : false;
    },
  });
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);

  if (q.isError) return (q.error as ApiError).status === 404 ? <p className="p-10 text-center">{t('sys.notFound')}</p> : <ErrorPanel onRetry={() => q.refetch()} />;
  if (!q.data) return <Skeleton className="h-64 w-full" />;
  const a = q.data;
  const pct = a.recipientCount ? Math.round(((a.readCount ?? 0) / a.recipientCount) * 100) : 0;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <Link href="/announcements" className="text-sm text-accent underline">{t('ann.title')}</Link>
        <h1 dir="auto" className="text-xl font-semibold">{annTitle(a, locale)}</h1>
        <AnnStatus s={a.status} />
        {a.status !== 'deleted' && (
          <Button variant="danger" className="ms-auto" onClick={() => setConfirm(true)}>
            {a.status === 'scheduled' ? t('ann.cancelSchedule') : t('common.delete')}
          </Button>
        )}
      </div>
      {a.status === 'deleted' && <p className="rounded-md bg-canvas p-3 text-sm">{t('ann.deletedBanner')}</p>}
      <Card>
        <dl className="grid grid-cols-2 gap-3 text-sm md:grid-cols-4">
          <div><dt className="text-muted">{t('ann.col.audience')}</dt><dd><AudienceLabel a={a.audience} /></dd></div>
          <div><dt className="text-muted">{t('ann.col.when')}</dt><dd>{fullDate(a.sentAt ?? a.scheduledAt, locale)}</dd></div>
          <div><dt className="text-muted">{t('ann.col.recipients')}</dt><dd><Bdi>{a.recipientCount ?? '—'}</Bdi></dd></div>
          <div><dt className="text-muted">{t('ann.col.read')}</dt><dd>{a.recipientCount ? t('ann.readOf', { read: a.readCount ?? 0, total: a.recipientCount, pct }) : '—'}</dd></div>
          {a.sendSms && <div><dt className="text-muted">{t('ann.col.sms')}</dt><dd><Bdi>{a.smsCount ?? '…'}</Bdi></dd></div>}
          <div><dt className="text-muted">{t('ann.sentBy', { admin: '' })}</dt><dd>{a.createdBy}</dd></div>
        </dl>
      </Card>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {a.titleAr && (
          <Card>
            <div dir="rtl" lang="ar">
              <h2 className="font-semibold">{a.titleAr}</h2>
              <p className="mt-2 whitespace-pre-wrap text-sm">{a.bodyAr}</p>
            </div>
          </Card>
        )}
        {a.titleEn && (
          <Card>
            <div dir="ltr" lang="en">
              <h2 className="font-semibold">{a.titleEn}</h2>
              <p className="mt-2 whitespace-pre-wrap text-sm">{a.bodyEn}</p>
            </div>
          </Card>
        )}
      </div>
      {a.attachment && (
        <a href={a.attachment.url} target="_blank" rel="noreferrer" className="text-sm text-accent underline">
          📎 <Bdi>{a.attachment.fileName}</Bdi>
        </a>
      )}
      <Dialog
        open={confirm}
        onClose={() => setConfirm(false)}
        title={a.status === 'scheduled' ? t('ann.cancelSchedule') : t('common.delete')}
        footer={
          <>
            <Button onClick={() => setConfirm(false)}>{t('common.cancel')}</Button>
            <Button
              variant="danger"
              busy={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  await del(`/admin/v1/announcements/${id}`);
                  void qc.invalidateQueries({ queryKey: ['announcements'] });
                  setConfirm(false);
                } catch (x) {
                  toast(err((x as ApiError).code));
                } finally {
                  setBusy(false);
                }
              }}
            >
              {a.status === 'scheduled' ? t('ann.cancelSchedule') : t('common.delete')}
            </Button>
          </>
        }
      >
        <p>{t('ann.deleteConfirm')}</p>
      </Dialog>
    </div>
  );
}
