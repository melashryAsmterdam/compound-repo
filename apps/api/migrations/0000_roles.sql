-- Application roles (ADR-012). In GCP these are created by Terraform before migrations run;
-- this file does the same for local and test databases. Neither role has BYPASSRLS.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_api') THEN
    CREATE ROLE app_api NOLOGIN NOBYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_worker') THEN
    CREATE ROLE app_worker NOLOGIN NOBYPASSRLS;
  END IF;
END $$;
