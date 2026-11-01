# Admin portal on Vercel

The portal (`apps/portal`, Next.js 16) deploys to Vercel as its own project. The shared API (`apps/api`) is **not** deployed to Vercel; it runs separately (architecture: Cloud Run, me-central2) and the portal reaches it through `API_URL`.

## Vercel project settings

| Setting | Value |
|---|---|
| Git repository | `melashryAsmterdam/compound-repo` |
| Root Directory | `apps/portal` |
| Framework preset | Next.js (also set in `vercel.json`) |
| Install command | `pnpm install --frozen-lockfile` (from `vercel.json`; Vercel runs it at the workspace root) |
| Build command | `cd ../.. && pnpm exec turbo run build --filter=@compound/portal` (from `vercel.json`; builds `domain`, `i18n`, `api-client` and `ui-tokens` first) |
| Node.js version | 22.x or 24.x (`engines.node` is `>=22`) |
| "Include files outside the root directory" | On (the default) — the build needs `packages/*` |

## Environment variables (portal / Vercel)

| Name | Required | Environments | Example | What it does |
|---|---|---|---|---|
| `API_URL` | **Yes** | Production, Preview | `https://api.example.sa` | Base URL of the shared API, no trailing slash. The browser calls `/api/*` and `/_storage/*` on the portal's own domain and Vercel proxies them here, so the admin session cookie stays first-party. Read at **build time** (rewrites) and at runtime (activation page). The build fails if it is missing on Vercel, and production requires `https`. |
| `APP_STORE_URL` | No | Production | `https://apps.apple.com/sa/app/…` | iOS store link on the activation page (W-01). Defaults to the App Store home. |
| `PLAY_STORE_URL` | No | Production | `https://play.google.com/store/apps/details?id=sa.compound.app` | Android store link on the activation page. Defaults to the Play home. |

No secrets live in the portal; every secret stays with the API.

## Settings the API needs for a Vercel-hosted portal

Set these on the **API** deployment (not on Vercel), using the portal's final domain:

| Name | Value |
|---|---|
| `PORTAL_ORIGIN` | `https://<portal domain>` — the API's CSRF/Origin check rejects every admin change from any other origin. A preview URL will not pass unless it is this value. |
| `ACTIVATION_BASE_URL` | `https://<portal domain>` — invite links in SMS/email point to `/a/<token>` on the portal. |
| `PUBLIC_API_URL` | `https://<portal domain>/api` — the URL the API puts in signed upload links, through the portal proxy. |

## Before the first publish — open points

1. **Data residency (PDPL) — needs a decision.** The architecture keeps all personal data in-Kingdom (me-central2). On Vercel, admin pages and every `/api/*` call (resident names, phones, photos) pass through Vercel's servers, which are outside Saudi Arabia. Please confirm with the Architect/owner that this is acceptable for the pilot, or host the portal in-region instead.
2. **The API must be reachable over HTTPS** at the `API_URL` above. Until the API is deployed, a portal deployment builds but cannot sign in.
3. **Live updates (SSE)** go through the Vercel proxy; long-lived streams may be cut by the proxy and reconnect automatically (the dashboard keeps working; it just reconnects).
4. **App links:** `public/.well-known/assetlinks.json` still has `REPLACE_WITH_RELEASE_CERT_SHA256`, and the AASA app id must match the production iOS team id before the production domain is used in invites.

## Local check

```sh
pnpm install
cp apps/portal/.env.example apps/portal/.env.local   # API_URL=http://localhost:4000
VERCEL=1 API_URL=https://api.example.sa pnpm exec turbo run build --filter=@compound/portal
```
