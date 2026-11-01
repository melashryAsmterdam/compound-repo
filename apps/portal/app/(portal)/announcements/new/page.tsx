'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Bdi, Button, Card, Checkbox, Dialog, Field, Input, PageHeader, Radio, Select, Textarea, useToast, cx } from '@/components/ui';
import { ApiError, get, post, qs, uploadFile, type AdminAnnouncement, type UnitSummary } from '@/lib/api';
import { formatDual, fullDate, riyadhToIso, riyadhToday } from '@/lib/format';
import { useErrorText, useI18n } from '@/lib/i18n';
import { useBlocks, useMe } from '@/lib/queries';

type Langs = 'ar' | 'en' | 'both';
type Aud = 'all' | 'blocks' | 'units';
const DRAFT = 'cs_draft_announcement';

export default function NewAnnouncement() {
  const { t, locale } = useI18n();
  const err = useErrorText();
  const toast = useToast();
  const router = useRouter();
  const qc = useQueryClient();
  const me = useMe();
  const blocks = useBlocks();
  const [langs, setLangs] = useState<Langs>('both');
  const [titleAr, setTitleAr] = useState('');
  const [bodyAr, setBodyAr] = useState('');
  const [titleEn, setTitleEn] = useState('');
  const [bodyEn, setBodyEn] = useState('');
  const [aud, setAud] = useState<Aud>('all');
  const [selBlocks, setSelBlocks] = useState<string[]>([]);
  const [selUnits, setSelUnits] = useState<UnitSummary[]>([]);
  const [unitQ, setUnitQ] = useState('');
  const [sms, setSms] = useState(false);
  const [when, setWhen] = useState<'now' | 'later'>('now');
  const [date, setDate] = useState(riyadhToday());
  const [time, setTime] = useState('09:00');
  const [attachment, setAttachment] = useState<{ id: string; name: string } | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [previewLang, setPreviewLang] = useState<'ar' | 'en'>(locale);

  // Local auto-saved draft (spec P-15).
  useEffect(() => {
    const raw = localStorage.getItem(DRAFT);
    if (!raw) return;
    try {
      const d = JSON.parse(raw);
      setLangs(d.langs ?? 'both'); setTitleAr(d.titleAr ?? ''); setBodyAr(d.bodyAr ?? ''); setTitleEn(d.titleEn ?? ''); setBodyEn(d.bodyEn ?? '');
    } catch { /* ignore */ }
  }, []);
  useEffect(() => {
    localStorage.setItem(DRAFT, JSON.stringify({ langs, titleAr, bodyAr, titleEn, bodyEn }));
  }, [langs, titleAr, bodyAr, titleEn, bodyEn]);

  const audience = { type: aud, ...(aud === 'blocks' ? { blocks: selBlocks } : {}), ...(aud === 'units' ? { unitIds: selUnits.map((u) => u.id) } : {}) };
  const audienceReady = aud === 'all' || (aud === 'blocks' && selBlocks.length > 0) || (aud === 'units' && selUnits.length > 0);
  const preview = useQuery({
    queryKey: ['audience-preview', audience, sms],
    enabled: audienceReady,
    queryFn: () => post<{ recipientCount: number; smsCount: number }>('/admin/v1/announcements/audience-preview', { audience, sendSms: sms }),
  });
  const unitSearch = useQuery({
    queryKey: ['unit-search', unitQ],
    enabled: aud === 'units' && unitQ.trim().length > 0,
    queryFn: () => get<{ items: UnitSummary[] }>(`/admin/v1/units${qs({ q: unitQ, activation: 'active' })}`),
  });

  const needAr = langs !== 'en';
  const needEn = langs !== 'ar';
  const scheduledIso = when === 'later' ? riyadhToIso(date, time) : null;
  const tooSoon = scheduledIso !== null && new Date(scheduledIso).getTime() < Date.now() + 5 * 60_000;
  const textOk = (!needAr || (titleAr.trim() && bodyAr.trim())) && (!needEn || (titleEn.trim() && bodyEn.trim()));
  const n = preview.data?.recipientCount;
  const canSend = textOk && audienceReady && !!n && !tooSoon && !uploading;
  const reach = !audienceReady ? '' : preview.isFetching || n === undefined ? '…' : sms ? t('ann.reachSms', { n, sms: preview.data!.smsCount }) : t('ann.reach', { n });

  async function onFile(file: File | undefined) {
    if (!file) return;
    setUploading(true);
    setUploadError(false);
    try {
      const id = await uploadFile(file, 'announcement_attachment');
      setAttachment({ id, name: file.name });
    } catch {
      setUploadError(true);
    } finally {
      setUploading(false);
    }
  }

  async function send() {
    setBusy(true);
    setErrors({});
    setError(null);
    try {
      const a = await post<AdminAnnouncement>('/admin/v1/announcements', {
        languages: langs,
        ...(needAr ? { titleAr: titleAr.trim(), bodyAr: bodyAr.trim() } : {}),
        ...(needEn ? { titleEn: titleEn.trim(), bodyEn: bodyEn.trim() } : {}),
        attachmentUploadId: attachment?.id ?? null,
        audience,
        sendSms: sms,
        scheduledAt: scheduledIso,
      });
      localStorage.removeItem(DRAFT);
      void qc.invalidateQueries({ queryKey: ['announcements'] });
      if (a.status === 'scheduled') {
        toast(t('ann.scheduledToast'));
        router.push('/announcements?tab=scheduled');
      } else router.push(`/announcements/${a.id}`);
    } catch (x) {
      const e = x as ApiError;
      setConfirm(false);
      if (e.body.errors) setErrors(Object.fromEntries(e.body.errors.map((er) => [er.field, err(er.code)])));
      setError(err(e.code));
    } finally {
      setBusy(false);
    }
  }

  const pTitle = previewLang === 'ar' ? titleAr || titleEn : titleEn || titleAr;
  const pBody = previewLang === 'ar' ? bodyAr || bodyEn : bodyEn || bodyAr;
  const compoundName = previewLang === 'ar' ? me.data?.compound.nameAr : me.data?.compound.nameEn;

  return (
    <>
      <PageHeader title={t('ann.new')} />
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1fr_22rem]">
        <Card className="flex flex-col gap-4">
          <fieldset className="flex flex-wrap gap-4">
            <legend className="mb-1 text-sm font-medium">{t('ann.languages')}</legend>
            {(['ar', 'en', 'both'] as const).map((l) => <Radio key={l} name="langs" label={t(`ann.lang.${l}`)} checked={langs === l} onChange={() => setLangs(l)} />)}
          </fieldset>
          {needAr && (
            <div dir="rtl" lang="ar" className="flex flex-col gap-3">
              <Field label={t('ann.titleAr')} htmlFor="tAr" error={errors.titleAr} hint={<Bdi>{titleAr.length} / 80</Bdi>}>
                <Input id="tAr" maxLength={80} value={titleAr} onChange={(e) => setTitleAr(e.target.value)} />
              </Field>
              <Field label={t('ann.bodyAr')} htmlFor="bAr" error={errors.bodyAr} hint={<Bdi>{bodyAr.length} / 2000</Bdi>}>
                <Textarea id="bAr" rows={5} maxLength={2000} value={bodyAr} onChange={(e) => setBodyAr(e.target.value)} />
              </Field>
            </div>
          )}
          {needEn && (
            <div dir="ltr" lang="en" className="flex flex-col gap-3">
              <Field label={t('ann.titleEn')} htmlFor="tEn" error={errors.titleEn} hint={<Bdi>{titleEn.length} / 80</Bdi>}>
                <Input id="tEn" maxLength={80} value={titleEn} onChange={(e) => setTitleEn(e.target.value)} />
              </Field>
              <Field label={t('ann.bodyEn')} htmlFor="bEn" error={errors.bodyEn} hint={<Bdi>{bodyEn.length} / 2000</Bdi>}>
                <Textarea id="bEn" rows={5} maxLength={2000} value={bodyEn} onChange={(e) => setBodyEn(e.target.value)} />
              </Field>
            </div>
          )}
          <Field label={t('ann.attachment')} htmlFor="att">
            {attachment ? (
              <div className="flex items-center gap-2 text-sm">
                <Bdi>{attachment.name}</Bdi>
                <Button variant="ghost" onClick={() => setAttachment(null)}>{t('ann.remove')}</Button>
              </div>
            ) : (
              <input id="att" type="file" accept="image/jpeg,image/png,application/pdf" className="text-sm" onChange={(e) => onFile(e.target.files?.[0])} />
            )}
            {uploading && <span className="text-xs text-muted">{t('ann.uploading')}</span>}
            {uploadError && <span className="text-xs text-danger">{t('ann.uploadFailed')}</span>}
          </Field>
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1 text-sm font-medium">{t('ann.audience')}</legend>
            <Radio name="aud" label={t('ann.aud.all')} checked={aud === 'all'} onChange={() => setAud('all')} />
            <Radio name="aud" label={t('ann.aud.blocks')} checked={aud === 'blocks'} onChange={() => setAud('blocks')} />
            {aud === 'blocks' && (
              <div className="ms-6 flex flex-wrap gap-3">
                {blocks.data?.map((b) => (
                  <Checkbox key={b.block} label={<>{b.block} <span className="text-xs text-muted">(<Bdi>{b.activeResidentCount}</Bdi>)</span></>} checked={selBlocks.includes(b.block)} onChange={(e) => setSelBlocks((s) => (e.target.checked ? [...s, b.block] : s.filter((x) => x !== b.block)))} />
                ))}
              </div>
            )}
            <Radio name="aud" label={t('ann.aud.units')} checked={aud === 'units'} onChange={() => setAud('units')} />
            {aud === 'units' && (
              <div className="ms-6 flex flex-col gap-2">
                <div className="flex flex-wrap gap-1">
                  {selUnits.map((u) => (
                    <button key={u.id} className="rounded-full bg-info-bg px-2 py-0.5 text-xs text-info" onClick={() => setSelUnits((s) => s.filter((x) => x.id !== u.id))} aria-label={`${t('ann.remove')} ${u.number}`}>
                      <Bdi>{u.number}</Bdi> ×
                    </button>
                  ))}
                </div>
                <Input type="search" placeholder={t('units.filter.search')} value={unitQ} onChange={(e) => setUnitQ(e.target.value)} />
                <div className="flex flex-wrap gap-1">
                  {unitSearch.data?.items.filter((u) => !selUnits.some((s) => s.id === u.id)).slice(0, 12).map((u) => (
                    <button key={u.id} className="rounded-full border border-line px-2 py-0.5 text-xs hover:bg-canvas" onClick={() => setSelUnits((s) => [...s, u])}>
                      + <Bdi>{u.number}</Bdi> {u.owner?.fullName}
                    </button>
                  ))}
                </div>
              </div>
            )}
            <p className={cx('text-sm', n === 0 ? 'text-danger' : 'text-muted')} aria-live="polite">{n === 0 ? t('ann.zero') : reach}</p>
          </fieldset>
          <div>
            <Checkbox label={t('ann.sms')} checked={sms} onChange={(e) => setSms(e.target.checked)} />
            <p className="ms-6 text-xs text-muted">{t('ann.smsHelp')}</p>
          </div>
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1 text-sm font-medium">{t('ann.when')}</legend>
            <Radio name="when" label={t('ann.now')} checked={when === 'now'} onChange={() => setWhen('now')} />
            <Radio name="when" label={t('ann.schedule')} checked={when === 'later'} onChange={() => setWhen('later')} />
            {when === 'later' && (
              <div className="ms-6 grid max-w-md grid-cols-2 gap-3">
                <Field label={t('composer.date')} htmlFor="sd" hint={formatDual(`${date}T09:00:00Z`, locale).hijri}>
                  <Input id="sd" type="date" min={riyadhToday()} value={date} onChange={(e) => setDate(e.target.value)} />
                </Field>
                <Field label={t('composer.from')} htmlFor="st" error={tooSoon ? t('ann.minAhead') : null}>
                  <Input id="st" type="time" step={900} value={time} onChange={(e) => setTime(e.target.value)} />
                </Field>
              </div>
            )}
          </fieldset>
          {error && <p role="alert" className="text-sm text-danger">{error}</p>}
          <div className="flex justify-end gap-2">
            <Button onClick={() => { if (!(titleAr || bodyAr || titleEn || bodyEn) || window.confirm(t('common.discard'))) { localStorage.removeItem(DRAFT); router.push('/announcements'); } }}>{t('common.cancel')}</Button>
            <Button variant="primary" disabled={!canSend} onClick={() => setConfirm(true)}>
              {when === 'now' ? t('ann.now') : t('ann.schedule')}{n ? <> · <Bdi>{n}</Bdi></> : null}
            </Button>
          </div>
        </Card>

        <aside aria-label="preview" className="flex flex-col gap-3">
          <div className="flex items-center gap-2 text-sm">
            {t('ann.previewIn')}
            <Select value={previewLang} onChange={(e) => setPreviewLang(e.target.value as 'ar' | 'en')} className="w-auto">
              <option value="ar">العربية</option>
              <option value="en">English</option>
            </Select>
          </div>
          <div dir={previewLang === 'ar' ? 'rtl' : 'ltr'} lang={previewLang} className="mx-auto w-72 rounded-[2rem] border-8 border-ink bg-canvas p-3">
            <div className="mb-3 rounded-xl bg-surface p-2 text-xs shadow">
              <p className="font-semibold">{compoundName}</p>
              <p className="truncate">{pTitle}</p>
            </div>
            <div className="rounded-xl bg-surface p-3">
              <p className="font-semibold">{pTitle}</p>
              <p className="text-xs text-muted">{scheduledIso ? fullDate(scheduledIso, previewLang, false) : formatDual(new Date(), previewLang).text}</p>
              <p className="mt-2 whitespace-pre-wrap text-sm">{pBody}</p>
              {attachment && <p className="mt-2 text-xs text-accent">📎 <Bdi>{attachment.name}</Bdi></p>}
            </div>
          </div>
        </aside>
      </div>
      <Dialog
        open={confirm}
        onClose={() => setConfirm(false)}
        title={when === 'later' ? t('ann.confirmSchedule', { when: fullDate(scheduledIso, locale), n: n ?? 0 }) : sms ? t('ann.confirmNowSms', { n: n ?? 0, sms: preview.data?.smsCount ?? 0 }) : t('ann.confirmNow', { n: n ?? 0 })}
        footer={
          <>
            <Button onClick={() => setConfirm(false)}>{t('common.cancel')}</Button>
            <Button variant="primary" busy={busy} onClick={send}>{when === 'now' ? t('ann.now') : t('ann.schedule')}</Button>
          </>
        }
      >
        <span />
      </Dialog>
    </>
  );
}
