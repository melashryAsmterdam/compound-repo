'use client';

/**
 * Thin fetch wrapper over the shared API (contract: packages/api-contract).
 * Types come from @compound/api-client (generated); the browser calls /api/*
 * on the portal origin, which Next rewrites to the API (first-party cookie).
 */
import type { Schemas } from '@compound/api-client';

export type { Schemas };
export type AdminRequestDetail = Schemas['AdminRequestDetail'];
export type AdminRequestSummary = Schemas['AdminRequestSummary'];
export type RequestEvent = Schemas['RequestEvent'];
export type UnitSummary = Schemas['UnitSummary'];
export type UnitDetail = Schemas['UnitDetail'];
export type Invitation = Schemas['Invitation'];
export type AdminAnnouncement = Schemas['AdminAnnouncement'];
export type AdminMe = Schemas['AdminMe'];
export type Compound = Schemas['Compound'];
export type Category = Schemas['Category'];

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly body: { title?: string; traceId?: string; errors?: { field: string; code: string }[]; [k: string]: unknown },
  ) {
    super(code);
  }
  fieldError(field: string) {
    return this.body.errors?.find((e) => e.field === field)?.code;
  }
}

const CSRF_KEY = 'cs_csrf';
let csrf: string | null = typeof window !== 'undefined' ? sessionStorage.getItem(CSRF_KEY) : null;

export function setCsrf(token: string | null) {
  csrf = token;
  if (typeof window === 'undefined') return;
  if (token) sessionStorage.setItem(CSRF_KEY, token);
  else sessionStorage.removeItem(CSRF_KEY);
}

let onUnauthenticated: (() => void) | null = null;
export function setUnauthenticatedHandler(fn: () => void) {
  onUnauthenticated = fn;
}

function locale() {
  return typeof document !== 'undefined' && document.documentElement.lang === 'en' ? 'en' : 'ar';
}

export async function api<T = unknown>(method: string, path: string, body?: unknown, opts: { auth?: boolean } = {}): Promise<T> {
  const headers: Record<string, string> = { 'Accept-Language': locale() };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (method !== 'GET' && csrf) headers['X-CSRF-Token'] = csrf;
  let res: Response;
  try {
    res = await fetch(`/api${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), credentials: 'same-origin' });
  } catch {
    throw new ApiError(0, 'network_error', {});
  }
  const fresh = res.headers.get('X-CSRF-Token');
  if (fresh) setCsrf(fresh);
  if (res.status === 204 || res.status === 202) return undefined as T;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new ApiError(res.status, data.code ?? 'internal_error', data);
    if (res.status === 401 && opts.auth !== false && onUnauthenticated) onUnauthenticated();
    throw err;
  }
  return data as T;
}

export const get = <T>(path: string) => api<T>('GET', path);
export const post = <T>(path: string, body?: unknown) => api<T>('POST', path, body ?? {});
export const patch = <T>(path: string, body: unknown) => api<T>('PATCH', path, body);
export const put = <T>(path: string, body: unknown) => api<T>('PUT', path, body);
export const del = <T>(path: string) => api<T>('DELETE', path);

export function qs(params: Record<string, string | number | boolean | undefined | null | string[]>) {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0)) continue;
    u.set(k, Array.isArray(v) ? v.join(',') : String(v));
  }
  const s = u.toString();
  return s ? `?${s}` : '';
}

/** Signed upload: ticket from the API, then PUT the bytes (ADR-013). */
export async function uploadFile(file: File, purpose: 'announcement_attachment' | 'compound_logo'): Promise<string> {
  const t = await post<Schemas['UploadTicket']>('/admin/v1/uploads', { purpose, contentType: file.type, bytes: file.size });
  const url = new URL(t.uploadUrl);
  const res = await fetch(url.pathname + url.search, { method: 'PUT', headers: t.headers, body: file });
  if (!res.ok) throw new ApiError(res.status, 'upload_invalid', {});
  return t.uploadId;
}
