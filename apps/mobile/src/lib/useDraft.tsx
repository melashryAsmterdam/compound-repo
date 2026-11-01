import * as Crypto from 'expo-crypto';
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { deleteDraft, emptyDraft, loadDraft, saveDraft, type Draft, type DraftPhoto } from './drafts';
import { pickPhoto, uploadPhoto, type PickResult, type PickSource } from './photos';
import { useSession } from './session';
import type { CategoryCode } from './types';

interface DraftCtx {
  draft: Draft | null;
  update(patch: Partial<Draft>): void;
  addPhoto(source: PickSource): Promise<PickResult['kind']>;
  retryPhoto(localId: string): void;
  removePhoto(localId: string): void;
  discard(): Promise<void>;
}

const Ctx = createContext<DraftCtx | null>(null);

/** Shared state for the New Request wizard (M-12…M-14), saved locally per unit on every change. */
export function DraftProvider({ children, initialCategory }: { children: ReactNode; initialCategory?: CategoryCode }) {
  const { api, unit } = useSession();
  const unitId = unit?.unitId;
  const [draft, setDraft] = useState<Draft | null>(null);
  const ref = useRef<Draft | null>(null);
  ref.current = draft;

  useEffect(() => {
    if (!unitId) return;
    void loadDraft(unitId).then((d) => {
      const base = d ?? emptyDraft(Crypto.randomUUID());
      setDraft(initialCategory && !d ? { ...base, categoryCode: initialCategory } : base);
    });
  }, [unitId, initialCategory]);

  const commit = useCallback(
    (fn: (d: Draft) => Draft) => {
      setDraft((prev) => {
        if (!prev) return prev;
        const next = fn(prev);
        if (unitId) void saveDraft(unitId, next);
        return next;
      });
    },
    [unitId],
  );

  const setPhoto = useCallback(
    (localId: string, patch: Partial<DraftPhoto>) => commit((d) => ({ ...d, photos: d.photos.map((p) => (p.localId === localId ? { ...p, ...patch } : p)) })),
    [commit],
  );

  const upload = useCallback(
    async (p: DraftPhoto) => {
      setPhoto(p.localId, { state: 'uploading' });
      try {
        const uploadId = await uploadPhoto(api, p.uri, 'request_photo');
        setPhoto(p.localId, { state: 'ready', uploadId });
      } catch {
        setPhoto(p.localId, { state: 'failed' });
      }
    },
    [api, setPhoto],
  );

  const addPhoto = useCallback(
    async (source: PickSource) => {
      const r = await pickPhoto(source);
      if (r.kind !== 'ok') return r.kind;
      const p: DraftPhoto = { localId: Crypto.randomUUID(), uri: r.uri, width: r.width, height: r.height, state: 'uploading' };
      commit((d) => ({ ...d, photos: [...d.photos, p] }));
      void upload(p);
      return r.kind;
    },
    [commit, upload],
  );

  const value: DraftCtx = {
    draft,
    update: (patch) => commit((d) => ({ ...d, ...patch })),
    addPhoto,
    retryPhoto: (id) => {
      const p = ref.current?.photos.find((x) => x.localId === id);
      if (p) void upload(p);
    },
    removePhoto: (id) => commit((d) => ({ ...d, photos: d.photos.filter((p) => p.localId !== id) })),
    discard: async () => {
      if (unitId) await deleteDraft(unitId);
      setDraft(emptyDraft(Crypto.randomUUID()));
    },
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useDraft(): DraftCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error('useDraft outside DraftProvider');
  return v;
}
