'use client';

import { useInfiniteQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useMemo, useState } from 'react';
import { CategoryLabel, OutcomeBadge, StatusChip, useCategoryName } from '@/components/request-bits';
import { StatusDialog } from '@/components/status-dialog';
import { Bdi, Button, Empty, ErrorPanel, Input, PageHeader, Select, Skeleton, cx, useToast } from '@/components/ui';
import { ApiError, get, qs, type AdminRequestSummary } from '@/lib/api';
import { fullDate, relative, shortDate, visitWindow } from '@/lib/format';
import { useI18n } from '@/lib/i18n';
import { useLive } from '@/lib/live';
import { useBlocks, useCategories, useCounters } from '@/lib/queries';

const STATUSES = ['new', 'in_progress', 'done', 'closed', 'cancelled'] as const;
const DEFAULT_STATUS = 'new,in_progress,done';

function Dashboard() {
  const { t, locale } = useI18n();
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const toast = useToast();
  const counters = useCounters();
  const cats = useCategories();
  const blocks = useBlocks();
  const catName = useCategoryName();
  const [startFor, setStartFor] = useState<AdminRequestSummary | null>(null);
  const [pending, setPending] = useState(0);

  // Filters live in the URL so Back returns to the same view (spec §2.2).
  const f = {
    status: sp.get('status') ?? DEFAULT_STATUS,
    reopened: sp.get('reopened') ?? '',
    category: sp.get('category') ?? '',
    block: sp.get('block') ?? '',
    unitId: sp.get('unitId') ?? '',
    createdFrom: sp.get('createdFrom') ?? '',
    createdTo: sp.get('createdTo') ?? '',
    q: sp.get('q') ?? '',
    sort: sp.get('sort') ?? 'new_first',
  };
  const setF = (patch: Partial<typeof f>) => {
    const next = { ...f, ...patch };
    const u = new URLSearchParams();
    for (const [k, v] of Object.entries(next)) if (v && !(k === 'status' && v === DEFAULT_STATUS) && !(k === 'sort' && v === 'new_first')) u.set(k, v);
    if (next.status !== DEFAULT_STATUS && !next.status) u.set('status', '');
    router.replace(`${pathname}${u.toString() ? `?${u}` : ''}`);
  };
  const isDefaultView = f.status === DEFAULT_STATUS && !f.q && f.sort === 'new_first' && !f.category && !f.block && !f.reopened && !f.createdFrom && !f.createdTo && !f.unitId;

  const query = useInfiniteQuery({
    queryKey: ['requests', f],
    initialPageParam: '' as string,
    queryFn: ({ pageParam }) =>
      get<{ items: AdminRequestSummary[]; nextCursor: string | null }>(
        `/admin/v1/requests${qs({ ...f, status: f.status || undefined, cursor: pageParam || undefined, limit: 25 })}`,
      ),
    getNextPageParam: (p) => p.nextCursor ?? undefined,
    refetchInterval: 15_000,
  });
  const rows = useMemo(() => query.data?.pages.flatMap((p) => p.items) ?? [], [query.data]);

  // Live: never move rows under the pointer (spec §1.5).
  useLive(async (e) => {
    if (e.type !== 'request.created' && e.type !== 'request.updated' && e.type !== 'request.event_added') return;
    if (e.type === 'request.created') {
      const r = await get<{ items: AdminRequestSummary[] }>(`/admin/v1/requests${qs({ status: 'new', limit: 1 })}`).catch(() => null);
      const n = r?.items.find((x) => x.id === e.entityId);
      if (n) toast(t('req.newToast', { ref: n.ref, category: catName(n.categoryCode), unit: n.unit.number ?? '' }), { label: t('common.open'), onClick: () => router.push(`/requests/${n.ref}`) });
      if (isDefaultView && window.scrollY < 100) void query.refetch();
      else setPending((x) => x + 1);
    } else void query.refetch();
  });

  const toggleCounter = (patch: Partial<typeof f>) => {
    const same = Object.entries(patch).every(([k, v]) => f[k as keyof typeof f] === v);
    setF(same ? { status: DEFAULT_STATUS, reopened: '' } : { reopened: '', ...patch });
  };
  const statusSet = new Set(f.status.split(',').filter(Boolean));
  const c = counters.data;
  const cards = [
    { key: 'new', label: t('req.counter.new'), n: c?.new, patch: { status: 'new' } },
    { key: 'in_progress', label: t('req.counter.inProgress'), n: c?.inProgress, patch: { status: 'in_progress' } },
    { key: 'done', label: t('req.counter.done'), n: c?.doneAwaitingConfirmation, patch: { status: 'done' } },
    { key: 'reopened', label: t('req.counter.reopened'), n: c?.reopened, patch: { status: 'in_progress', reopened: 'true' } },
  ];

  return (
    <>
      <PageHeader title={t('req.title')} />
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {cards.map((card) => {
          const selected = Object.entries(card.patch).every(([k, v]) => f[k as keyof typeof f] === v) && (card.key === 'reopened' || !f.reopened);
          return (
            <button
              key={card.key}
              aria-pressed={selected}
              onClick={() => toggleCounter(card.patch)}
              className={cx('rounded-lg border bg-surface p-4 text-start', selected ? 'border-accent ring-2 ring-accent/30' : 'border-line hover:border-accent')}
            >
              <span className="block text-sm text-muted">{card.label}</span>
              <span className="text-2xl font-semibold">{counters.isError ? '–' : card.n ?? <Skeleton className="mt-1 h-7 w-10" />}</span>
            </button>
          );
        })}
      </div>

      <div className="mb-3 flex flex-wrap items-end gap-2 rounded-lg border border-line bg-surface p-3">
        <label className="flex min-w-48 flex-1 flex-col text-xs">
          {t('common.search')}
          <Input type="search" defaultValue={f.q} placeholder={t('req.filter.search')} onKeyDown={(e) => e.key === 'Enter' && setF({ q: (e.target as HTMLInputElement).value })} onBlur={(e) => e.target.value !== f.q && setF({ q: e.target.value })} />
        </label>
        <fieldset className="flex flex-col text-xs">
          <legend>{t('req.filter.status')}</legend>
          <div className="flex flex-wrap gap-1">
            {STATUSES.map((s) => (
              <button
                key={s}
                aria-pressed={statusSet.has(s)}
                onClick={() => {
                  const n = new Set(statusSet);
                  n.has(s) ? n.delete(s) : n.add(s);
                  setF({ status: [...n].join(','), reopened: '' });
                }}
                className={cx('min-h-8 rounded-full border px-2 text-xs', statusSet.has(s) ? 'border-accent bg-info-bg' : 'border-line')}
              >
                {t(`status.${s}`)}
              </button>
            ))}
          </div>
        </fieldset>
        <label className="flex flex-col text-xs">
          {t('req.filter.category')}
          <Select value={f.category} onChange={(e) => setF({ category: e.target.value })}>
            <option value="">{t('common.all')}</option>
            {cats.data?.map((cat) => (
              <option key={cat.code} value={cat.code}>
                {locale === 'ar' ? cat.nameAr : cat.nameEn}
              </option>
            ))}
          </Select>
        </label>
        <label className="flex flex-col text-xs">
          {t('req.filter.block')}
          <Select value={f.block} onChange={(e) => setF({ block: e.target.value })}>
            <option value="">{t('common.all')}</option>
            {blocks.data?.map((b) => (
              <option key={b.block} value={b.block}>
                {b.block}
              </option>
            ))}
          </Select>
        </label>
        <label className="flex flex-col text-xs">
          {t('req.filter.from')}
          <Input type="date" value={f.createdFrom} onChange={(e) => setF({ createdFrom: e.target.value })} />
        </label>
        <label className="flex flex-col text-xs">
          {t('req.filter.to')}
          <Input type="date" value={f.createdTo} onChange={(e) => setF({ createdTo: e.target.value })} />
        </label>
        <label className="flex flex-col text-xs">
          {t('req.sort')}
          <Select value={f.sort} onChange={(e) => setF({ sort: e.target.value })}>
            {(['new_first', 'created_desc', 'created_asc', 'updated_desc'] as const).map((s) => (
              <option key={s} value={s}>
                {t(`req.sort.${s}`)}
              </option>
            ))}
          </Select>
        </label>
        {!isDefaultView && (
          <Button variant="ghost" onClick={() => router.replace(pathname)}>
            {t('common.clearFilters')}
          </Button>
        )}
      </div>

      {pending > 0 && (
        <button
          className="mb-2 w-full rounded-md bg-info-bg p-2 text-sm text-info"
          onClick={() => {
            setPending(0);
            void query.refetch();
            window.scrollTo({ top: 0 });
          }}
        >
          {t('req.newBanner', { n: pending })}
        </button>
      )}

      {query.isFetching && !query.isLoading && <div className="mb-1 h-0.5 w-full animate-pulse bg-accent" aria-hidden />}

      {query.isLoading ? (
        <div className="flex flex-col gap-2">{Array.from({ length: 10 }, (_, i) => <Skeleton key={i} className="h-12 w-full" />)}</div>
      ) : query.isError ? (
        <ErrorPanel onRetry={() => query.refetch()} traceId={(query.error as ApiError)?.body?.traceId} />
      ) : rows.length === 0 ? (
        isDefaultView ? (
          <Empty action={<Link className="text-accent underline" href="/units">{t('req.inviteOwners')}</Link>}>{t('req.empty')}</Empty>
        ) : (
          <Empty action={<Button onClick={() => router.replace(pathname)}>{t('common.clearFilters')}</Button>}>{t('req.emptyFiltered')}</Empty>
        )
      ) : (
        <div className="relative overflow-x-auto rounded-lg border border-line bg-surface">
          <table className="w-full text-sm">
            <thead className="bg-canvas text-start text-xs text-muted">
              <tr>
                {(['id', 'unit', 'resident', 'category', 'description', 'status', 'outcome', 'visit', 'created', 'updated'] as const).map((h) => (
                  <th key={h} scope="col" className="px-3 py-2 text-start font-medium">
                    {t(`req.col.${h}`)}
                  </th>
                ))}
                <th className="sr-only">{t('req.start')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr
                  key={r.id}
                  className={cx('group cursor-pointer border-t border-line hover:bg-canvas', r.outcome === 'reopened' && 'border-s-4 border-s-danger')}
                  onClick={(e) => (e.metaKey || e.ctrlKey ? window.open(`/requests/${r.ref}`, '_blank') : router.push(`/requests/${r.ref}`))}
                >
                  <td className="px-3 py-2 font-medium">
                    <Link href={`/requests/${r.ref}`} onClick={(e) => e.stopPropagation()} className="text-accent">
                      <Bdi>{r.ref}</Bdi>
                    </Link>
                  </td>
                  <td className="whitespace-nowrap px-3 py-2">
                    <Bdi>{r.unit.number}</Bdi>
                    {r.unit.block && <span className="text-muted"> · {t('req.block', { block: r.unit.block })}</span>}
                  </td>
                  <td className="px-3 py-2">{r.residentName}</td>
                  <td className="px-3 py-2">
                    <CategoryLabel code={r.categoryCode} />
                  </td>
                  <td className="max-w-64 truncate px-3 py-2" dir="auto" title={r.description}>
                    {r.description.split('\n')[0]}
                  </td>
                  <td className="px-3 py-2">
                    <StatusChip status={r.status} />
                  </td>
                  <td className="px-3 py-2">
                    <OutcomeBadge r={r} />
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-xs">{r.visit ? visitWindow(r.visit, locale) : ''}</td>
                  <td className="whitespace-nowrap px-3 py-2" title={fullDate(r.createdAt, locale)}>
                    {shortDate(r.createdAt, locale)}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-muted">{relative(r.updatedAt, locale)}</td>
                  <td className="px-3 py-2">
                    {r.status === 'new' && (
                      <Button
                        className="opacity-0 group-hover:opacity-100 focus:opacity-100"
                        onClick={(e) => {
                          e.stopPropagation();
                          setStartFor(r);
                        }}
                      >
                        {t('req.start')}
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {query.hasNextPage && (
            <div className="border-t border-line p-3 text-center">
              <Button onClick={() => query.fetchNextPage()} busy={query.isFetchingNextPage}>
                {t('common.loadMore')}
              </Button>
            </div>
          )}
        </div>
      )}
      {startFor && <StatusDialog request={startFor} to="in_progress" onClose={() => setStartFor(null)} onDone={() => void query.refetch()} />}
    </>
  );
}

export default function Page() {
  return (
    <Suspense>
      <Dashboard />
    </Suspense>
  );
}
