# Compound App — Shared API + Admin Portal: build summary

**Author:** Portal Developer · **Date:** 2026-11-01 · **Run:** compound-app-mvp-run-1
**Branch:** `portal-dev/mvp-backend-portal` (local; see "Where the code is")
**Inputs:** PRD v1.0, Architect pack (`openapi.yaml` v1.0-mvp, `schema.sql`, data model, auth/roles), Screen spec v1

## Where the code is

No repository is attached to the workspace yet, and local `git commit` is blocked by the SDLC human-gate hook. All 145 files are **staged, not committed**, on the local branch `portal-dev/mvp-backend-portal`. A source archive is in the Library next to this summary. Once a repo is attached, I'll push the branch through `commit_and_push` (never to the default branch).

## What was built

**Shared backend (`apps/api`, NestJS 11): every operation in the contract is implemented, and only those.** A test checks the routes against `openapi.yaml` in both directions.

- **Admin auth (A0):** Argon2id passwords. The 2FA code goes by email or SMS. 5 failures lock the account for 15 min. Sessions use an `__Host-` cookie with a 30-min idle and 12-h absolute limit. CSRF token plus an Origin check on every mutation. Password reset links are single-use and last 30 min; a reset revokes all sessions. Responses never reveal whether an account exists.
- **Units and owners (A1, A2):** unit create/edit/deactivate, and delete only when the unit has never been used. Unit numbers are unique per compound, case-insensitive, and Arabic-Indic digits are accepted. Owner assign, change and remove; changing the owner revokes the old owner's access straight away. One person can own several units (Q-2). Invites go by SMS and/or email: 7-day single-use token stored only as a SHA-256 hash, a resend supersedes the old link, limit of 5 per unit per 24 h. Delivery status is tracked per channel and updated by webhooks. Activation status is derived: Not invited / Invited / Failed / Expired / Active.
- **Requests (A3, A4, R2–R4):** the state machine lives in `packages/domain` (100% branch coverage) and is enforced on the server with optimistic versioning. Request creation is idempotent (`Idempotency-Key`). Also: comments, and visits entered in Riyadh local time and stored as UTC, with schedule and reschedule. Comments can be edited or deleted for 5 minutes. Residents can confirm, reopen (with a reason and photos) or cancel. Done requests auto-close after 7 days. Visit reminders go out from 20:00. Dashboard counters, filters, search by ref, unit or text, and four sort orders.
- **Announcements (A5, R5):** send now or schedule. Audience is all residents, selected blocks or selected units, resolved at send time with each person counted once. There is an audience and SMS-count preview, read counts, and delete (a scheduled one is cancelled; a sent one is hidden from residents).
- **Notifications:** follow the architecture §6 routing matrix. Push text is minimised for PDPL (no names or descriptions). If a push isn't acknowledged within 10 minutes, the SMS fallback is sent, held back during quiet hours (22:00–07:00). Muting applies to announcements only. Dead push tokens are cleared.
- **Resident auth (R0, R1):** link preview, OTP activation with PDPL consent records, and sign-in by mobile or email OTP. Sign-in never reveals whether a number is registered. Refresh tokens rotate on every use, and reusing an old one revokes the whole session family.
- **Platform:** RLS on every table with `compound_id`, plus a separate BYPASSRLS role only for cross-tenant lookups. Hash-chained, append-only audit log with PII masked. Signed upload URLs; the worker checks file signatures and re-encodes images with `sharp`, which strips EXIF and GPS. Live updates over SSE through LISTEN/NOTIFY. Errors are RFC 9457 problem+json with localised titles. Logs redact PII.

**Admin portal (`apps/portal`, Next.js 16): screens P-01…P-18, plus W-01/W-02 activation pages and the `.well-known` app-link files.**

