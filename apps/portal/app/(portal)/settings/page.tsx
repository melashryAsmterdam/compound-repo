'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import { Bdi, Button, Card, Field, Input, PageHeader, cx, useToast } from '@/components/ui';
import { ApiError, get, patch, uploadFile, type Compound } from '@/lib/api';
import { useErrorText, useI18n } from '@/lib/i18n';
import { useMe } from '@/lib/queries';

function Settings() {
  const { t, locale, setLocale } = useI18n();
  const err = useErrorText();
  const toast = useToast();
  const qc = useQueryClient();
  const router = useRouter();
  const tab = useSearchParams().get('tab') === 'account' ? 'account' : 'profile';
  const me = useMe();
  const c = useQuery({ queryKey: ['compound'], queryFn: () => get<Compound>('/admin/v1/compound') });
  const [f, setF] = useState({ nameAr: '', nameEn: '', contactPhone: '' });
  const [logo, setLogo] = useState<string | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  useEffect(() => {
    if (c.data) setF({ nameAr: c.data.nameAr, nameEn: c.data.nameEn, contactPhone: c.data.contactPhone });
  }, [c.data]);
  const dirty = !!c.data && (f.nameAr !== c.data.nameAr || f.nameEn !== c.data.nameEn || f.contactPhone !== c.data.contactPhone || logo !== undefined);

  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (dirty) e.preventDefault();
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  async function save() {
    setBusy(true);
    setErrors({});
    try {
      await patch('/admin/v1/compound', { nameAr: f.nameAr.trim(), nameEn: f.nameEn.trim(), contactPhone: f.contactPhone.trim(), ...(logo !== undefined ? { logoUploadId: logo } : {}) });
      setLogo(undefined);
      toast(t('settings.saved'));
      void qc.invalidateQueries({ queryKey: ['compound'] });
      void qc.invalidateQueries({ queryKey: ['me'] });
    } catch (x) {
      const e = x as ApiError;
      setErrors(e.body.errors ? Object.fromEntries(e.body.errors.map((er) => [er.field, err(er.code)])) : { _: err(e.code) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader title={t('settings.title')} />
      <div role="tablist" className="mb-3 flex gap-2 border-b border-line">
        {(['profile', 'account'] as const).map((k) => (
          <button key={k} role="tab" aria-selected={tab === k} onClick={() => router.replace(`/settings${k === 'account' ? '?tab=account' : ''}`)} className={cx('-mb-px border-b-2 px-3 py-2 text-sm', tab === k ? 'border-accent font-medium' : 'border-transparent text-muted')}>
            {t(`settings.${k}`)}
          </button>
        ))}
      </div>
      {tab === 'profile' ? (
        <Card className="flex max-w-xl flex-col gap-4">
          <Field label={t('settings.nameAr')} htmlFor="nameAr">
            <Input id="nameAr" dir="rtl" lang="ar" maxLength={120} value={f.nameAr} onChange={(e) => setF({ ...f, nameAr: e.target.value })} />
          </Field>
          <Field label={t('settings.nameEn')} htmlFor="nameEn">
            <Input id="nameEn" dir="ltr" lang="en" maxLength={120} value={f.nameEn} onChange={(e) => setF({ ...f, nameEn: e.target.value })} />
          </Field>
          <Field label={t('settings.phone')} htmlFor="phone" error={errors.contactPhone}>
            <Input id="phone" dir="ltr" inputMode="tel" value={f.contactPhone} onChange={(e) => setF({ ...f, contactPhone: e.target.value })} />
          </Field>
          <Field label={t('settings.logo')} htmlFor="logo">
            <div className="flex items-center gap-3">
              {c.data?.logoUrl && logo === undefined && <img src={c.data.logoUrl} alt="" className="size-14 rounded border border-line object-cover" />}
              <input
                id="logo"
                type="file"
                accept="image/png,image/jpeg"
                className="text-sm"
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  if (file.size > 2 * 1024 * 1024) return setErrors({ logo: err('upload_invalid') });
                  try {
                    setLogo(await uploadFile(file, 'compound_logo'));
                  } catch {
                    setErrors({ logo: err('upload_invalid') });
                  }
                }}
              />
            </div>
          </Field>
          <p className="text-sm text-muted">
            {t('settings.timezone')}: <Bdi>{c.data?.timezone ?? 'Asia/Riyadh'}</Bdi>
          </p>
          {errors._ && <p role="alert" className="text-sm text-danger">{errors._}</p>}
          <div>
            <Button variant="primary" busy={busy} disabled={!dirty || !f.nameAr.trim() || !f.nameEn.trim()} onClick={save}>
              {t('common.save')}
            </Button>
          </div>
        </Card>
      ) : (
        <Card className="flex max-w-xl flex-col gap-3 text-sm">
          <p><span className="text-muted">{t('settings.name')}: </span>{me.data?.fullName}</p>
          <p><span className="text-muted">{t('auth.email')}: </span><Bdi>{me.data?.email}</Bdi></p>
          <div className="flex items-center gap-2">
            <span className="text-muted">{t('settings.language')}:</span>
            <Button onClick={() => setLocale(locale === 'ar' ? 'en' : 'ar')}>{locale === 'ar' ? 'العربية → English' : 'English → العربية'}</Button>
          </div>
          <p className="text-muted">{t('settings.passwordHelp')}</p>
        </Card>
      )}
    </>
  );
}

export default function Page() {
  return (
    <Suspense>
      <Settings />
    </Suspense>
  );
}
