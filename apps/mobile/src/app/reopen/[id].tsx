import { useQueryClient } from '@tanstack/react-query';
import * as Crypto from 'expo-crypto';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert } from 'react-native';
import { PhotoPicker } from '@/components/PhotoPicker';
import { Screen } from '@/components/Screen';
import { useToast } from '@/components/Toast';
import { Button, Field, Text } from '@/components/ui';
import { useRequestActions } from '@/lib/actions';
import { unwrap } from '@/lib/api';
import { photosBlocking, REOPEN_PHOTOS_MAX, REOPEN_REASON_MAX, type DraftPhoto } from '@/lib/drafts';
import { pickPhoto, uploadPhoto, type PickSource } from '@/lib/photos';
import { invalidateRequest, qk, useRequest } from '@/lib/queries';
import { useSession } from '@/lib/session';
import { colors } from '@/lib/theme';

/** M-17 Reopen sheet: reason (1–500) and up to 3 photos (R4-AC3). */
export default function Reopen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t } = useTranslation();
  const toast = useToast();
  const qc = useQueryClient();
  const { api } = useSession();
  const q = useRequest(id!);
  const { onError } = useRequestActions();
  const [reason, setReason] = useState('');
  const [photos, setPhotos] = useState<DraftPhoto[]>([]);
  const [busy, setBusy] = useState(false);
  const [touched, setTouched] = useState(false);

  const setPhoto = (localId: string, patch: Partial<DraftPhoto>) =>
    setPhotos((ps) => ps.map((p) => (p.localId === localId ? { ...p, ...patch } : p)));
  const upload = async (p: DraftPhoto) => {
    setPhoto(p.localId, { state: 'uploading' });
    try {
      setPhoto(p.localId, { state: 'ready', uploadId: await uploadPhoto(api, p.uri, 'reopen_photo') });
    } catch {
      setPhoto(p.localId, { state: 'failed' });
    }
  };
  const add = async (source: PickSource) => {
    const r = await pickPhoto(source);
    if (r.kind !== 'ok') return r.kind;
    const p: DraftPhoto = { localId: Crypto.randomUUID(), uri: r.uri, width: r.width, height: r.height, state: 'uploading' };
    setPhotos((ps) => [...ps, p]);
    void upload(p);
    return r.kind;
  };

  const blocking = photosBlocking(photos);
  const valid = reason.trim().length >= 1 && blocking.pending === 0 && blocking.failed === 0;

  async function submit() {
    const r = q.data;
    if (!r) return;
    setBusy(true);
    try {
      const next = await unwrap(
        api.client.POST('/app/v1/requests/{requestId}/reopen', {
          params: { path: { requestId: r.id } },
          body: { reason: reason.trim(), expectedVersion: r.version, ...(photos.length ? { photoUploadIds: photos.map((p) => p.uploadId!) } : {}) },
        }),
      );
      qc.setQueryData(qk.request(r.id), next);
      invalidateRequest(qc);
      toast(t('reopen.done'));
      router.back();
    } catch (e) {
      onError(r, e);
      router.back();
    } finally {
      setBusy(false);
    }
  }

  const cancel = () => {
    if (!reason.trim() && !photos.length) return router.back();
    Alert.alert(t('common.discardTitle'), undefined, [
      { text: t('common.keepEditing'), style: 'cancel' },
      { text: t('common.discard'), style: 'destructive', onPress: () => router.back() },
    ]);
  };

  return (
    <Screen
      footer={
        <>
          {blocking.failed ? <Text variant="small" color={colors.danger}>{t('newRequest.uploadFailedHint', { count: blocking.failed })}</Text> : null}
          <Button testID="reopen-submit" title={t('reopen.submit')} onPress={submit} loading={busy} disabled={!valid || !q.data} needsNetwork />
          <Button kind="ghost" title={t('common.cancel')} onPress={cancel} />
        </>
      }
    >
      <Field
        testID="reopen-reason"
        label={t('reopen.reason')}
        placeholder={t('reopen.placeholder')}
        value={reason}
        onChangeText={(v) => setReason(v.slice(0, REOPEN_REASON_MAX))}
        onBlur={() => setTouched(true)}
        multiline
        maxLength={REOPEN_REASON_MAX}
        error={touched && !reason.trim() ? t('reopen.reasonRequired') : null}
        counter={t('common.charCount', { count: reason.length, max: REOPEN_REASON_MAX })}
      />
      <PhotoPicker
        photos={photos}
        max={REOPEN_PHOTOS_MAX}
        onAdd={add}
        onRetry={(lid) => {
          const p = photos.find((x) => x.localId === lid);
          if (p) void upload(p);
        }}
        onRemove={(lid) => setPhotos((ps) => ps.filter((p) => p.localId !== lid))}
      />
    </Screen>
  );
}
