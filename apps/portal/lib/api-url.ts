/**
 * Base URL of the shared API, from the API_URL environment variable (see apps/portal/ENVIRONMENT.md).
 * Read by next.config.ts (the /api rewrite) and by server components. Never sent to the browser:
 * the browser calls /api/* on the portal origin, so the session cookie stays first-party.
 *
 * Local development falls back to http://localhost:4000. A Vercel build refuses to start without it,
 * so a deployment can never silently point at localhost.
 */
export const LOCAL_API_URL = 'http://localhost:4000';

export function apiUrl(env: Record<string, string | undefined> = process.env): string {
  const raw = env.API_URL?.trim();
  if (!raw) {
    if (env.VERCEL) throw new Error('API_URL is not set. Add it in the Vercel project settings (see apps/portal/ENVIRONMENT.md).');
    return LOCAL_API_URL;
  }
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`API_URL is not a valid URL: ${raw}`);
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error(`API_URL must be http(s): ${raw}`);
  return raw.replace(/\/+$/, '');
}
