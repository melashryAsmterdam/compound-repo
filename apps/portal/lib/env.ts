/**
 * The portal's server-side configuration, read in one place (next.config.ts and server code).
 * Locally API_URL defaults to the dev API; on Vercel it must be set, so a deployment can never
 * silently proxy to localhost. See apps/portal/DEPLOY.md for the full list.
 */
const DEV_API_URL = 'http://localhost:4000';

export function apiUrl(env: Record<string, string | undefined> = process.env): string {
  const raw = env.API_URL?.trim();
  if (!raw) {
    if (env.VERCEL) throw new Error('API_URL is not set. Add it in the Vercel project (Settings → Environment Variables); see apps/portal/DEPLOY.md.');
    return DEV_API_URL;
  }
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`API_URL is not a valid URL: ${raw}`);
  }
  if (env.VERCEL_ENV === 'production' && url.protocol !== 'https:') {
    throw new Error('API_URL must use https in production.');
  }
  return raw.replace(/\/+$/, '');
}
