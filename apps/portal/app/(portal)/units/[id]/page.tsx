'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useState } from 'react';
import { OwnerDialog, type OwnerMode } from '@/components/owner-dialog';
import { OutcomeBadge, StatusChip, CategoryLabel } from '@/components/request-bits';
import { UnitForm } from '@/components/unit-form';
import { Bdi, Button, Card, Chip, Dialog, ErrorPanel, Skeleton, useToast } from '@/components/ui';
import { ApiError, del, get, patch, type AdminRequestSummary, type Invitation, type UnitDetail } from '@/lib/api';
import { fullDate, shortDate } from '@/lib/format';
import { useErrorText, useI18n } from '@/lib/i18n';

type Confirm = 'remove' | 'deactivate' | 'delete' | null;

export default function UnitPage() {
  const { id } = useParams<{ id: string }>();
  const { t, locale } = useI18n();
  const err = useErrorText();
  const toast = useToast();
  const router = useRouter();
  const qc = useQueryClient();
  const unit = useQuery({ queryKey: ['unit', id], queryFn: () => get<UnitDetail>(`/admin/v1/units/${id}`) });
  const invites = useQuery({ queryKey: ['unit', id, 'invitations'], queryFn: () => get<Invitation[]>(`/admin/v1/units/${id}/invitations`), enabled: !!unit.data?.owner });
  const requests = useQuery({ queryKey: ['unit', id, 'requests'], queryFn: () => get<{ items: AdminRequestSummary[] }>(`/admin/v1/units/${id}/requests?limit=50`) });
  const [editing, setEditing] = useState(false);
  const [owner, setOwner] = useState<OwnerMode | null>(null);
  const [confirm, setConfirm] = useState<Confirm>(null);
  const [busy, setBusy] = useState(false);
  const [inUse, setInUse] = useState(false);

  if ((unit.error as ApiError)?.status === 404)
    return (
      <div className="flex flex-col items-center gap-3 p-10">
        <p>{t('sys.notFound')}</p>
        <Link className="text-accent underline" href="/units">{t('units.title')}</Link>
      </div>
    );
  if (unit.isError) return <ErrorPanel onRetry={() => unit.refetch()} />;
  if (!unit.data) return <Skeleton className="h-64 w-full" />;
  const u = unit.data;
  const refresh = () => void qc.invalidateQueries({ queryKey: ['unit', id] });
  const hasHistory = (requests.data?.items.length ?? 0) > 0 || !!u.owner || (invites.data?.length ?? 0) > 0;

  async function run(kind: Exclude<Confirm, null>) {
    setBusy(true);
    try {
      if (kind === 'remove') await del(`/admin/v1/units/${id}/owner`);
      if (kind === 'deactivate') await patch(`/admin/v1/units/${id}`, { status: 'inactive' });
      if (kind === 'delete') {
        await del(`/admin/v1/units/${id}`);
        void qc.invalidateQueries({ queryKey: ['units'] });
        router.replace('/units');
        return;
      }
      setConfirm(null);
      refresh();
      void qc.invalidateQueries({ queryKey: ['units'] });
    } catch (x) {
      const e = x as ApiError;
      if (e.code === 'unit_in_use') setInUse(true);
      else toast(err(e.code));
    } finally {
      setBusy(false);
    }
  }

  const ownerId = u.owner?.personId;
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <Link href="/units" className="text-sm text-accent underline">{t('units.title')}</Link>
        <h1 className="text-xl font-semibold"><Bdi>{u.number}</Bdi></h1>
        {u.block && <span className="text-muted">{t('req.block', { block: u.block })}</span>}
        <span className="text-muted">· {t(`unitType.${u.type}` as any)}</span>
        {u.floor && <span className="text-muted">· {t('unit.floor', { floor: u.floor })}</span>}
        <Chip tone={u.status === 'active' ? 'active' : 'neutral'}>{t(`units.status.${u.status}` as any)}</Chip>
        <div className="ms-auto flex flex-wrap gap-2">
          <Button onClick={() => setEditing(true)}>{t('common.edit')}</Button>
          {u.status === 'active' ? (
            <Button onClick={() => setConfirm('deactivate')}>{t('unit.deactivate')}</Button>
          ) : (
            <Button onClick={async () => { await patch(`/admin/v1/units/${id}`, { status: 'active' }); refresh(); }}>{t('unit.reactivate')}</Button>
          )}
          {!hasHistory && <Button variant="danger" onClick={() => setConfirm('delete')}>{t('unit.deleteUnit')}</Button>}
        </div>
      </div>

      {u.status === 'inactive' && <p className="rounded-md bg-warning-bg p-3 text-sm text-warning">{t('unit.inactiveBanner')}</p>}

      <Card>
        <h2 className="mb-3 font-semibold">{t('unit.owner')}</h2>
        {!u.owner ? (
          <div className="flex flex-wrap items-center gap-3">
            <p className="text-muted">{t('unit.noOwner')}</p>
            <Button variant="primary" onClick={() => setOwner('assign')} disabled={u.status !== 'active'}>{t('unitForm.assignOwner')}</Button>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="font-medium">{u.owner.fullName}</p>
                {u.owner.phone && <a href={`tel:${u.owner.phone}`} className="block text-sm text-accent"><Bdi>{u.owner.phone}</Bdi></a>}
                {u.owner.email && <a href={`mailto:${u.owner.email}`} className="block text-sm text-accent"><Bdi>{u.owner.email}</Bdi></a>}
                <p className="text-xs text-muted">{u.owner.locale === 'en' ? 'English' : 'العربية'}</p>
              </div>
              <div className="flex flex-col items-end gap-1">
                <Chip tone={u.activation}>{t(`activation.${u.activation}`)}</Chip>
                {u.activation === 'active' && u.owner.activatedAt && <span className="text-xs text-muted">{t('unit.activatedOn', { date: fullDate(u.owner.activatedAt, locale, false) })}</span>}
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              {u.activation !== 'active' && (
                <Button variant="primary" disabled={(u.invitesRemainingToday ?? 0) === 0 || u.status !== 'active'} onClick={() => setOwner('resend')}>
                  {u.latestInvitation ? t('unit.resend') : t('owner.saveAndSend')}
                </Button>
              )}
              <Button onClick={() => setOwner('change')}>{t('unit.changeOwner')}</Button>
              <Button variant="ghost" className="text-danger" onClick={() => setConfirm('remove')}>{t('unit.removeOwner')}</Button>
            </div>
            {u.activation !== 'active' && <p className="text-xs text-muted">{t('unit.invitesLeft', { n: u.invitesRemainingToday ?? 0 })}</p>}
            {(invites.data?.length ?? 0) > 0 && (
              <div>
                <h3 className="mb-2 text-sm font-medium">{t('unit.inviteHistory')}</h3>
                <ul className="flex flex-col gap-2 text-sm">
                  {invites.data!.map((i) => (
                    <li key={i.id} className="rounded-md border border-line p-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <span>{fullDate(i.createdAt, locale)}</span>
                        <Chip tone={i.state === 'pending' ? 'invited' : i.state === 'used' ? 'active' : 'neutral'}>{t(`inv.${i.state}`)}</Chip>
                        {i.createdBy && <span className="text-xs text-muted">{i.createdBy}</span>}
                      </div>
                      <ul className="mt-1 flex flex-wrap gap-3 text-xs">
                        {i.deliveries.map((d, k) => (
                          <li key={k} className={d.status === 'failed' || d.status === 'undelivered' ? 'text-danger' : 'text-muted'}>
                            {t(`channel.${d.channel}`)} <Bdi>{d.destinationMasked}</Bdi>: {t(`delivery.${d.status}`)}
                            {d.failureReason && <span> · {d.failureReason}</span>}
                          </li>
                        ))}
                      </ul>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </Card>

      <Card>
        <h2 className="mb-3 font-semibold">{t('unit.requests')}</h2>
        {requests.data && requests.data.items.length === 0 ? (
          <p className="text-sm text-muted">{t('unit.noRequests')}</p>
        ) : (
          <table className="w-full text-sm">
            <tbody>
              {requests.data?.items.map((r) => (
                <tr key={r.id} className="cursor-pointer border-t border-line hover:bg-canvas" onClick={() => router.push(`/requests/${r.ref}`)}>
                  <td className="px-2 py-2"><Link className="text-accent" href={`/requests/${r.ref}`}><Bdi>{r.ref}</Bdi></Link></td>
                  <td className="px-2 py-2"><CategoryLabel code={r.categoryCode} /></td>
                  <td className="px-2 py-2"><StatusChip status={r.status} /></td>
                  <td className="px-2 py-2"><OutcomeBadge r={r} /></td>
                  <td className="px-2 py-2 text-muted">{shortDate(r.createdAt, locale)}</td>
                  <td className="px-2 py-2 text-xs text-muted">{ownerId && r.residentName !== u.owner?.fullName ? t('unit.previousOwner') : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      {u.notes && (
        <Card>
          <h2 className="mb-2 font-semibold">{t('unit.notes')}</h2>
          <p dir="auto" className="whitespace-pre-wrap text-sm">{u.notes}</p>
        </Card>
      )}

      <UnitForm open={editing} unit={u} onClose={() => { setEditing(false); refresh(); }} />
      {owner && <OwnerDialog unit={u} mode={owner} onClose={() => { setOwner(null); refresh(); void qc.invalidateQueries({ queryKey: ['unit', id, 'invitations'] }); }} />}
      <Dialog
        open={confirm !== null}
        onClose={() => { setConfirm(null); setInUse(false); }}
        title={confirm === 'remove' ? t('unit.removeOwner') : confirm === 'deactivate' ? t('unit.deactivate') : t('unit.deleteUnit')}
        footer={
          inUse ? (
            <>
              <Button onClick={() => { setConfirm(null); setInUse(false); }}>{t('common.cancel')}</Button>
              <Button variant="primary" busy={busy} onClick={() => { setInUse(false); void run('deactivate'); }}>{t('unit.deactivate')}</Button>
            </>
          ) : (
            <>
              <Button onClick={() => setConfirm(null)}>{t('common.cancel')}</Button>
              <Button variant={confirm === 'deactivate' ? 'primary' : 'danger'} busy={busy} onClick={() => confirm && run(confirm)}>
                {confirm === 'remove' ? t('unit.removeOwner') : confirm === 'deactivate' ? t('unit.deactivate') : t('unit.deleteUnit')}
              </Button>
            </>
          )
        }
      >
        <p>
          {inUse
            ? t('confirm.unitInUse')
            : confirm === 'remove'
              ? t('confirm.removeOwner', { name: u.owner?.fullName ?? '', unit: u.number })
              : confirm === 'deactivate'
                ? t('confirm.deactivate', { unit: u.number })
                : t('confirm.delete', { unit: u.number })}
        </p>
      </Dialog>
    </div>
  );
}
