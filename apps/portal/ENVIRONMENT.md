# Admin portal — environment variables

The portal is a Next.js app in `apps/portal`. It holds no secrets and no data; it serves the screens and forwards `/api/*` to the shared API.

## Portal (set these in the Vercel project)

| Variable | Required | Read when | Example | What it does |
|---|---|---|---|---|
| `API_URL` | **Yes** on Vercel | build and run | `https://api.staging.example.sa` | Base URL of the shared API. The portal rewrites `/api/*` and `/_storage/*` to it, and server pages (the activation page `/a/<token>`) call it directly. It is never sent to the browser. A Vercel build stops with an error if it is missing; locally it falls back to `http://localhost:4000`. Changing it needs a redeploy, because the rewrite is fixed at build time. |
| `APP_STORE_URL` | No | run | `https://apps.apple.com/sa/app/…` | "Download on the App Store" link on the activation page. Default: `https://apps.apple.com/`. |
| `PLAY_STORE_URL` | No | run | `https://play.google.com/store/apps/details?id=sa.compound.app` | "Get it on Google Play" link on the activation page. Default: `https://play.google.com/store/apps/`. |
| `ENABLE_EXPERIMENTAL_COREPACK` | Recommended | install | `1` | Makes Vercel use the pnpm version pinned in the root `package.json` (`packageManager`). |

Set by Vercel itself, not by you: `VERCEL` (turns on the `API_URL` check and switches off the standalone output used for container images) and `NODE_ENV`.

## Vercel project settings

- **Root Directory:** `apps/portal`. Leave "Include files outside the root directory" on; the portal uses the shared packages in `packages/`.
- **Framework:** Next.js. The build command comes from `apps/portal/vercel.json`: `cd ../.. && pnpm turbo run build --filter=@compound/portal`. It builds the shared packages first, then the portal.
- **Install command:** the default. Vercel finds the pnpm workspace and installs from the repository root.
- **Node.js:** 24 (matches `.nvmrc`).

## API settings the portal depends on

These belong to the API's own deployment (`apps/api/src/config.ts`), not to Vercel. They must match the portal's address, or sign-in and every change will fail.

| Variable | Must be | Why |
|---|---|---|
| `PORTAL_ORIGIN` | the portal's exact address, e.g. `https://portal.example.sa` | The API checks the `Origin` of every change (CSRF). One value only, so preview URLs that change on each deploy will be refused. Use one fixed domain per environment. |
| `ACTIVATION_BASE_URL` | the portal's address | Invite SMS and email links point to `<ACTIVATION_BASE_URL>/a/<token>`, which the portal serves. |
| `PUBLIC_API_URL` | `<portal address>/api` | Address the API puts in signed upload and download URLs, so photos load through the portal. |

The rest of the API's settings (database, secrets, providers, rate limits) are listed in `apps/api/src/config.ts`. Today the API refuses to start with `NODE_ENV=production` and only has console SMS/email/push, so there is no production API for the portal to point at yet.

## Local development

Copy `apps/portal/.env.example` to `apps/portal/.env.local`. With the API running on port 4000 you need nothing else.
