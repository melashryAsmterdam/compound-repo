'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { get, type AdminMe, type Category } from './api';
import { useLive } from './live';

export function useMe() {
  return useQuery({ queryKey: ['me'], queryFn: () => get<AdminMe>('/admin/v1/me'), staleTime: 60_000 });
}

export function useCounters() {
  return useQuery({
    queryKey: ['counters'],
    queryFn: () => get<{ new: number; inProgress: number; doneAwaitingConfirmation: number; reopened: number }>('/admin/v1/requests/counters'),
    refetchInterval: 15_000, // polling fallback (spec §1.5)
  });
}

export function useCategories() {
  return useQuery({ queryKey: ['categories'], queryFn: () => get<Category[]>('/admin/v1/categories'), staleTime: Infinity });
}

export function useBlocks() {
  return useQuery({ queryKey: ['blocks'], queryFn: () => get<{ block: string; unitCount: number; activeResidentCount: number }[]>('/admin/v1/units/blocks') });
}

/** Invalidate cached queries when the SSE stream reports a change. */
export function useLiveInvalidation() {
  const qc = useQueryClient();
  useLive((e) => {
    if (e.type.startsWith('request.')) {
      void qc.invalidateQueries({ queryKey: ['counters'] });
      void qc.invalidateQueries({ queryKey: ['request', e.entityId] });
      void qc.invalidateQueries({ queryKey: ['unit'] });
    }
    if (e.type === 'invitation.updated') {
      void qc.invalidateQueries({ queryKey: ['unit', e.entityId] });
      void qc.invalidateQueries({ queryKey: ['units'] });
    }
    if (e.type.startsWith('announcement.')) void qc.invalidateQueries({ queryKey: ['announcements'] });
  });
}
