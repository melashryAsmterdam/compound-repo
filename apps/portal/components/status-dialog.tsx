'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { ApiError, post, type AdminRequestSummary } from '@/lib/api';
import { useErrorText, useI18n } from '@/lib/i18n';
import { Bdi, Button, Dialog, Field, Textarea, useToast } from './ui';

/** P-08: confirm a status change, with an optional note posted right after. */
export function StatusDialog({ request, to, onClose, onDone, onStart }: { request: Pick<AdminRequestSummary, 'id' | 'ref' | 'version'>; to: 'in_progress' | 'done'; onClose: () => void; onDone?: () => void; onStart?: () => void }) {
  const { t } = useI18n();
  const err = useErrorText();
  const toast = useToast();
  const qc = useQueryClient();
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  async function confirm() {
    onStart?.();
    setBusy(true);
    try {
      await post(`/admin/v1/requests/${request.id}/transitions`, { to, expectedVersion: request.version });
      if (note.trim()) await post(`/admin/v1/requests/${request.id}/comments`, { body: note.trim() });
      toast(t('status.updated'));
    } catch (x) {
      toast(err((x as ApiError).code)); // invalid_transition / version_conflict → view reloads
    } finally {
      setBusy(false);
      void qc.invalidateQueries({ queryKey: ['request', request.id] });
      void qc.invalidateQueries({ queryKey: ['counters'] });
      onDone?.();
      onClose();
    }
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title={
        <>
          {t(`status.dialog.${to}`)} <Bdi className="text-muted">{request.ref}</Bdi>
        </>
      }
      footer={
        <>
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button variant="primary" busy={busy} onClick={confirm}>
            {t('status.dialog.confirm')}
          </Button>
        </>
      }
    >
      {to === 'done' && <p className="text-sm text-muted">{t('status.dialog.doneHint')}</p>}
      <Field label={`${t('status.dialog.note')} (${t('common.optional')})`} htmlFor="note">
        <Textarea id="note" dir="auto" maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} />
      </Field>
    </Dialog>
  );
}
