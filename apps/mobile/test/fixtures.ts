import type { RequestDetail } from '@/lib/api';

export const CATEGORIES = [
  { code: 'plumbing', nameAr: 'سباكة', nameEn: 'Plumbing', icon: 'droplet' },
  { code: 'other', nameAr: 'أخرى', nameEn: 'Other', icon: 'ellipsis' },
  { code: 'electrical', nameAr: 'كهرباء', nameEn: 'Electrical', icon: 'zap' },
];

export const requestDetail = (p: Partial<RequestDetail> = {}): RequestDetail => ({
  id: 'b7c1e2f0-0000-4000-8000-000000000123',
  ref: 'REQ-00123',
  unit: { id: '7a9e0000-0000-4000-8000-000000000014', number: '14', block: 'B' },
  categoryCode: 'plumbing',
  description: 'Water leaking under the kitchen sink',
  status: 'new',
  closeReason: null,
  reopenCount: 0,
  visit: null,
  doneAt: null,
  autoCloseAt: null,
  version: 3,
  createdAt: '2026-11-01T08:00:00Z',
  updatedAt: '2026-11-01T09:00:00Z',
  locationInUnit: 'Kitchen',
  preferredSlot: 'morning',
  photos: [],
  timeline: [
    { id: 'e2', type: 'comment', actor: { type: 'admin', displayName: 'Management' }, body: 'Plumber on Tuesday', createdAt: '2026-11-01T09:00:00Z' },
    { id: 'e1', type: 'created', actor: { type: 'resident' }, createdAt: '2026-11-01T08:00:00Z' },
  ],
  allowedActions: ['cancel'],
  ...p,
});
