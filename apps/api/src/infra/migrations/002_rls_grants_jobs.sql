-- 002: RLS on every tenant table, grants, job queue, fixed categories.
-- Portal Developer, 2026-11-01. Needs Architect review (CODEOWNERS: migrations).

-- Tenant isolation on every table that has compound_id (schema.sql bottom note).
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['admin_user','admin_session','unit','unit_assignment','invitation','request','request_event','upload',
                           'announcement','announcement_target','announcement_recipient','notification',
                           'message_delivery','consent_record','audit_log']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
    EXECUTE format($p$CREATE POLICY tenant_isolation ON %I
      USING (compound_id = current_setting('app.compound_id', true)::uuid)
      WITH CHECK (compound_id = current_setting('app.compound_id', true)::uuid)$p$, t);
  END LOOP;
END $$;

-- Job queue (stand-in for pg-boss; same table semantics: singleton key, run_at, retries).
CREATE TABLE job (
  id             uuid PRIMARY KEY,
  name           text NOT NULL,
  payload        jsonb NOT NULL DEFAULT '{}',
  singleton_key  text,
  run_at         timestamptz NOT NULL DEFAULT now(),
  status         text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','running','done','failed','cancelled')),
  attempts       smallint NOT NULL DEFAULT 0,
  max_attempts   smallint NOT NULL DEFAULT 5,
  last_error     text,
  locked_at      timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX job_singleton_uq ON job (singleton_key) WHERE singleton_key IS NOT NULL AND status IN ('pending','running');
CREATE INDEX job_due_idx ON job (run_at) WHERE status = 'pending';

CREATE TABLE cron_run (
  name      text PRIMARY KEY,
  last_slot text NOT NULL
);

-- Indexes for the admin dashboard search and unit list (A1-AC4, A3-AC3).
CREATE INDEX IF NOT EXISTS request_desc_trgm ON request USING gin (description gin_trgm_ops);
CREATE INDEX IF NOT EXISTS person_name_trgm ON person USING gin (full_name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS announcement_recipient_person ON announcement_recipient (person_id);

-- Grants. app_api / app_worker are subject to RLS; app_system bypasses it.
GRANT USAGE ON SCHEMA public TO app_api, app_worker, app_system;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_api, app_worker, app_system;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO app_api, app_worker, app_system;
REVOKE UPDATE, DELETE ON audit_log FROM app_api, app_worker, app_system;
REVOKE INSERT, UPDATE, DELETE ON request_category FROM app_api, app_worker, app_system;

INSERT INTO request_category (code, name_ar, name_en, icon, sort_order) VALUES
  ('plumbing','سباكة','Plumbing','droplet',1),
  ('electrical','كهرباء','Electrical','zap',2),
  ('ac_hvac','تكييف وتهوية','AC / HVAC','snowflake',3),
  ('carpentry_doors','نجارة وأبواب','Carpentry & Doors','door-open',4),
  ('painting_walls','دهان وجدران','Painting & Walls','paint-roller',5),
  ('pest_control','مكافحة حشرات','Pest Control','bug',6),
  ('cleaning','نظافة','Cleaning','sparkles',7),
  ('other','أخرى','Other','ellipsis',8)
ON CONFLICT (code) DO NOTHING;
