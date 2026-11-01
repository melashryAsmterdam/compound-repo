import { useQueryClient } from '@tanstack/react-query';
import { useFocusEffect } from 'expo-router';
import { useCallback } from 'react';
import EventSource from 'react-native-sse';
import { API_URL } from './config';
import { invalidateRequest, qk } from './queries';
import { useSession } from './session';

type StreamType =
  | 'request.created' | 'request.updated' | 'request.event_added' | 'announcement.updated'
  | 'announcement.published' | 'notification.created' | 'session.revoked';

/**
 * SSE while M-10, M-11 or M-15 is focused (screen spec §1.5); push covers the rest. Frames carry
 * ids only, so we refetch. The bearer travels in the Authorization header only — the API rejects
 * an access_token query parameter (contract v1.1, build review B6).
 */
export function useLiveUpdates() {
  const { api, status, handleRevoke } = useSession();
  const qc = useQueryClient();

  useFocusEffect(
    useCallback(() => {
      if (status !== 'signedIn') return undefined;
      let es: EventSource<StreamType> | null = null;
      let closed = false;
      const open = () => {
        if (!api.getAccessToken() || closed) return;
        es = new EventSource<StreamType>(`${API_URL}/app/v1/events/stream`, {
          headers: api.authHeaders(),
          pollingInterval: 5000,
        });
        const onFrame = (ev: { data: string | null; type: string }) => {
          let data: { type?: string; entityId?: string } = {};
          try {
            data = JSON.parse(ev.data ?? '{}');
          } catch {
            return;
          }
          switch (data.type ?? ev.type) {
            case 'request.updated':
            case 'request.event_added':
            case 'request.created':
              invalidateRequest(qc, data.entityId);
              break;
            case 'announcement.updated':
            case 'announcement.published':
              void qc.invalidateQueries({ queryKey: ['announcements'] });
              if (data.entityId) void qc.invalidateQueries({ queryKey: qk.announcement(data.entityId) });
              break;
            case 'notification.created':
              void qc.invalidateQueries({ queryKey: qk.notifications });
              break;
            case 'session.revoked':
              void handleRevoke('session_revoked');
              break;
          }
        };
        for (const t of ['request.created', 'request.updated', 'request.event_added', 'announcement.updated', 'announcement.published', 'notification.created', 'session.revoked'] as const) {
          es.addEventListener(t, onFrame as never);
        }
        es.addEventListener('error', (e) => {
          // Expired access token: refresh once and reopen with the new one.
          if ((e as { xhrStatus?: number }).xhrStatus === 401) {
            es?.close();
            void api.refresh().then((ok) => ok && open());
          }
        });
      };
      open();
      return () => {
        closed = true;
        es?.removeAllEventListeners();
        es?.close();
      };
    }, [api, status, qc, handleRevoke]),
  );
}
