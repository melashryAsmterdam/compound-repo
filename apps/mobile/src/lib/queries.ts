import { useInfiniteQuery, useQuery, type QueryClient } from '@tanstack/react-query';
import { unwrap } from './api';
import { useSession } from './session';

export const qk = {
  categories: ['categories'] as const,
  requests: (unitId: string | undefined, state: 'open' | 'closed' | 'all') => ['requests', unitId, state] as const,
  request: (id: string) => ['request', id] as const,
  announcements: (unitId: string | undefined) => ['announcements', unitId] as const,
  announcement: (id: string) => ['announcement', id] as const,
  notifications: ['notifications'] as const,
  legal: (doc: string, locale: string) => ['legal', doc, locale] as const,
};

export const PAGE = 25;

export function useCategories() {
  const { api, locale } = useSession();
  return useQuery({
    queryKey: [...qk.categories, locale],
    queryFn: () => unwrap(api.client.GET('/app/v1/categories')),
    staleTime: 24 * 3600 * 1000,
  });
}

export function useRequests(state: 'open' | 'closed' | 'all', limit = PAGE) {
  const { api, unit } = useSession();
  const unitId = unit?.unitId;
  return useInfiniteQuery({
    queryKey: [...qk.requests(unitId, state), limit],
    enabled: Boolean(unitId),
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      unwrap(
        api.client.GET('/app/v1/units/{unitId}/requests', {
          params: { path: { unitId: unitId! }, query: { state, limit, ...(pageParam ? { cursor: pageParam } : {}) } },
        }),
      ),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
}

export function useRequest(id: string) {
  const { api } = useSession();
  return useQuery({
    queryKey: qk.request(id),
    queryFn: () => unwrap(api.client.GET('/app/v1/requests/{requestId}', { params: { path: { requestId: id } } })),
  });
}

export function useAnnouncements(limit = PAGE) {
  const { api, unit } = useSession();
  const unitId = unit?.unitId;
  return useInfiniteQuery({
    queryKey: [...qk.announcements(unitId), limit],
    enabled: Boolean(unitId),
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      unwrap(
        api.client.GET('/app/v1/units/{unitId}/announcements', {
          params: { path: { unitId: unitId! }, query: { limit, ...(pageParam ? { cursor: pageParam } : {}) } },
        }),
      ),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
}

export function useAnnouncement(id: string) {
  const { api } = useSession();
  return useQuery({
    queryKey: qk.announcement(id),
    queryFn: () => unwrap(api.client.GET('/app/v1/announcements/{announcementId}', { params: { path: { announcementId: id } } })),
    retry: (n, e) => (e as { status?: number }).status !== 404 && n < 2,
  });
}

export function useNotifications() {
  const { api, status } = useSession();
  return useInfiniteQuery({
    queryKey: qk.notifications,
    enabled: status === 'signedIn',
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      unwrap(api.client.GET('/app/v1/notifications', { params: { query: { limit: PAGE, ...(pageParam ? { cursor: pageParam } : {}) } } })),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
}

export function useUnreadCount(): number {
  const q = useNotifications();
  return q.data?.pages[0]?.unreadCount ?? 0;
}

export function useLegal(doc: 'privacy_notice' | 'terms') {
  const { api, locale } = useSession();
  return useQuery({
    queryKey: qk.legal(doc, locale),
    queryFn: () => unwrap(api.client.GET('/app/v1/legal/{document}', { params: { path: { document: doc }, query: { locale } } })),
  });
}

/** Refetch everything a request change can touch. */
export function invalidateRequest(qc: QueryClient, id?: string) {
  if (id) void qc.invalidateQueries({ queryKey: qk.request(id) });
  void qc.invalidateQueries({ queryKey: ['requests'] });
  void qc.invalidateQueries({ queryKey: qk.notifications });
}