- Arabic by default with full RTL, built with CSS logical properties. Language is a cookie, with no locale in the URL. IBM Plex Sans Arabic. IDs, phone numbers and unit numbers are always shown left-to-right inside Arabic text.
- Dates show Gregorian and Umm al-Qura Hijri, 12-hour time with ص/م, Asia/Riyadh.
- Requests dashboard: counter cards that work as filters, filters kept in the URL, live toasts and a "N new requests" banner that never moves rows under the pointer. Request detail: actions come from `allowedTransitions`, plus the reopen callout, visit card, timeline, and a comment + visit composer with a draft that survives reloads.
- Units list with a summary strip and paging. Unit detail with invitation history and per-channel delivery status. Owner dialog with an SMS preview. Confirm dialogs.
- Announcements composer with a live audience counter, a phone preview, attachment upload and scheduling.
- Settings: compound profile and logo. Idle-timeout warning, session-expired page, and not-found / error pages.

## What is tested

| Suite | Count | What it covers |
|---|---|---|
| `packages/domain` | 176 ✅ | every state × command × actor, phone normalisation, masking, invitation states, routing, quiet hours, time zones; **100% branch coverage** |
| `packages/i18n` | 15 ✅ | ar/en key parity and placeholder parity for all catalogues; `formatDual` (Hijri, ص/م) |
| `apps/api` integration | 37 ✅ | runs on PGlite (real Postgres 16) with RLS active: auth, lockout, CSRF, idle timeout, reset; units, invites, supersede, limits, failed and expired invites; the full request loop including SMS fallback and push acknowledgement; auto-close; authorisation; cross-compound isolation; announcements; uploads (EXIF stripped, bad files rejected); RLS enforced on every tenant table; audit append-only and tamper detection; PII masking; contract coverage |
| `apps/portal` Playwright | 6 ✅ (run twice, no flakes) | Arabic default + RTL mirroring + no horizontal overflow; admin adds a unit → assigns owner → invites → resident activates and reports through the API → admin starts, schedules a visit, marks done; announcement send; English LTR switch; W-02; signed-out redirect |

## What is left

1. **Real providers.** SMS, email and push use console adapters (07-repo §2 "local"). Still to plug in: Unifonic (registered sender ID, Q-17), the email provider (OD-2), FCM/APNs, and provider-specific webhook signature checks. A shared secret is in place for now.
2. **Infrastructure.** GCS signed URLs to replace the local object store, a KMS-backed ES256 signer, Terraform, and Cloud Run deploy. `config.ts` refuses to start in production without these, and refuses to start if a dev-only setting is turned on.
3. **Jobs.** A pg-backed outbox queue with pg-boss semantics. ADR swap to pg-boss if the Architect prefers (see question 3).
4. **Phase-1 gaps.** Full breached-password list (only a short offline excerpt now), Arabic search normalisation, the DSR handling tool (ops-cli), the retention-purge job, a portal audit-log screen (Q-27), and design tokens from `packages/ui-tokens` (the colours are placeholder neutrals for now).

## Open questions (contract changes go to the Architect first)

1. **CSRF after reload.** I return the CSRF token as an `X-CSRF-Token` header on `GET /admin/v1/me`, derived from the session (not stored). This adds a response header to the contract. Please confirm or propose another approach.
2. **Prisma → raw SQL.** I used raw SQL with an RLS-aware `Db` (`tenant()` / `system()` with `SET LOCAL ROLE`), because Prisma made it hard to switch roles per transaction and to test RLS on PGlite. This needs an ADR update or a decision to revert.
3. **pg-boss → `job` table.** Same semantics (singleton key, `run_at`, retries with backoff, SKIP LOCKED). Keep it or swap?
4. **Endpoints the screen spec needs but the contract lacks:** admin `PATCH /me` (language, 2FA channel, change password; P-17); announcement edit (Q-29); a unit summary-counts endpoint (P-09 currently makes 6 count calls); the creator's id on `AdminRequestSummary` (the "Previous owner" label currently compares names); a delivery summary per announcement (P-16).
5. **Deactivated units (Q-28).** Currently invites and new requests on an inactive unit are blocked, and the unit is left out of announcements. The current owner keeps read access. Should deactivating also remove the owner?
6. **Activation spans compounds.** It runs in one `system()` transaction so it's atomic across compounds. OK with the Architect?
