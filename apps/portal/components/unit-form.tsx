'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { toWesternDigits } from '@compound/domain';
import { ApiError, patch, post, type UnitDetail } from '@/lib/api';
import { useErrorText, useI18n } from '@/lib/i18n';
import { useBlocks } from '@/lib/queries';
import { Button, Field, Input, Select, Sheet, Textarea, useToast } from './ui';

type Form = { number: string; block: string; type: string; floor: string; notes: string };
const empty: Form = { number: '', block: '', type: 'villa', floor: '', notes: '' };

/** P-10: add / edit unit side panel. */
export function UnitForm({ open, unit, onClose, onCreated }: { open: boolean; unit?: UnitDetail | null; onClose: () => void; onCreated?: (u: UnitDetail) => void }) {
  const { t } = useI18n();
  const err = useErrorText();
  const toast = useToast();
  const qc = useQueryClient();
  const blocks = useBlocks();
  const initial: Form = unit ? { number: unit.number, block: unit.block ?? '', type: unit.type, floor: unit.floor ?? '', notes: unit.notes ?? '' } : empty;
  const [f, setF] = useState<Form>(initial);
  const [busy, setBusy] = useState(false);
  const [numberError, setNumberError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (open) {
      setF(initial);
      setNumberError(null);
      setError(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, unit?.id]);
  const dirty = JSON.stringify(f) !== JSON.stringify(initial);

  const close = () => {
    if (dirty && !window.confirm(t('common.discard'))) return;
    onClose();
  };

  async function save(another: boolean) {
    setBusy(true);
    setNumberError(null);
    setError(null);
    const body = { number: toWesternDigits(f.number.trim()), block: f.block.trim() || null, type: f.type, floor: f.floor.trim() || null, notes: f.notes.trim() || null };
    try {
      const saved = unit ? await patch<UnitDetail>(`/admin/v1/units/${unit.id}`, body) : await post<UnitDetail>('/admin/v1/units', body);
      void qc.invalidateQueries({ queryKey: ['units'] });
      void qc.invalidateQueries({ queryKey: ['blocks'] });
      void qc.invalidateQueries({ queryKey: ['unit', saved.id] });
      if (!unit) {
        toast(t('unitForm.added', { number: saved.number }), onCreated ? { label: t('unitForm.assignOwner'), onClick: () => onCreated(saved) } : undefined);
        if (another) {
          setF({ ...empty, block: f.block, type: f.type });
          return;
        }
      }
      onClose();
    } catch (x) {
      const e = x as ApiError;
      if (e.code === 'unit_number_taken') setNumberError(err(e.code));
      else setError(err(e.code));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet
      open={open}
      onClose={close}
      title={unit ? t('unitForm.editTitle', { number: unit.number }) : t('unitForm.addTitle')}
      footer={
        <>
          <Button onClick={close}>{t('common.cancel')}</Button>
          {!unit && (
            <Button busy={busy} disabled={!f.number.trim()} onClick={() => save(true)}>
              {t('unitForm.saveAnother')}
            </Button>
          )}
          <Button variant="primary" busy={busy} disabled={!f.number.trim()} onClick={() => save(false)}>
            {t('common.save')}
          </Button>
        </>
      }
    >
      <Field label={t('unitForm.number')} htmlFor="u-number" error={numberError}>
        <Input id="u-number" dir="ltr" maxLength={30} required value={f.number} aria-invalid={!!numberError} onChange={(e) => setF({ ...f, number: e.target.value })} />
      </Field>
      <Field label={`${t('unitForm.block')} (${t('common.optional')})`} htmlFor="u-block">
        <Input id="u-block" list="blocks" maxLength={30} value={f.block} onChange={(e) => setF({ ...f, block: e.target.value })} />
        <datalist id="blocks">{blocks.data?.map((b) => <option key={b.block} value={b.block} />)}</datalist>
      </Field>
      <Field label={t('unitForm.type')} htmlFor="u-type">
        <Select id="u-type" value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })}>
          {(['villa', 'apartment', 'townhouse', 'other'] as const).map((x) => (
            <option key={x} value={x}>
              {t(`unitType.${x}`)}
            </option>
          ))}
        </Select>
      </Field>
      <Field label={`${t('unitForm.floor')} (${t('common.optional')})`} htmlFor="u-floor">
        <Input id="u-floor" maxLength={10} value={f.floor} onChange={(e) => setF({ ...f, floor: e.target.value })} />
      </Field>
      <Field label={`${t('unitForm.notes')} (${t('common.optional')})`} htmlFor="u-notes">
        <Textarea id="u-notes" dir="auto" maxLength={500} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} />
      </Field>
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
    </Sheet>
  );
}
