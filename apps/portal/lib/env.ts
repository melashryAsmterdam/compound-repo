/**
 * Where the shared API lives. Read once, at build and on the server; the browser never sees it
 * (it calls /api/* on the portal origin, which next.config.ts rewrites here).
 * Locally (including a local `next build`) it defaults to the dev API; on Vercel a missing value
 * fails the build instead of silently pointing the deployed portal at localhost.
 */
export function apiUrl(): string {
  const value = process.env.API_URL?.trim().replace(/\/+$/, '');
  if (value) {
    if (!/^https?:\/\//.test(value)) throw new Error(`API_URL must start with http:// or https:// (got "${value}")`);
    return value;
  }
  if (process.env.VERCEL) {
    throw new Error('API_URL is not set. Set it to the shared API base URL, e.g. https://api.example.sa');
  }
  return 'http://localhost:4000';
}
