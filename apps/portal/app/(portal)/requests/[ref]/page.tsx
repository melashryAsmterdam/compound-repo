'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { toWesternDigits } from '@compound/domain';
import { CategoryLabel, OutcomeBadge, StatusChip } from '@/components/request-bits';
import { StatusDialog } from '@/components/status-dialog';
import { Bdi, Button, Card, Checkbox, Dialog, ErrorPanel, Field, Input, Select, Skeleton, Textarea, useToast } from '@/components/ui';
import { ApiError, del, get, patch, post, qs, type AdminRequestDetail, type AdminRequestSummary, type RequestEvent } from '@/lib/api';
import { formatDual, fullDate, hijriOf, riyadhToday, visitWindow } from '@/lib/format';
import { useErrorText, useI18n } from '@/lib/i18n';
import { useLive } from '@/lib/live';

/** 15-minute steps, 7:00 AM – 11:00 PM (spec P-07). */
const TIMES = Array.from({ length: (23 - 7) * 4 + 1 }, (_, i) => {
  const m = 7 * 60 + i * 15;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
});

function useRequestId(ref: string) {
  return useQuery({
    queryKey: ['request-ref', ref],
    queryFn: async () => {
      const r = await get<{ items: AdminRequestSummary[] }>(`/admin/v1/requests${qs({ q: ref, status: 'new,in_progress,done,closed,cancelled', limit: 5 })}`);
      const hit = r.items.find((x) => x.ref.toUpperCase() === ref.toUpperCase());
      if (!hit) throw new ApiError(404, 'not_found', {});
      return hit.id;
    },
    staleTime: Infinity,
  });
}

function timeLabel(hhmm: string, locale: 'ar' | 'en') {
  const [h, m] = hhmm.split(':').map(Number);
  return new Intl.DateTimeFormat(`${locale === 'ar' ? 'ar-SA' : 'en-US'}-u-nu-latn`, { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'UTC' }).format(new Date(Date.UTC(2000, 0, 1, h, m)));
}

function EventRow({ e, requestId, onChanged }: { e: RequestEvent; requestId: string; onChanged: () => void }) {
  const { t, locale } = useI18n();
  const err = useErrorText();
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(e.body ?? '');
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!e.editableUntil) return;
    const i = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(i);
  }, [e.editableUntil]);
  const left = e.editableUntil ? new Date(e.editableUntil).getTime() - now : 0;
  const actor = e.actor?.displayName ?? '';
  const label = e.type === 'status_changed' ? t('ev.status_changed', { status: t(`status.${e.toStatus}` as any), actor }) : t(`ev.${e.type}` as any, { actor });

  return (
    <li className="relative border-s-2 border-line ps-4 pb-4">
      <span className="absolute -start-[5px] top-1.5 size-2 rounded-full bg-accent" aria-hidden />
      <p className="text-sm">
        <span className="font-medium">{label}</span> <span className="text-xs text-muted">· {fullDate(e.createdAt, locale)}</span>
        {e.editedAt && <span className="text-xs text-muted"> · {t('ev.edited')}</span>}
      </p>
      {e.visit && <p className="mt-1 rounded bg-visit px-2 py-1 text-sm text-ink">{visitWindow(e.visit, locale)}</p>}
      {editing ? (
        <div className="mt-2 flex flex-col gap-2">
          <Textarea dir="auto" maxLength={1000} value={text} onChange={(x) => setText(x.target.value)} />
          <div className="flex gap-2">
            <Button
              variant="primary"
              onClick={async () => {
                try {
                  await patch(`/admin/v1/requests/${requestId}/comments/${e.id}`, { body: text });
                  setEditing(false);
                  onChanged();
                } catch (x) {
                  toast(err((x as ApiError).code));
                }
              }}
            >
              {t('common.save')}
            </Button>
            <Button onClick={() => setEditing(false)}>{t('common.cancel')}</Button>
          </div>
        </div>
      ) : (
        e.body && (
          <p dir="auto" className="mt-1 whitespace-pre-wrap rounded bg-canvas p-2 text-sm">
            {e.body}
          </p>
        )
      )}
      {e.photos && e.photos.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-2">
          {e.photos.map((p) => (
            <a key={p.id} href={p.url} target="_blank" rel="noreferrer">
              <img src={p.thumbnailUrl ?? p.url} alt="" className="size-20 rounded object-cover" />
            </a>
          ))}
        </div>
      )}
      {left > 0 && !editing && (
        <div className="mt-1 flex items-center gap-2 text-xs text-muted">
          <span>{t('composer.editUntil', { time: `${Math.floor(left / 60000)}:${String(Math.floor((left % 60000) / 1000)).padStart(2, '0')}` })}</span>
          <button className="text-accent underline" onClick={() => setEditing(true)}>
            {t('common.edit')}
          </button>
          {e.type === 'comment' && (
            <button
              className="text-danger underline"
              onClick={async () => {
                try {
                  await del(`/admin/v1/requests/${requestId}/comments/${e.id}`);
                  onChanged();
                } catch (x) {
                  toast(err((x as ApiError).code));
                }
              }}
            >
              {t('common.delete')}
            </button>
          )}
        </div>
      )}
    </li>
  );
}

