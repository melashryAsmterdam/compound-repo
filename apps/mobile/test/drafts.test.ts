import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  canProceed, createBody, deleteDraft, descriptionValid, emptyDraft, hasContent, loadDraft, locationText, photosBlocking, saveDraft, type Draft,
} from '@/lib/drafts';

const label = (k: string) => `L:${k}`;
const base = (p: Partial<Draft> = {}): Draft => ({ ...emptyDraft('11111111-1111-4111-8111-111111111111', 'plumbing'), description: 'Water leaking under the sink', ...p });

describe('draft rules (R2-AC1, R2-AC5)', () => {
  it('description must be 10–1000 trimmed characters', () => {
    expect(descriptionValid('short')).toBe(false);
    expect(descriptionValid('   exactly10   '.padEnd(12))).toBe(false);
    expect(descriptionValid('0123456789')).toBe(true);
    expect(descriptionValid('x'.repeat(1001))).toBe(false);
  });
  it('Next is blocked while a photo uploads or failed', () => {
    expect(canProceed(base())).toBe(true);
    expect(canProceed(base({ categoryCode: undefined }))).toBe(false);
    const p = { localId: 'p', uri: 'file://p', width: 1, height: 1 };
    expect(canProceed(base({ photos: [{ ...p, state: 'uploading' }] }))).toBe(false);
    expect(canProceed(base({ photos: [{ ...p, state: 'failed' }] }))).toBe(false);
    expect(canProceed(base({ photos: [{ ...p, state: 'ready', uploadId: 'u' }] }))).toBe(true);
    expect(photosBlocking([{ ...p, state: 'failed' }, { ...p, state: 'compressing' }])).toEqual({ pending: 1, failed: 1 });
  });
  it('builds the contract body', () => {
    const d = base({ locationKey: 'kitchen', preferredSlot: 'evening', photos: [{ localId: 'p', uri: 'u', width: 1, height: 1, state: 'ready', uploadId: 'up-1' }] });
    expect(createBody(d, label)).toEqual({
      categoryCode: 'plumbing', description: 'Water leaking under the sink', locationInUnit: 'L:kitchen', preferredSlot: 'evening', photoUploadIds: ['up-1'],
    });
    expect(createBody(base(), label)).toEqual({ categoryCode: 'plumbing', description: 'Water leaking under the sink' });
    expect(() => createBody(base({ categoryCode: undefined }), label)).toThrow();
  });
  it('"Other" location uses the free text, capped at 60', () => {
    expect(locationText(base({ locationKey: 'other', locationOther: '  Laundry  ' }), label)).toBe('Laundry');
    expect(locationText(base({ locationKey: 'other', locationOther: '' }), label)).toBeUndefined();
    expect(locationText(base({ locationKey: 'other', locationOther: 'y'.repeat(80) }), label)).toHaveLength(60);
  });
  it('knows when there is something to discard', () => {
    expect(hasContent(emptyDraft('k'))).toBe(false);
    expect(hasContent(base())).toBe(true);
  });
});

describe('draft persistence', () => {
  beforeEach(() => AsyncStorage.clear());
  it('round-trips per unit and keeps the idempotency key', async () => {
    await saveDraft('unit-1', base());
    const d = await loadDraft('unit-1');
    expect(d?.idempotencyKey).toBe('11111111-1111-4111-8111-111111111111');
    expect(await loadDraft('unit-2')).toBeNull();
    await deleteDraft('unit-1');
    expect(await loadDraft('unit-1')).toBeNull();
  });
  it('marks uploads that were in flight as failed after a restart', async () => {
    await saveDraft('u', base({ photos: [{ localId: 'a', uri: 'x', width: 1, height: 1, state: 'uploading' }, { localId: 'b', uri: 'y', width: 1, height: 1, state: 'ready', uploadId: 'z' }] }));
    const d = await loadDraft('u');
    expect(d?.photos.map((p) => p.state)).toEqual(['failed', 'ready']);
  });
});
