'use client';

import { useQueries, useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { maskEmail, maskPhone } from '@compound/domain';
import { OwnerDialog } from '@/components/owner-dialog';
import { UnitForm } from '@/components/unit-form';
import { Bdi, Button, Chip, Empty, ErrorPanel, Input, PageHeader, Select, Skeleton, cx } from '@/components/ui';
import { ApiError, get, qs, type UnitDetail, type UnitSummary } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { useBlocks } from '@/lib/queries';

type Page = { items: UnitSummary[]; page: number; pageSize: number; total: number };
const ACT = ['active', 'invited', 'failed', 'expired', 'not_invited'] as const;

function Units() {
  const { t } = useI18n();
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const blocks = useBlocks();
  const [adding, setAdding] = useState(false);
  const [owner, setOwner] = useState<UnitDetail | null>(null);
  const f = { q: sp.get('q') ?? '', block: sp.get('block') ?? '', activation: sp.get('activation') ?? '', status: sp.get('status') ?? 'active', page: Number(sp.get('page') ?? 1) };
  const setF = (p: Partial<typeof f>) => {
    const n = { ...f, page: 1, ...p };
    router.replace(`${pathname}${qs({ q: n.q, block: n.block, activation: n.activation, status: n.status === 'active' ? undefined : n.status, page: n.page > 1 ? n.page : undefined })}`);
  };
  const list = useQuery({ queryKey: ['units', f], queryFn: () => get<Page>(`/admin/v1/units${qs({ ...f, status: f.status || undefined, pageSize: 50 })}`) });
  // Summary strip: one count query per activation status (no dedicated endpoint; see open question).
  const counts = useQueries({
    queries: [undefined, ...ACT].map((a) => ({ queryKey: ['units', 'count', a], queryFn: () => get<Page>(`/admin/v1/units${qs({ activation: a, status: 'active' })}`).then((p) => p.total) })),
  });
  const pages = list.data ? Math.max(1, Math.ceil(list.data.total / 50)) : 1;
  const strip = [
    { key: '', label: t('units.summary.total'), n: counts[0]?.data },
    { key: 'active', label: t('units.summary.active'), n: counts[1]?.data },
    { key: 'invited', label: t('units.summary.invited'), n: counts[2]?.data },
    { key: 'failed', label: t('units.summary.problem'), n: counts[3]?.data !== undefined && counts[4]?.data !== undefined ? counts[3].data + counts[4].data : undefined },
    { key: 'not_invited', label: t('units.summary.notInvited'), n: counts[5]?.data },
  ];
  const filtered = !!(f.q || f.block || f.activation || f.status !== 'active');

  return (
    <>
      <PageHeader title={t('units.title')} actions={<Button variant="primary" onClick={() => setAdding(true)}>{t('units.add')}</Button>} />
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-5">
        {strip.map((s) => (
          <button key={s.label} aria-pressed={f.activation === s.key} onClick={() => setF({ activation: f.activation === s.key ? '' : s.key })} className={cx('rounded-lg border bg-surface p-3 text-start', f.activation === s.key && s.key ? 'border-accent ring-2 ring-accent/30' : 'border-line')}>
            <span className="block text-xs text-muted">{s.label}</span>
            <span className="text-xl font-semibold">{s.n ?? '…'}</span>
          </button>
        ))}
      </div>
      <div className="mb-3 flex flex-wrap items-end gap-2 rounded-lg border border-line bg-surface p-3">
        <label className="flex min-w-48 flex-1 flex-col text-xs">
          {t('common.search')}
          <Input type="search" defaultValue={f.q} placeholder={t('units.filter.search')} onKeyDown={(e) => e.key === 'Enter' && setF({ q: (e.target as HTMLInputElement).value })} onBlur={(e) => e.target.value !== f.q && setF({ q: e.target.value })} />
        </label>
        <label className="flex flex-col text-xs">
          {t('units.col.block')}
          <Select value={f.block} onChange={(e) => setF({ block: e.target.value })}>
            <option value="">{t('common.all')}</option>
            {blocks.data?.map((b) => <option key={b.block} value={b.block}>{b.block}</option>)}
          </Select>
        </label>
        <label className="flex flex-col text-xs">
          {t('units.filter.activation')}
          <Select value={f.activation} onChange={(e) => setF({ activation: e.target.value })}>
            <option value="">{t('common.all')}</option>
            {ACT.map((a) => <option key={a} value={a}>{t(`activation.${a}`)}</option>)}
          </Select>
        </label>
        <label className="flex flex-col text-xs">
          {t('units.filter.status')}
          <Select value={f.status} onChange={(e) => setF({ status: e.target.value })}>
            <option value="active">{t('units.status.active')}</option>
            <option value="inactive">{t('units.status.inactive')}</option>
            <option value="">{t('common.all')}</option>
          </Select>
        </label>
        {filtered && <Button variant="ghost" onClick={() => router.replace(pathname)}>{t('common.clearFilters')}</Button>}
      </div>

      {list.isLoading ? (
        <div className="flex flex-col gap-2">{Array.from({ length: 8 }, (_, i) => <Skeleton key={i} className="h-11 w-full" />)}</div>
      ) : list.isError ? (
        <ErrorPanel onRetry={() => list.refetch()} traceId={(list.error as ApiError)?.body?.traceId} />
      ) : list.data!.items.length === 0 ? (
        filtered ? (
          <Empty action={<Button onClick={() => router.replace(pathname)}>{t('common.clearFilters')}</Button>}>{t('units.emptyFiltered')}</Empty>
        ) : (
          <Empty action={<Button variant="primary" onClick={() => setAdding(true)}>{t('units.add')}</Button>}>
            {t('units.empty')} <span className="block text-xs">{t('units.emptyNote')}</span>
          </Empty>
        )
      ) : (
        <div className="relative overflow-x-auto rounded-lg border border-line bg-surface">
          <table className="w-full text-sm">
            <thead className="bg-canvas text-xs text-muted">
              <tr>
                {(['number', 'block', 'type', 'owner', 'contact', 'activation', 'open'] as const).map((h) => (
                  <th key={h} scope="col" className="px-3 py-2 text-start font-medium">{t(`units.col.${h}`)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {list.data!.items.map((u) => (
                <tr key={u.id} className="cursor-pointer border-t border-line hover:bg-canvas" onClick={() => router.push(`/units/${u.id}`)}>
                  <td className="px-3 py-2 font-medium">
                    <Link href={`/units/${u.id}`} className="text-accent" onClick={(e) => e.stopPropagation()}><Bdi>{u.number}</Bdi></Link>
                    {u.status === 'inactive' && <span className="ms-2"><Chip tone="neutral">{t('units.status.inactive')}</Chip></span>}
                  </td>
                  <td className="px-3 py-2">{u.block}</td>
                  <td className="px-3 py-2">{t(`unitType.${u.type}` as any)}</td>
                  <td className="px-3 py-2">{u.owner?.fullName}</td>
                  <td className="px-3 py-2 text-xs"><Bdi>{u.owner?.phone ? maskPhone(u.owner.phone) : u.owner?.email ? maskEmail(u.owner.email) : ''}</Bdi></td>
                  <td className="px-3 py-2"><Chip tone={u.activation}>{u.activation === 'failed' && <span aria-hidden>⚠</span>}{t(`activation.${u.activation}`)}</Chip></td>
                  <td className="px-3 py-2">
                    {u.openRequestCount > 0 ? (
                      <Link className="text-accent underline" href={`/requests?unitId=${u.id}`} onClick={(e) => e.stopPropagation()}><Bdi>{u.openRequestCount}</Bdi></Link>
                    ) : (
                      <Bdi>0</Bdi>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="flex items-center justify-between border-t border-line p-3 text-sm">
            <span>{t('common.page', { page: f.page, pages })}</span>
            <div className="flex gap-2">
              <Button disabled={f.page <= 1} onClick={() => setF({ page: f.page - 1 })}>{t('common.prev')}</Button>
              <Button disabled={f.page >= pages} onClick={() => setF({ page: f.page + 1 })}>{t('common.next')}</Button>
            </div>
          </div>
        </div>
      )}
      <UnitForm open={adding} onClose={() => setAdding(false)} onCreated={(u) => setOwner(u)} />
      {owner && <OwnerDialog unit={owner} mode="assign" onClose={() => setOwner(null)} />}
    </>
  );
}

export default function Page() {
  return (
    <Suspense>
      <Units />
    </Suspense>
  );
}
