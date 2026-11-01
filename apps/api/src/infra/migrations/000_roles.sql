-- 000: database roles (ADR-012). The login role is granted both; the API picks one per transaction.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_api') THEN CREATE ROLE app_api NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_worker') THEN CREATE ROLE app_worker NOLOGIN; END IF;
  -- Cross-tenant lookups only: token → invitation, session → admin, person → assignments, jobs, webhooks.
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_system') THEN CREATE ROLE app_system NOLOGIN BYPASSRLS; END IF;
END $$;
