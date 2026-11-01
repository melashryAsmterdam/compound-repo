import 'server-only';

const API_URL = process.env.API_URL ?? 'http://localhost:4000';

/** Server-side call to the API for public pages (activation landing). */
export async function serverGet<T>(path: string, locale: string): Promise<{ ok: true; data: T } | { ok: false; status: number; body: any }> {
  const res = await fetch(`${API_URL}${path}`, { headers: { 'Accept-Language': locale }, cache: 'no-store' });
  const body = await res.json().catch(() => ({}));
  return res.ok ? { ok: true, data: body as T } : { ok: false, status: res.status, body };
}
