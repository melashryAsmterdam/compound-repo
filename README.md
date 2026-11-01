# Compound App

Resident app + compound-owner portal for residential compounds in Saudi Arabia. Design pack (PRD v1.0,
ADR-001…015, data model, API contract) lives in the workspace Library under `compound-app/architecture`;
later decisions are in `docs/adr/`.

## Layout

| Path | What |
|---|---|
| `packages/domain` | Request state machine, phone normalisation, SMS-fallback routing — pure TS, 100 % coverage |
| `packages/api-contract` | `openapi.yaml`, the source of truth for both clients (`pnpm lint:contract`, `pnpm --filter @compound/api-contract mock`) |
| `packages/api-client` | Typed client generated from the contract (`pnpm gen:client`) |
| `apps/api` | NestJS API — admin sign-in (A0), units and owner assignment (A1, A2) |
| `apps/api/migrations` | Ordered SQL migrations: roles, schema, RLS on every tenant table, category seed |

Not yet: invitations and resident activation, requests, announcements, notifications, `apps/portal`
(Next.js), `apps/mobile` (Expo), Terraform, CI workflows.

## Run locally (no Docker needed)

```
corepack enable && pnpm install && pnpm build
cd apps/api
cp .env.example .env                 # then set OTP_PEPPER to 32+ random characters
pnpm dev:db                          # Postgres (PGlite) on :5432 — leave running
pnpm migrate                         # in a second terminal
pnpm ops:create-admin --compound-en "Al Narjis" --compound-ar "النرجس" --contact 0112345678 \
  --email you@example.sa --name "Your Name" --password 'at-least-12-characters'
pnpm dev                             # API on :3000; sign-in codes are printed in this terminal
```

## Test

`pnpm test` from the root runs everything. API tests boot a real, migrated Postgres per file and check
sign-in, lockout, sessions/CSRF, row-level isolation between compounds, units and owner assignment.
