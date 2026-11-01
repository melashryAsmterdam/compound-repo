# Admin portal — publishing on Vercel

The portal (`apps/portal`, Next.js 16) is ready to import into Vercel. It has **not** been published.

## Project settings

| Setting | Value |
|---|---|
| Root Directory | `apps/portal` |
| Framework | Next.js (also set in `vercel.json`) |
| Install command | `pnpm install --frozen-lockfile` (from `vercel.json`; Vercel installs the whole pnpm workspace) |
| Build command | `cd ../.. && pnpm exec turbo run build --filter=@compound/portal` (from `vercel.json`; builds `domain`, `i18n` and `api-client` first) |
| Node.js | 22.x or later (root `package.json` `engines`) |
| "Include files outside the root directory" | On (the default), the portal uses `packages/*` |

## Environment variables

The portal reads only these. None is `NEXT_PUBLIC_*`: the browser never sees the API address. It calls `/api/*` on the portal's own domain, and Next rewrites those calls to `API_URL`, so the admin session cookie stays first-party.

| Variable | Required | Used for | Example |
|---|---|---|---|
| `API_URL` | **Yes, on Vercel.** If it's missing, the build fails on purpose. Locally it defaults to `http://localhost:4000`. | The base URL of the shared API. It's read at build time for the `/api/*` and `/_storage/*` rewrites, and at runtime by server pages such as the activation landing `/a/[token]`. It must start with `http://` or `https://`, and a trailing slash is dropped. | `https://api.compound.example.sa` |
| `APP_STORE_URL` | No (defaults to `https://apps.apple.com/`) | The App Store button on the activation page `/a/[token]`. | `https://apps.apple.com/sa/app/id0000000000` |
| `PLAY_STORE_URL` | No (defaults to `https://play.google.com/store/apps/`) | The Google Play button on the activation page. | `https://play.google.com/store/apps/details?id=sa.compound.app` |

`VERCEL` and `NODE_ENV` are set by Vercel itself; don't add them.

Changing any of these needs a **redeploy**, because the rewrites are fixed at build time. `turbo.json` declares them, so Turbo passes them through and rebuilds when they change.

## Settings that must match on the API side (not on Vercel)

The API isn't deployed to Vercel (the architecture puts it on GCP me-central2). Once the portal has its domain, set these on the API:

| API variable | Set to |
|---|---|
| `PORTAL_ORIGIN` | The portal's domain, e.g. `https://portal.compound.example.sa`. The API's CSRF/Origin check rejects every admin mutation from any other origin. |
| `ACTIVATION_BASE_URL` | The same domain. SMS and email invites link to `<this>/a/<token>`. |
| `PUBLIC_API_URL` | `<portal domain>/api`, if the API builds absolute links that go through the portal. |

## Before going live

- **App links:** `public/.well-known/apple-app-site-association` still has `TEAMID`, and `assetlinks.json` has `REPLACE_WITH_RELEASE_CERT_SHA256`. Fill in both from the real Apple team and Play signing key, or iOS/Android won't open activation links in the app.
- **PDPL / in-Kingdom hosting:** Vercel has no region in Saudi Arabia. With this setup, admin and resident data (names, phones, request details) passes through Vercel's network on its way to the API. Before a real compound uses it, the Architect or the owner needs to confirm whether that's acceptable. The alternative is the planned Cloud Run deployment in Dammam (`output: 'standalone'` is kept for that, and Vercel ignores it).
- **Browser tests:** the Playwright suite (`pnpm --filter @compound/portal e2e`) needs the full API, which isn't in this repository yet (see the summary).