function Composer({ r, onPosted, onPosting, openVisit }: { r: AdminRequestDetail; onPosted: () => void; onPosting: () => void; openVisit: number }) {
  const { t, locale } = useI18n();
  const err = useErrorText();
  const toast = useToast();
  const draftKey = `cs_draft_comment_${r.id}`;
  const [body, setBody] = useState('');
  const [visitOn, setVisitOn] = useState(false);
  const [date, setDate] = useState(riyadhToday());
  const [from, setFrom] = useState('09:00');
  const [to, setTo] = useState('11:00');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const area = useRef<HTMLTextAreaElement>(null);

  useEffect(() => setBody(localStorage.getItem(draftKey) ?? ''), [draftKey]);
  useEffect(() => {
    if (body) localStorage.setItem(draftKey, body);
    else localStorage.removeItem(draftKey);
  }, [body, draftKey]);
  useEffect(() => {
    if (!openVisit) return;
    setVisitOn(true);
    area.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [openVisit]);

  if (!r.canComment)
    return (
      <p className="rounded-md bg-canvas p-3 text-sm text-muted" role="status">
        {t('composer.closed')}
      </p>
    );

  const visitInvalid = visitOn && to <= from;
  const hijri = hijriOf(date, locale);

  async function submit() {
    onPosting();
    setBusy(true);
    setError(null);
    try {
      await post(`/admin/v1/requests/${r.id}/comments`, {
        ...(body.trim() ? { body: body.trim() } : {}),
        ...(visitOn ? { visit: { date, startTime: from, endTime: to } } : {}),
      });
      setBody('');
      setVisitOn(false);
      toast(t('comment.posted'));
      onPosted();
    } catch (x) {
      setError(err((x as ApiError).code)); // text is kept for Retry
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="flex flex-col gap-3">
      <p className="text-xs text-muted">{t('composer.note')}</p>
      <div className="flex flex-wrap gap-2">
        {(['composer.chip1', 'composer.chip2', 'composer.chip3'] as const).map((k) => (
          <button key={k} className="rounded-full border border-line px-2 py-1 text-xs hover:bg-canvas" onClick={() => setBody((b) => (b ? `${b} ${t(k)}` : t(k)))}>
            {t(k)}
          </button>
        ))}
      </div>
      <Textarea ref={area} dir="auto" maxLength={1000} placeholder={t('composer.placeholder')} aria-label={t('composer.placeholder')} value={body} onChange={(e) => setBody(e.target.value)} />
      <p className="text-end text-xs text-muted">
        <Bdi>{body.length} / 1000</Bdi>
      </p>
      <Checkbox label={r.visit ? t('composer.changeVisit') : t('composer.addVisit')} checked={visitOn} onChange={(e) => setVisitOn(e.target.checked)} />
      {visitOn && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Field label={t('composer.date')} htmlFor="vdate" hint={hijri}>
            <Input id="vdate" type="date" min={riyadhToday()} value={date} onChange={(e) => setDate(toWesternDigits(e.target.value))} />
          </Field>
          <Field label={t('composer.from')} htmlFor="vfrom">
            <Select id="vfrom" value={from} onChange={(e) => setFrom(e.target.value)}>
              {TIMES.map((x) => (
                <option key={x} value={x}>
                  {timeLabel(x, locale)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t('composer.to')} htmlFor="vto" error={visitInvalid ? t('composer.visitInvalid') : null}>
            <Select id="vto" value={to} onChange={(e) => setTo(e.target.value)} aria-invalid={visitInvalid}>
              {TIMES.map((x) => (
                <option key={x} value={x}>
                  {timeLabel(x, locale)}
                </option>
              ))}
            </Select>
          </Field>
        </div>
      )}
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
      <div className="flex justify-end">
        <Button variant="primary" busy={busy} disabled={(!body.trim() && !visitOn) || visitInvalid} onClick={submit}>
          {error ? t('common.retry') : t('composer.post')}
        </Button>
      </div>
    </Card>
  );
}

export default function RequestDetailPage() {
  const { ref } = useParams<{ ref: string }>();
  const { t, locale } = useI18n();
  const qc = useQueryClient();
  const idQ = useRequestId(decodeURIComponent(ref));
  const id = idQ.data;
  const q = useQuery({ queryKey: ['request', id], enabled: !!id, queryFn: () => get<AdminRequestDetail>(`/admin/v1/requests/${id}`) });
  const unitOpen = useQuery({
    queryKey: ['unit-open', q.data?.unit.id],
    enabled: !!q.data?.unit.id,
    queryFn: () => get<{ items: AdminRequestSummary[] }>(`/admin/v1/requests${qs({ unitId: q.data!.unit.id, status: 'new,in_progress,done', limit: 50 })}`),
  });
  const [dialog, setDialog] = useState<'in_progress' | 'done' | null>(null);
  const [photo, setPhoto] = useState<number | null>(null);
  const [changed, setChanged] = useState(false);
  const [openVisit, setOpenVisit] = useState(0);
  // Own actions also come back over SSE; only someone else's change shows the banner.
  const lastLocal = useRef(0);
  const markLocal = () => {
    lastLocal.current = Date.now();
  };

  useLive((e) => {
    if (e.entityId !== id) return;
    if (q.data && e.version && e.version !== q.data.version && Date.now() - lastLocal.current > 5000) setChanged(true);
    void q.refetch();
  });

  const refresh = () => {
    markLocal();
    void q.refetch();
    void qc.invalidateQueries({ queryKey: ['counters'] });
  };

  if (idQ.isError || (q.error as ApiError)?.status === 404)
    return (
      <div className="flex flex-col items-center gap-3 p-10">
        <p>{t('detail.notFound')}</p>
        <Link className="text-accent underline" href="/requests">
          {t('sys.goRequests')}
        </Link>
      </div>
    );
  if (q.isError) return <ErrorPanel onRetry={() => q.refetch()} traceId={(q.error as ApiError)?.body?.traceId} />;
  if (!q.data)
    return (
      <div className="flex flex-col gap-3">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );

  const r = q.data;
  const lastReopen = [...(r.timeline ?? [])].reverse().find((e) => e.type === 'reopened');
  const otherOpen = (unitOpen.data?.items ?? []).filter((x) => x.id !== r.id).length;
  const photos = r.photos ?? [];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <Link href="/requests" className="text-sm text-accent underline">
          {t('detail.backToList')}
        </Link>
        <h1 className="text-xl font-semibold">
          <Bdi>{r.ref}</Bdi>
        </h1>
        <StatusChip status={r.status} />
        <OutcomeBadge r={r} />
        <span className="text-sm text-muted">{t('detail.created', { date: fullDate(r.createdAt, locale) })}</span>
      </div>

      {changed && (
        <p role="status" className="rounded-md bg-info-bg p-2 text-sm text-info">
          {t('detail.updatedNow')}{' '}
          <button className="underline" onClick={() => setChanged(false)}>
            {t('common.close')}
          </button>
        </p>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_20rem]">
        <div className="order-2 flex flex-col gap-4 lg:order-1">
          {r.outcome === 'reopened' && lastReopen && (
            <section className="rounded-lg border-2 border-danger bg-danger-bg p-4" aria-label={t('detail.reopenedBy', { n: r.reopenCount })}>
              <p className="font-semibold text-danger">{t('detail.reopenedBy', { n: r.reopenCount })}</p>
              <p dir="auto" className="mt-1 whitespace-pre-wrap">
                {lastReopen.body}
              </p>
              <p className="mt-1 text-xs text-muted">{fullDate(lastReopen.createdAt, locale)}</p>
              <div className="mt-2 flex gap-2">
                {lastReopen.photos?.map((p) => (
                  <a key={p.id} href={p.url} target="_blank" rel="noreferrer">
                    <img src={p.thumbnailUrl ?? p.url} alt="" className="size-20 rounded object-cover" />
                  </a>
                ))}
              </div>
            </section>
          )}

          {r.visit && (
            <section className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-line bg-visit p-4">
              <div>
                <p className="font-semibold text-ink">{t('detail.visitCard')}</p>
                <p>{visitWindow(r.visit, locale)}</p>
                <p className="text-xs text-muted">{t('detail.reminder')}</p>
              </div>
              {r.canComment && <Button onClick={() => setOpenVisit((n) => n + 1)}>{t('detail.reschedule')}</Button>}
            </section>
          )}

          <Card>
            <h2 className="mb-3 font-semibold">{t('detail.summary')}</h2>
            <dl className="mb-3 grid grid-cols-1 gap-2 text-sm sm:grid-cols-3">
              <div>
                <dt className="text-muted">{t('req.col.category')}</dt>
                <dd>
                  <CategoryLabel code={r.categoryCode} />
                </dd>
              </div>
              <div>
                <dt className="text-muted">{t('detail.location')}</dt>
                <dd dir="auto">{r.locationInUnit ?? t('common.none')}</dd>
              </div>
              <div>
                <dt className="text-muted">{t('detail.slot')}</dt>
                <dd>{r.preferredSlot ? t(`slot.${r.preferredSlot}` as any) : t('common.none')}</dd>
              </div>
            </dl>
            <p dir="auto" className="whitespace-pre-wrap">
              {r.description}
            </p>
            {photos.length > 0 && (
              <div className="mt-3">
                <h3 className="mb-2 text-sm font-medium">{t('detail.photos')}</h3>
                <div className="flex flex-wrap gap-2">
                  {photos.map((p, i) => (
                    <button key={p.id} onClick={() => setPhoto(i)} aria-label={`${t('detail.photos')} ${i + 1}`}>
                      <img src={p.thumbnailUrl ?? p.url} alt="" className="size-24 rounded object-cover" />
                    </button>
                  ))}
                </div>
              </div>
            )}
          </Card>

          <Card>
            <h2 className="mb-3 font-semibold">{t('detail.timeline')}</h2>
            <ol className="ms-1">
              {r.timeline?.map((e) => (
                <EventRow key={e.id} e={e} requestId={r.id} onChanged={refresh} />
              ))}
            </ol>
          </Card>

          <Composer r={r} onPosted={refresh} onPosting={markLocal} openVisit={openVisit} />
        </div>

        <aside className="order-1 flex flex-col gap-4 lg:order-2">
          <Card>
            <h2 className="mb-2 font-semibold">{t('detail.statusPanel')}</h2>
            <StatusChip status={r.status} />
            <div className="mt-3 flex flex-col gap-2">
              {r.allowedTransitions?.includes('in_progress') && (
                <Button variant="primary" onClick={() => setDialog('in_progress')}>
                  {t('detail.startWork')}
                </Button>
              )}
              {r.allowedTransitions?.includes('done') && (
                <Button variant={r.allowedTransitions.includes('in_progress') ? 'secondary' : 'primary'} onClick={() => setDialog('done')}>
                  {t('detail.markDone')}
                </Button>
              )}
            </div>
            {r.status === 'done' && r.autoCloseAt && <p className="mt-3 text-sm text-muted">{t('detail.waiting', { date: formatDual(r.autoCloseAt, locale).text })}</p>}
            {(r.status === 'closed' || r.status === 'cancelled') && <p className="mt-3 text-sm text-muted">{t('detail.closedOn', { date: fullDate(r.updatedAt, locale) })}</p>}
          </Card>
          <Card>
            <h2 className="mb-2 font-semibold">{t('detail.resident')}</h2>
            <p>{r.resident?.fullName}</p>
            {r.resident?.phone && (
              <a href={`tel:${r.resident.phone}`} className="block text-accent underline">
                <Bdi>{r.resident.phone}</Bdi>
              </a>
            )}
            {r.resident?.email && (
              <a href={`mailto:${r.resident.email}`} className="block text-accent underline">
                <Bdi>{r.resident.email}</Bdi>
              </a>
            )}
            <p className="mt-2 text-xs">{r.resident?.isCurrentOwner ? <span className="text-success">{t('detail.currentOwner')}</span> : <span className="text-warning">{t('detail.notOwner')}</span>}</p>
          </Card>
          <Card>
            <h2 className="mb-2 font-semibold">{t('detail.unit')}</h2>
            <p>
              <Bdi>{r.unit.number}</Bdi>
              {r.unit.block && <span className="text-muted"> · {t('req.block', { block: r.unit.block })}</span>}
            </p>
            <p className="text-sm text-muted">{t('units.col.open')}: <Bdi>{otherOpen}</Bdi></p>
            <Link href={`/units/${r.unit.id}`} className="text-sm text-accent underline">
              {t('detail.openUnit')}
            </Link>
          </Card>
        </aside>
      </div>

      {dialog && <StatusDialog request={r} to={dialog} onClose={() => setDialog(null)} onStart={markLocal} onDone={refresh} />}
      <Dialog open={photo !== null} onClose={() => setPhoto(null)} title={`${t('detail.photos')} ${photo !== null ? photo + 1 : ''} / ${photos.length}`} wide
        footer={
          <>
            <Button disabled={!photo} onClick={() => setPhoto((p) => (p ?? 1) - 1)}>{t('common.prev')}</Button>
            <Button disabled={photo === photos.length - 1} onClick={() => setPhoto((p) => (p ?? 0) + 1)}>{t('common.next')}</Button>
            <Button onClick={() => setPhoto(null)}>{t('common.close')}</Button>
          </>
        }
      >
        {photo !== null && photos[photo] && <img src={photos[photo].url} alt="" className="max-h-[70vh] w-full object-contain" />}
      </Dialog>
    </div>
  );
}
