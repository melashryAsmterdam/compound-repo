# Compound App

MVP for residential compounds in Saudi Arabia (Arabic-first, RTL). Contract: `packages/api-contract/openapi.yaml`.

| Path | What |
|---|---|
| `apps/api` | NestJS 11 API + worker (`WORKER=1`). Raw SQL over an RLS-aware `Db` (`tenant()` / `system()`), Postgres 16 or PGlite |
| `apps/portal` | Next.js 16 admin portal (P-01…P-18) and activation pages `/a/<token>` (W-01/W-02). Vercel-ready: see `apps/portal/ENVIRONMENT.md` |
| `packages/domain` | Request state machine, phone rules, invitation states, notification routing — pure TS, 100 % branch coverage |
| `packages/i18n` | ar/en catalogues (errors, notifications, SMS/email, portal UI) + `formatDual` (Gregorian + Umm al-Qura Hijri) |
| `packages/api-client` | Generated from the contract (`pnpm gen:client`) — never hand-edited |
| `packages/api-contract` | OpenAPI contract (owned by the Architect) |
| `packages/legal` | Versioned privacy notice + terms (DRAFT text, needs counsel) |
| `infra/db` | Reference roles and schema DDL |

## Run locally (no Docker needed)

```bash
pnpm install
pnpm build                                          # shared packages, API and portal (turbo, in dependency order)
cd apps/api
PGLITE_DIR=.data/pglite node dist/seed.js          # demo compound + admin
PGLITE_DIR=.data/pglite DEV_FIXED_OTP=123456 PUBLIC_API_URL=http://localhost:3000/api node dist/main.js
# other terminal
cd apps/portal && API_URL=http://localhost:4000 pnpm dev
```

Open http://localhost:3000 — sign in as `admin@narjis.example.sa` / `Narjis-Admin-2026`, code `123456`.

## Tests

```bash
pnpm -r test                               # works on a fresh checkout: tests resolve shared packages from source
cd apps/portal && pnpm e2e                 # Playwright ar/en RTL smoke (starts API + portal if not running)
```
