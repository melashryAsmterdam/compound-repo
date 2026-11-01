'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { normaliseSaudiMobile } from '@compound/domain';
import { SMS, fill, type Locale } from '@compound/i18n';
import { ApiError, post, put, type UnitDetail } from '@/lib/api';
import { useErrorText, useI18n } from '@/lib/i18n';
import { useMe } from '@/lib/queries';
import { Bdi, Button, Checkbox, Dialog, Field, Input, Radio, useToast } from './ui';

export type OwnerMode = 'assign' | 'change' | 'resend';

/** P-12: assign / change owner and send the activation link. */
export function OwnerDialog({ unit, mode, onClose }: { unit: UnitDetail; mode: OwnerMode; onClose: () => void }) {
  const { t, locale } = useI18n();
  const err = useErrorText();
  const toast = useToast();
  const qc = useQueryClient();
  const me = useMe();
  const o = mode === 'resend' ? unit.owner : null;
  const [name, setName] = useState(o?.fullName ?? '');
  const [phone, setPhone] = useState(o?.phone ?? '');
  const [email, setEmail] = useState(o?.email ?? '');
  const [lang, setLang] = useState<Locale>((o?.locale as Locale) ?? 'ar');
  const [sms, setSms] = useState(true);
  const [mail, setMail] = useState(false);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState(false);

  const phoneOk = !phone.trim() || normaliseSaudiMobile(phone) !== null;
  const emailOk = !email.trim() || /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim());
  const canSms = !!phone.trim() && phoneOk;
  const canMail = !!email.trim() && emailOk;
  useEffect(() => {
    if (!canSms) setSms(false);
    else if (!mail) setSms(true);
    if (!canMail) setMail(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canSms, canMail]);
  const channels = [...(sms && canSms ? ['sms'] : []), ...(mail && canMail ? ['email'] : [])] as ('sms' | 'email')[];
  const valid = name.trim().length >= 2 && (canSms || canMail) && phoneOk && emailOk;
  const compound = me.data?.compound;
  const smsPreview = fill(SMS[lang].invitation!, { compound: (lang === 'ar' ? compound?.nameAr : compound?.nameEn) ?? '', unit: unit.number, link: 'go.example.sa/a/…' }, false);

  async function save(send: boolean) {
    setBusy(true);
    setErrors({});
    setError(null);
    try {
      if (mode !== 'resend') {
        await put(`/admin/v1/units/${unit.id}/owner`, { fullName: name.trim(), phone: phone.trim() || undefined, email: email.trim() || undefined, locale: lang });
      }
      if (send) {
        await post(`/admin/v1/units/${unit.id}/invitations`, { channels });
        toast(t('owner.sent', { channels: channels.map((c) => t(`channel.${c}`)).join(' + ') }));
      } else toast(t('owner.saved'));
      void qc.invalidateQueries({ queryKey: ['unit', unit.id] });
      void qc.invalidateQueries({ queryKey: ['units'] });
      onClose();
    } catch (x) {
      const e = x as ApiError;
      if (e.code === 'validation_failed' && e.body.errors) setErrors(Object.fromEntries(e.body.errors.map((er) => [er.field, err(er.code)])));
      else setError(err(e.code));
    } finally {
      setBusy(false);
    }
  }

  const title = mode === 'assign' ? t('owner.assignTitle') : mode === 'change' ? t('owner.changeTitle') : t('owner.resendTitle');
  return (
    <Dialog
      open
      wide
      onClose={onClose}
      title={
        <>
          {title} · <Bdi>{unit.number}</Bdi>
        </>
      }
      footer={
        <>
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          {mode !== 'resend' && (
            <Button busy={busy} disabled={!valid} onClick={() => save(false)}>
              {t('owner.saveOnly')}
            </Button>
          )}
          <Button variant="primary" busy={busy} disabled={!valid || channels.length === 0} onClick={() => save(true)}>
            {mode === 'resend' ? t('unit.resend') : t('owner.saveAndSend')}
          </Button>
        </>
      }
    >
      {mode === 'change' && unit.owner && (
        <div className="rounded-md bg-warning-bg p-2 text-sm text-warning">
          <p>{t('owner.changeWarn', { name: unit.owner.fullName ?? '' })}</p>
          {unit.openRequestCount > 0 && <p className="mt-1">{t('owner.changeMovesRequests', { n: unit.openRequestCount })}</p>}
        </div>
      )}
      {mode === 'resend' && <p className="text-sm text-muted">{t('owner.resendNote')} · {t('unit.invitesLeft', { n: unit.invitesRemainingToday ?? 0 })}</p>}
      <Field label={t('owner.fullName')} htmlFor="o-name" error={errors.fullName}>
        <Input id="o-name" dir="auto" maxLength={120} value={name} disabled={mode === 'resend'} onChange={(e) => setName(e.target.value)} />
      </Field>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label={`${t('owner.mobile')} (${t('common.optional')})`} htmlFor="o-phone" error={!phoneOk ? err('phone_invalid') : errors.phone}>
          <Input id="o-phone" dir="ltr" inputMode="tel" placeholder={t('owner.mobileHint')} value={phone} disabled={mode === 'resend'} aria-invalid={!phoneOk} onChange={(e) => setPhone(e.target.value)} />
        </Field>
        <Field label={`${t('owner.email')} (${t('common.optional')})`} htmlFor="o-email" error={!emailOk ? err('validation_failed') : errors.email}>
          <Input id="o-email" dir="ltr" type="email" value={email} disabled={mode === 'resend'} aria-invalid={!emailOk} onChange={(e) => setEmail(e.target.value)} />
        </Field>
      </div>
      {mode !== 'resend' && (
        <fieldset className="flex flex-wrap items-center gap-4">
          <legend className="text-sm font-medium">{t('owner.language')}</legend>
          <Radio name="lang" label="العربية" checked={lang === 'ar'} onChange={() => setLang('ar')} />
          <Radio name="lang" label="English" checked={lang === 'en'} onChange={() => setLang('en')} />
        </fieldset>
      )}
      <fieldset className="flex flex-wrap items-center gap-4">
        <legend className="text-sm font-medium">{t('owner.sendBy')}</legend>
        <Checkbox label={t('channel.sms')} checked={sms} disabled={!canSms} onChange={(e) => setSms(e.target.checked)} />
        <Checkbox label={t('channel.email')} checked={mail} disabled={!canMail} onChange={(e) => setMail(e.target.checked)} />
      </fieldset>
      <button className="self-start text-sm text-accent underline" aria-expanded={preview} onClick={() => setPreview((p) => !p)}>
        {t('owner.preview')}
      </button>
      {preview && (
        <p dir={lang === 'ar' ? 'rtl' : 'ltr'} lang={lang} className="rounded-md bg-canvas p-3 text-sm">
          {smsPreview}
        </p>
      )}
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
      <span hidden>{locale}</span>
    </Dialog>
  );
}
