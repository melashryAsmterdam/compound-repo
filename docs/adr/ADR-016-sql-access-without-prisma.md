# ADR-016 — Database access with `pg` and SQL migrations instead of Prisma (amends ADR-002)

**Status:** Proposed · **Date:** 2026-11-01

## Context
ADR-002 chose Prisma for schema, migrations and typed queries, with raw SQL for RLS, counters and search.
In practice the design leans on Postgres features Prisma models poorly: RLS with `SET LOCAL` per
transaction (ADR-012), composite tenant foreign keys, partial unique indexes, enums used as types,
generated columns, an append-only hash-chained audit log, and pg-boss in the same transaction (ADR-003).
`schema.sql` was already the reviewed source of truth.

## Decision
- Migrations are plain, ordered SQL files in `apps/api/migrations/` (`0001_init.sql` is the reviewed
  `schema.sql`), applied by a small runner that records them in `schema_migrations`.
- Queries use `pg` with parameterised SQL. Every query runs inside `Db.tenant()` / `Db.global()`, which
  opens the transaction, switches to the app role and sets `app.compound_id` — the `TenantTx` of the
  coding standards. Nothing else touches the pool.

## Consequences
- RLS setup is explicit and testable; tests prove cross-compound isolation as `app_api`.
- We lose Prisma's generated row types; services declare row interfaces next to their SQL.
  Revisit (e.g. Kysely for typed queries) if this becomes a source of bugs.
- CI must still check migrations are additive (repo standard §3.9) — by review of the SQL file.
