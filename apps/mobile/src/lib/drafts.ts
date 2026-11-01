import AsyncStorage from '@react-native-async-storage/async-storage';
import type { CategoryCode } from './types';

/**
 * New-request draft kept per unit until submitted or discarded (R2-AC5). The idempotency key is
 * created once per draft, so a retry after a timeout never creates a duplicate request.
 */
export type PhotoState = 'compressing' | 'uploading' | 'ready' | 'failed';
export interface DraftPhoto {
  localId: string;
  uri: string;
  width: number;
  height: number;
  uploadId?: string;
  state: PhotoState;
}
export type Slot = 'morning' | 'afternoon' | 'evening';
export interface Draft {
  idempotencyKey: string;
  categoryCode?: CategoryCode;
  description: string;
  locationKey?: string;
  locationOther?: string;
  preferredSlot?: Slot;
  photos: DraftPhoto[];
}

export const DESCRIPTION_MIN = 10;
export const DESCRIPTION_MAX = 1000;
export const LOCATION_MAX = 60;
export const REQUEST_PHOTOS_MAX = 5;
export const REOPEN_PHOTOS_MAX = 3;
export const REOPEN_REASON_MAX = 500;
export const MAX_PHOTO_BYTES = 10 * 1024 * 1024;

export const LOCATION_KEYS = [
  'kitchen', 'living_room', 'master_bedroom', 'bedroom', 'master_bathroom', 'bathroom',
  'majlis', 'roof', 'garden', 'garage', 'outside', 'other',
] as const;

export function emptyDraft(idempotencyKey: string, categoryCode?: CategoryCode): Draft {
  return { idempotencyKey, categoryCode, description: '', photos: [] };
}

export function descriptionValid(d: string): boolean {
  const n = d.trim().length;
  return n >= DESCRIPTION_MIN && n <= DESCRIPTION_MAX;
}

export function photosBlocking(photos: readonly DraftPhoto[]): { pending: number; failed: number } {
  return {
    pending: photos.filter((p) => p.state === 'compressing' || p.state === 'uploading').length,
    failed: photos.filter((p) => p.state === 'failed').length,
  };
}

/** M-13 "Next": valid description, no upload in progress or failed. */
export function canProceed(d: Draft): boolean {
  const b = photosBlocking(d.photos);
  return Boolean(d.categoryCode) && descriptionValid(d.description) && b.pending === 0 && b.failed === 0;
}

export function hasContent(d: Draft): boolean {
  return d.description.trim().length > 0 || d.photos.length > 0 || Boolean(d.locationKey) || Boolean(d.preferredSlot);
}

/** Location is free text on the API (≤100); we send the label in the resident's language. */
export function locationText(d: Draft, label: (key: string) => string): string | undefined {
  if (!d.locationKey) return undefined;
  if (d.locationKey === 'other') return d.locationOther?.trim().slice(0, LOCATION_MAX) || undefined;
  return label(d.locationKey);
}

export function createBody(d: Draft, label: (key: string) => string) {
  if (!d.categoryCode) throw new Error('category required');
  const location = locationText(d, label);
  return {
    categoryCode: d.categoryCode,
    description: d.description.trim(),
    ...(location ? { locationInUnit: location } : {}),
    ...(d.preferredSlot ? { preferredSlot: d.preferredSlot } : {}),
    ...(d.photos.length ? { photoUploadIds: d.photos.map((p) => p.uploadId!).filter(Boolean) } : {}),
  };
}

const key = (unitId: string) => `cs.draft.${unitId}`;

export async function loadDraft(unitId: string): Promise<Draft | null> {
  try {
    const raw = await AsyncStorage.getItem(key(unitId));
    if (!raw) return null;
    const d = JSON.parse(raw) as Draft;
    // Uploads in flight when the app closed cannot resume; mark them for retry.
    d.photos = d.photos.map((p) => (p.state === 'ready' ? p : { ...p, state: 'failed' }));
    return d;
  } catch {
    return null;
  }
}

export async function saveDraft(unitId: string, d: Draft): Promise<void> {
  await AsyncStorage.setItem(key(unitId), JSON.stringify(d));
}

export async function deleteDraft(unitId: string): Promise<void> {
  await AsyncStorage.removeItem(key(unitId));
}
