import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Alert } from 'react-native';
import { useToast } from '@/components/Toast';
import { ApiError, REVOKE_CODES, unwrap, type RequestDetail } from './api';
import { errorText } from './i18n';
import { invalidateRequest, qk } from './queries';
import { useSession } from './session';

type Versioned = Pick<RequestDetail, 'id' | 'version'>;

/**
 * M-16 confirm and M-18 cancel dialogs with their calls. Conflicts (`invalid_transition`,
 * `version_conflict`, `request_closed`) reload the request and show a toast (§1.4).
 */
export function useRequestActions() {
  const { t } = useTranslation();
  const toast = useToast();
  const qc = useQueryClient();
  const { api, handleRevoke } = useSession();

  const onError = (r: Versioned, e: unknown, conflictMsg?: string) => {
    const code = e instanceof ApiError ? e.code : 'internal_error';
    if (REVOKE_CODES.has(code)) return void handleRevoke(code);
    if (code === 'invalid_transition' || code === 'version_conflict' || code === 'request_closed') {
      invalidateRequest(qc, r.id);
      toast(conflictMsg ?? t('detail.updatedConflict'));
      return;
    }
    toast(errorText(code));
  };

  const confirm = (r: Versioned) =>
    new Promise<boolean>((resolve) => {
      Alert.alert(t('confirm.title'), t('confirm.body'), [
        { text: t('confirm.no'), style: 'cancel', onPress: () => resolve(false) },
        {
          text: t('confirm.yes'),
          onPress: async () => {
            try {
              const next = await unwrap(
                api.client.POST('/app/v1/requests/{requestId}/confirm', { params: { path: { requestId: r.id } }, body: { expectedVersion: r.version } }),
              );
              qc.setQueryData(qk.request(r.id), next);
              invalidateRequest(qc);
              toast(t('confirm.done'));
              resolve(true);
            } catch (e) {
              onError(r, e);
              resolve(false);
            }
          },
        },
      ]);
    });

  const cancel = (r: Versioned) =>
    new Promise<boolean>((resolve) => {
      Alert.alert(t('cancelDialog.title'), t('cancelDialog.body'), [
        { text: t('cancelDialog.no'), style: 'cancel', onPress: () => resolve(false) },
        {
          text: t('cancelDialog.yes'),
          style: 'destructive',
          onPress: async () => {
            try {
              const next = await unwrap(
                api.client.POST('/app/v1/requests/{requestId}/cancel', { params: { path: { requestId: r.id } }, body: { expectedVersion: r.version } }),
              );
              qc.setQueryData(qk.request(r.id), next);
              invalidateRequest(qc);
              toast(t('cancelDialog.done'));
              resolve(true);
            } catch (e) {
              onError(r, e, t('cancelDialog.tooLate'));
              resolve(false);
            }
          },
        },
      ]);
    });

  return { confirm, cancel, onError };
}
