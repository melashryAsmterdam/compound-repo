-- 0001 shows the RLS pattern on `request` only; this applies it to every tenant table (ADR-012)
-- and grants the application roles what they need.
--
-- NULLIF: on a pooled connection a setting made with SET LOCAL reads back as '' after the
-- transaction ends, and ''::uuid would raise instead of matching nothing.

DROP POLICY tenant_isolation ON request;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'request','admin_user','unit','unit_assignment','invitation','request_event','upload',
    'announcement','announcement_target','announcement_recipient','notification',
    'message_delivery','consent_record','audit_log'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I
         USING (compound_id = NULLIF(current_setting(''app.compound_id'', true), '''')::uuid)
         WITH CHECK (compound_id = NULLIF(current_setting(''app.compound_id'', true), '''')::uuid)', t);
  END LOOP;
END $$;

-- Admin sign-in happens before the compound is known. This read-only policy lets the auth
-- module find an admin by email when it marks the transaction with app.purpose = 'admin_login'.
-- RLS is the backstop against a forgotten WHERE, not against a compromised API; the flag is set
-- in exactly one place (findAdminForLogin in auth.service.ts). SELECT only: locking the row
-- (FOR UPDATE) also needs the tenant policy, so the caller sets the compound before locking.
CREATE POLICY admin_login_lookup ON admin_user FOR SELECT
  USING (current_setting('app.purpose', true) = 'admin_login');

GRANT USAGE ON SCHEMA public TO app_api, app_worker;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_api, app_worker;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO app_api, app_worker;
-- Re-applied after the blanket grant: the audit log is append-only for the app.
REVOKE UPDATE, DELETE ON audit_log FROM app_api, app_worker;
