'use client';

import { useEffect, useRef, useState } from 'react';

export interface LiveEvent {
  type: string;
  entityId: string;
  version?: number;
}

type Listener = (e: LiveEvent) => void;
const listeners = new Set<Listener>();
let source: EventSource | null = null;
let connected = true;
const statusListeners = new Set<(c: boolean) => void>();

const TYPES = ['request.created', 'request.updated', 'request.event_added', 'invitation.updated', 'announcement.updated', 'announcement.published'];

function ensure() {
  if (source || typeof window === 'undefined') return;
  source = new EventSource('/api/admin/v1/events/stream', { withCredentials: true });
  const onMsg = (ev: MessageEvent) => {
    try {
      const data = JSON.parse(ev.data) as LiveEvent;
      for (const l of listeners) l(data);
    } catch {
      /* ignore */
    }
  };
  for (const t of TYPES) source.addEventListener(t, onMsg as EventListener);
  source.onopen = () => setConnected(true);
  source.onerror = () => setConnected(false);
}

function setConnected(c: boolean) {
  if (c === connected) return;
  connected = c;
  for (const s of statusListeners) s(c);
}

/** Subscribe to the compound's SSE stream (ADR-007). One shared EventSource per tab. */
export function useLive(handler: Listener) {
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => {
    ensure();
    const l: Listener = (e) => ref.current(e);
    listeners.add(l);
    return () => {
      listeners.delete(l);
    };
  }, []);
}

export function useLiveStatus() {
  const [c, setC] = useState(connected);
  useEffect(() => {
    ensure();
    statusListeners.add(setC);
    return () => {
      statusListeners.delete(setC);
    };
  }, []);
  return c;
}

export function closeLive() {
  source?.close();
  source = null;
}
