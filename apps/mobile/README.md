# Saha (ساحة) — resident app (`apps/mobile`)

Expo SDK 58 · React Native 0.88 · expo-router · TanStack Query · i18next. Arabic-first with full RTL, English second.
Talks to the API only through `@compound/api-client` (generated from `packages/api-contract/openapi.yaml`).

## Screens (screen spec v1, M-01…M-27)

| Route | Screen |
|---|---|
| `/` | M-01 boot (min version → Android install-referrer invite → language → refresh session) |
| `/language` | M-02 language (first launch) |
| `/sign-in` (`?activate=1`) | M-03 sign in · iOS deferred activation by invited mobile/email (ADR-009) |
| `/a/[token]` | M-04 activation preview (universal / app link `go.<domain>/a/<token>`) |
| `/otp` · `/consent` | M-05 OTP (sign-in and activation) · M-06 PDPL consent → `activation/complete` |
| `/push-primer` · `/biometric-setup` · `/lock` | M-07 · M-08 · M-09 |
| `/(tabs)` index · requests · announcements · settings | M-10 Home · M-11 My requests · M-20 Announcements · M-23 Settings |
| `/requests/new` → `details` → `review` | M-12 / M-13 / M-14 wizard, draft per unit + Idempotency-Key |
| `/requests/[id]` · `/reopen/[id]` · `/photos` | M-15 detail (M-16 confirm, M-18 cancel dialogs) · M-17 reopen · M-19 viewer |
| `/announcements/[id]` · `/notifications` | M-21 · M-22 |
| `/unit-switcher` · `/privacy` · `/contact` · `/legal/[doc]` | M-24 · M-25 · M-26 · notice/terms reader |
| `/revoked` · `/update-required` | M-27 system screens (offline banner is on every screen) |

## Code map

- `src/lib/api.ts` — typed client; bearer in memory, refresh token in SecureStore, single-flight refresh on 401, `ApiError` with the contract's `Problem.code`.
- `src/lib/session.tsx` — sign-in/out, `me`, selected unit, language + RTL switch, revoke handling (M-27).
- `src/lib/requests.ts` — pure status/outcome/timeline/visit rules (§1.3, M-11, M-15).
- `src/lib/drafts.ts`, `useDraft.tsx`, `photos.ts`, `upload.ts` — draft per unit, resize + JPEG re-encode (drops EXIF/GPS), signed upload.
- `src/lib/format.ts` — `formatDual` Gregorian + Hijri (Umm al-Qura), 12-hour, Asia/Riyadh, Western digits.
- `src/lib/realtime.ts` — SSE while Home / My requests / Request detail are focused; push otherwise. Bearer in the `Authorization` header only (contract v1.1, B6).
- `src/lib/theme/` — theme over `@compound/ui-tokens` (Saha v0.1.1). `tokens.ts` is the only bridge to the package; `index.ts` maps it to semantic names (`colors`, `statusColors`, `type`, `space`, `radius`). Arabic line height 1.6, Latin 1.5. A test fails if a colour literal or raw font size appears anywhere else in `src/`.
- `src/components/brand.tsx` — Saha mark, star-lattice pattern, green hero (M-03 and the tab headers, which show the compound's own logo and name).
- `assets/icon.png`, `assets/splash-icon.png`, `assets/brand/saha-mark.svg` — the Designer's Saha mark exports (Library `compound-app/design/saha-mark/`; early sketches, placeholders until launch). `scripts/gen-brand-assets.mjs` draws the Android adaptive layers and favicon from the same geometry and the token colours.
- `app.config.ts` — product name (`APP_NAME_AR` / `APP_NAME_EN`, default ساحة / Saha, pending trademark clearance), per-profile bundle ids via `APP_VARIANT` (R3), Arabic iOS display name and permission strings (R4).
- `src/lib/config.ts` — API URL, app version, brand, store URL; minimum version from `GET /app/v1/meta` with a build-time fallback. Every call sends `X-App-Version`; any `426 app_update_required` opens M-27.
- `src/lib/i18n/{ar,en}.ts` — every visible string; parity enforced by a test.

## Run

```bash
pnpm install
pnpm --filter @compound/domain --filter @compound/api-client build
cd apps/mobile
EXPO_PUBLIC_API_URL=http://<your-LAN-ip>:4000 npx expo run:ios   # or run:android (development build; Expo Go lacks some modules)
```

Arabic needs a native RTL flip, so the app reloads once on first launch and whenever the language direction changes.

## Tests

```bash
pnpm test          # Jest + RNTL: rules, API client, i18n parity, drafts, and screen tests (sign-in, OTP, activation, consent, home, lists, detail, submit, notifications, settings)
pnpm typecheck
pnpm doctor        # expo-doctor
# End-to-end against a running API (the full invite → activate → report → work → done → reopen → confirm loop):
E2E_API_URL=http://127.0.0.1:4100 E2E_API_LOG=/path/to/api.log pnpm test:api
```

The E2E suite reads the invite link from the API's console SMS log and needs `DEV_FIXED_OTP=123456` on the API.
