-- Compound App — MVP physical data model (PostgreSQL 16)
-- Source of truth for the Prisma schema in apps/api/prisma/schema.prisma.
-- Conventions: uuid v7 PKs (generated in app), timestamptz UTC, snake_case,
-- compound_id NOT NULL on every tenant table, composite FKs (compound_id, id),
-- RLS on every tenant table (see bottom).

CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ───────────── enums ─────────────
CREATE TYPE unit_type            AS ENUM ('villa','apartment','townhouse','other');
CREATE TYPE record_status        AS ENUM ('active','inactive');
CREATE TYPE locale_code          AS ENUM ('ar','en');
CREATE TYPE assignment_role      AS ENUM ('owner');                 -- Phase 2: 'tenant','family'
CREATE TYPE assignment_status    AS ENUM ('invited','active','revoked');
CREATE TYPE channel              AS ENUM ('push','sms','email');
CREATE TYPE admin_role           AS ENUM ('compound_admin');        -- Phase 2: 'supervisor','manager'; Phase 3: 'guard'
CREATE TYPE request_status       AS ENUM ('new','in_progress','done','closed','cancelled');
CREATE TYPE close_reason         AS ENUM ('confirmed','no_response');
CREATE TYPE preferred_slot       AS ENUM ('morning','afternoon','evening');
CREATE TYPE actor_type           AS ENUM ('admin','resident','system','operator');
CREATE TYPE request_event_type   AS ENUM ('created','status_changed','comment','visit_scheduled',
                                          'visit_rescheduled','reopened','confirmed','auto_closed','cancelled');
CREATE TYPE announcement_status  AS ENUM ('scheduled','sending','sent','deleted');
CREATE TYPE audience_type        AS ENUM ('all','blocks','units');
CREATE TYPE delivery_status      AS ENUM ('queued','sent','delivered','failed','undelivered','skipped');
CREATE TYPE upload_status        AS ENUM ('pending','ready','rejected');
CREATE TYPE upload_purpose       AS ENUM ('request_photo','reopen_photo','announcement_attachment','compound_logo');
CREATE TYPE dsr_type             AS ENUM ('access','correction','deletion');
CREATE TYPE dsr_status           AS ENUM ('received','in_review','completed','rejected');

-- ───────────── tenancy ─────────────
CREATE TABLE compound (
  id               uuid PRIMARY KEY,
  name_ar          text NOT NULL,
  name_en          text NOT NULL,
  logo_upload_id   uuid,
  contact_phone    text NOT NULL,                     -- E.164, shown in app (Q-21)
  timezone         text NOT NULL DEFAULT 'Asia/Riyadh',
  default_locale   locale_code NOT NULL DEFAULT 'ar',
  sms_sender_id    text,                              -- registered CST sender name
  next_request_no  integer NOT NULL DEFAULT 1,        -- per-compound REQ-##### counter
  status           record_status NOT NULL DEFAULT 'active',
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

-- ───────────── admins ─────────────
CREATE TABLE admin_user (
  id                 uuid PRIMARY KEY,
  compound_id        uuid NOT NULL REFERENCES compound(id),
  email              citext NOT NULL UNIQUE,
  full_name          text NOT NULL,
  phone_e164         text,
  password_hash      text NOT NULL,                   -- argon2id
  role               admin_role NOT NULL DEFAULT 'compound_admin',
  mfa_channel        channel NOT NULL DEFAULT 'email' CHECK (mfa_channel IN ('sms','email')),
  locale             locale_code NOT NULL DEFAULT 'ar',
  failed_logins      smallint NOT NULL DEFAULT 0,
  locked_until       timestamptz,
  status             record_status NOT NULL DEFAULT 'active',
  last_login_at      timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (compound_id, id)
);

CREATE TABLE admin_session (
  id_hash          bytea PRIMARY KEY,                 -- sha256 of cookie value
  admin_user_id    uuid NOT NULL REFERENCES admin_user(id),
  compound_id      uuid NOT NULL REFERENCES compound(id),
  csrf_token_hash  bytea NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  last_seen_at     timestamptz NOT NULL DEFAULT now(),  -- idle timeout 30 min
  expires_at       timestamptz NOT NULL,                -- absolute 12 h
  ip               inet,
  user_agent       text,
  revoked_at       timestamptz
);

CREATE TABLE password_reset (
  token_hash     bytea PRIMARY KEY,
  admin_user_id  uuid NOT NULL REFERENCES admin_user(id),
  expires_at     timestamptz NOT NULL,                  -- +30 min
  used_at        timestamptz
);

-- ───────────── residents (global identity) ─────────────
CREATE TABLE person (
  id                    uuid PRIMARY KEY,
  full_name             text NOT NULL,
  phone_e164            text UNIQUE,
  email                 citext UNIQUE,
  locale                locale_code NOT NULL DEFAULT 'ar',
  mute_announcements    boolean NOT NULL DEFAULT false,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  erased_at             timestamptz,                    -- PDPL deletion: PII nulled/pseudonymised
  CHECK (erased_at IS NOT NULL OR phone_e164 IS NOT NULL OR email IS NOT NULL)
);

CREATE TABLE device (
  id               uuid PRIMARY KEY,
  person_id        uuid NOT NULL REFERENCES person(id),
  platform         text NOT NULL CHECK (platform IN ('ios','android')),
  push_token       text,
  push_enabled     boolean NOT NULL DEFAULT false,
  locale           locale_code NOT NULL DEFAULT 'ar',
  app_version      text,
  last_seen_at     timestamptz NOT NULL DEFAULT now(),
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (push_token)
);

CREATE TABLE refresh_token (
  token_hash       bytea PRIMARY KEY,
  family_id        uuid NOT NULL,                       -- rotation family; reuse => revoke family
  person_id        uuid NOT NULL REFERENCES person(id),
  device_id        uuid NOT NULL REFERENCES device(id),
  issued_at        timestamptz NOT NULL DEFAULT now(),
  expires_at       timestamptz NOT NULL,                -- +90 days sliding
  rotated_at       timestamptz,
  revoked_at       timestamptz,
  revoke_reason    text
);
CREATE INDEX ON refresh_token (person_id) WHERE revoked_at IS NULL;

CREATE TABLE otp_challenge (
  id               uuid PRIMARY KEY,
  purpose          text NOT NULL CHECK (purpose IN ('activation','resident_login','admin_mfa')),
  subject_id       uuid,                                -- person/admin/invitation id when known
  destination      text NOT NULL,                       -- E.164 or email
  channel          channel NOT NULL CHECK (channel IN ('sms','email')),
  code_hash        bytea NOT NULL,                      -- HMAC-SHA256(code, pepper)
  expires_at       timestamptz NOT NULL,                -- +5 min
  attempts         smallint NOT NULL DEFAULT 0,         -- max 5 wrong codes
  resends          smallint NOT NULL DEFAULT 0,         -- max 3 (R1-AC3)
  consumed_at      timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now()
);

-- ───────────── units, assignments, invitations ─────────────
CREATE TABLE unit (
  id            uuid PRIMARY KEY,
  compound_id   uuid NOT NULL REFERENCES compound(id),
  number        text NOT NULL,
  block         text,
  type          unit_type NOT NULL,
  floor         text,
  notes         text,
  status        record_status NOT NULL DEFAULT 'active',
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (compound_id, id)
);
CREATE UNIQUE INDEX unit_number_uq ON unit (compound_id, lower(number));
CREATE INDEX unit_block_idx ON unit (compound_id, block);

CREATE TABLE unit_assignment (
  id             uuid PRIMARY KEY,
  compound_id    uuid NOT NULL,
  unit_id        uuid NOT NULL,
  person_id      uuid NOT NULL REFERENCES person(id),
  role           assignment_role NOT NULL DEFAULT 'owner',
  status         assignment_status NOT NULL DEFAULT 'invited',
  assigned_by    uuid NOT NULL,                         -- admin_user.id
  activated_at   timestamptz,
  revoked_at     timestamptz,
  revoked_by     uuid,
  created_at     timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (compound_id, unit_id) REFERENCES unit (compound_id, id),
  UNIQUE (compound_id, id)
);
-- exactly one live owner per unit
CREATE UNIQUE INDEX one_live_owner_per_unit ON unit_assignment (unit_id)
  WHERE role = 'owner' AND status <> 'revoked';
CREATE INDEX ON unit_assignment (person_id) WHERE status = 'active';

CREATE TABLE invitation (
  id                   uuid PRIMARY KEY,
  compound_id          uuid NOT NULL,
  assignment_id        uuid NOT NULL,
  token_hash           bytea NOT NULL UNIQUE,           -- sha256 of 32-byte random token
  channels             channel[] NOT NULL,              -- {sms}, {email}, {sms,email}
  locale               locale_code NOT NULL DEFAULT 'ar',
  expires_at           timestamptz NOT NULL,            -- +7 days (Q-6)
  used_at              timestamptz,
  superseded_at        timestamptz,                     -- resend invalidates previous (A2-AC5)
  revoked_at           timestamptz,
  created_by           uuid NOT NULL,
  created_at           timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (compound_id, assignment_id) REFERENCES unit_assignment (compound_id, id)
);
CREATE INDEX ON invitation (assignment_id, created_at DESC);

CREATE TABLE consent_record (
  id               uuid PRIMARY KEY,
  person_id        uuid NOT NULL REFERENCES person(id),
  compound_id      uuid NOT NULL REFERENCES compound(id),
  document         text NOT NULL CHECK (document IN ('privacy_notice','terms')),
  version          text NOT NULL,                       -- e.g. '2026-11-01'
  locale           locale_code NOT NULL,
  accepted_at      timestamptz NOT NULL DEFAULT now(),
  device_id        uuid REFERENCES device(id),
  ip               inet,
  withdrawn_at     timestamptz
);

-- ───────────── requests ─────────────
CREATE TABLE request_category (               -- global, fixed list (A3-AC8)
  code        text PRIMARY KEY,               -- plumbing, electrical, ac_hvac, carpentry_doors,
  name_ar     text NOT NULL,                  -- painting_walls, pest_control, cleaning, other
  name_en     text NOT NULL,
  icon        text NOT NULL,
  sort_order  smallint NOT NULL,
  active      boolean NOT NULL DEFAULT true
);

CREATE TABLE request (
  id                    uuid PRIMARY KEY,
  compound_id           uuid NOT NULL,
  ref_no                integer NOT NULL,                -- shown as REQ-00123
  unit_id               uuid NOT NULL,
  created_by_person_id  uuid NOT NULL REFERENCES person(id),
  category_code         text NOT NULL REFERENCES request_category(code),
  description           text NOT NULL CHECK (char_length(description) BETWEEN 10 AND 1000),
  location_in_unit      text CHECK (char_length(location_in_unit) <= 100),
  preferred_slot        preferred_slot,
  status                request_status NOT NULL DEFAULT 'new',
  close_reason          close_reason,
  reopen_count          smallint NOT NULL DEFAULT 0,
  visit_start_at        timestamptz,                     -- current scheduled visit (denormalised)
  visit_end_at          timestamptz,
  visit_reminder_sent_at timestamptz,
  done_at               timestamptz,                     -- start of 7-day auto-close clock
  closed_at             timestamptz,
  client_request_id     uuid NOT NULL,                   -- Idempotency-Key from app (R2-AC5)
  version               integer NOT NULL DEFAULT 1,      -- optimistic concurrency
  search                tsvector GENERATED ALWAYS AS (to_tsvector('simple', description)) STORED,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (compound_id, unit_id) REFERENCES unit (compound_id, id),
  UNIQUE (compound_id, id),
  UNIQUE (compound_id, ref_no),
  UNIQUE (created_by_person_id, client_request_id),
  CHECK ((visit_start_at IS NULL) = (visit_end_at IS NULL) AND (visit_end_at IS NULL OR visit_end_at > visit_start_at)),
  CHECK ((status = 'closed') = (close_reason IS NOT NULL))
);
CREATE INDEX request_dash_idx    ON request (compound_id, status, created_at DESC);
CREATE INDEX request_updated_idx ON request (compound_id, updated_at DESC);
CREATE INDEX request_unit_idx    ON request (compound_id, unit_id, created_at DESC);
CREATE INDEX request_search_idx  ON request USING gin (search);
CREATE INDEX request_autoclose   ON request (done_at) WHERE status = 'done';
CREATE INDEX request_visit_idx   ON request (visit_start_at) WHERE visit_start_at IS NOT NULL AND status IN ('new','in_progress');

CREATE TABLE request_event (                    -- append-only timeline (§5 "who, what, when")
  id              uuid PRIMARY KEY,
  compound_id     uuid NOT NULL,
  request_id      uuid NOT NULL,
  type            request_event_type NOT NULL,
  actor_type      actor_type NOT NULL,
  actor_id        uuid,                           -- admin_user.id / person.id; NULL for system
  from_status     request_status,
  to_status       request_status,
  body            text CHECK (char_length(body) <= 1000),   -- comment text or reopen reason
  visit_start_at  timestamptz,
  visit_end_at    timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  edited_at       timestamptz,                   -- comments editable ≤ 5 min (A4-AC6)
  deleted_at      timestamptz,
  FOREIGN KEY (compound_id, request_id) REFERENCES request (compound_id, id),
  UNIQUE (compound_id, id)
);
CREATE INDEX ON request_event (request_id, created_at);

CREATE TABLE upload (                           -- photos & attachments (ADR-013)
  id              uuid PRIMARY KEY,
  compound_id     uuid NOT NULL REFERENCES compound(id),
  purpose         upload_purpose NOT NULL,
  uploaded_by_type actor_type NOT NULL,
  uploaded_by_id  uuid NOT NULL,
  object_key      text NOT NULL,                -- attachments/<compound_id>/<id>.<ext>
  content_type    text NOT NULL,
  bytes           integer NOT NULL CHECK (bytes <= 10485760),
  width           integer,
  height          integer,
  sha256          bytea,
  status          upload_status NOT NULL DEFAULT 'pending',
  request_id      uuid,                         -- set on attach
  request_event_id uuid,                        -- reopen photos attach to the reopen event
  announcement_id uuid,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (compound_id, id)
);
CREATE INDEX ON upload (request_id) WHERE request_id IS NOT NULL;

-- ───────────── announcements ─────────────
CREATE TABLE announcement (
  id              uuid PRIMARY KEY,
  compound_id     uuid NOT NULL REFERENCES compound(id),
  title_ar        text CHECK (char_length(title_ar) <= 80),
  body_ar         text CHECK (char_length(body_ar) <= 2000),
  title_en        text CHECK (char_length(title_en) <= 80),
  body_en         text CHECK (char_length(body_en) <= 2000),
  attachment_upload_id uuid,
  audience_type   audience_type NOT NULL,
  send_sms        boolean NOT NULL DEFAULT false,
  status          announcement_status NOT NULL,
  scheduled_at    timestamptz,                   -- NULL = send now
  sent_at         timestamptz,
  recipient_count integer,
  sms_count       integer,
  created_by      uuid NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  deleted_at      timestamptz,
  deleted_by      uuid,
  UNIQUE (compound_id, id),
  CHECK ((title_ar IS NOT NULL AND body_ar IS NOT NULL) OR (title_en IS NOT NULL AND body_en IS NOT NULL))
);
CREATE INDEX ON announcement (status, scheduled_at) WHERE status = 'scheduled';

CREATE TABLE announcement_target (
  announcement_id uuid NOT NULL REFERENCES announcement(id),
  compound_id     uuid NOT NULL,
  block           text,
  unit_id         uuid,
  CHECK ((block IS NULL) <> (unit_id IS NULL))
);

CREATE TABLE announcement_recipient (          -- audience snapshot at send time; read counts (A5-AC5)
  announcement_id uuid NOT NULL REFERENCES announcement(id),
  compound_id     uuid NOT NULL,
  person_id       uuid NOT NULL REFERENCES person(id),
  unit_id         uuid NOT NULL,
  read_at         timestamptz,
  PRIMARY KEY (announcement_id, person_id)
);

-- ───────────── notifications & delivery ─────────────
CREATE TABLE notification (                    -- in-app list (R5-AC2) + outbox
  id              uuid PRIMARY KEY,
  compound_id     uuid NOT NULL REFERENCES compound(id),
  person_id       uuid NOT NULL REFERENCES person(id),
  type            text NOT NULL CHECK (type IN ('request_status_changed','request_comment','visit_scheduled',
                                                'visit_rescheduled','visit_reminder','announcement',
                                                'request_auto_closed','access_revoked')),
  request_id      uuid,
  announcement_id uuid,
  params          jsonb NOT NULL DEFAULT '{}',   -- template params; rendered per locale at read/send time
  sms_fallback    boolean NOT NULL DEFAULT false,
  read_at         timestamptz,
  client_ack_at   timestamptz,                   -- app confirmed push receipt
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON notification (person_id, created_at DESC);

CREATE TABLE message_delivery (                 -- one row per channel send attempt (§8 Observability)
  id                  uuid PRIMARY KEY,
  compound_id         uuid REFERENCES compound(id),   -- NULL for platform-level OTP
  notification_id     uuid REFERENCES notification(id),
  invitation_id       uuid REFERENCES invitation(id),
  otp_challenge_id    uuid REFERENCES otp_challenge(id),
  channel             channel NOT NULL,
  destination_masked  text NOT NULL,             -- +9665*****678 / n***@gmail.com
  device_id           uuid REFERENCES device(id),
  provider            text NOT NULL,             -- fcm | unifonic | email-adapter-name
  provider_message_id text,
  status              delivery_status NOT NULL DEFAULT 'queued',
  failure_code        text,
  failure_reason      text,
  attempts            smallint NOT NULL DEFAULT 0,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON message_delivery (provider, provider_message_id);
CREATE INDEX ON message_delivery (invitation_id) WHERE invitation_id IS NOT NULL;

-- ───────────── audit, privacy, rate limits ─────────────
CREATE TABLE audit_log (                        -- append-only; app role has INSERT+SELECT only
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  compound_id   uuid,
  actor_type    actor_type NOT NULL,
  actor_id      uuid,
  action        text NOT NULL,                  -- e.g. unit.create, owner.assign, invitation.send, request.transition
  entity_type   text NOT NULL,
  entity_id     uuid,
  changes       jsonb,                          -- {field: [old,new]} with PII fields masked
  ip            inet,
  user_agent    text,
  trace_id      text,
  prev_hash     bytea,                          -- hash chain for tamper evidence
  row_hash      bytea NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON audit_log (compound_id, created_at DESC);

CREATE TABLE data_subject_request (
  id            uuid PRIMARY KEY,
  person_id     uuid NOT NULL REFERENCES person(id),
  type          dsr_type NOT NULL,
  details       text,
  status        dsr_status NOT NULL DEFAULT 'received',
  due_at        timestamptz NOT NULL,           -- received + 30 days
  handled_by    uuid,
  completed_at  timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE rate_limit_bucket (
  key           text NOT NULL,                  -- e.g. otp:+9665..., invite:<unit_id>, login:<email>
  window_start  timestamptz NOT NULL,
  count         integer NOT NULL DEFAULT 0,
  PRIMARY KEY (key, window_start)
);

-- ───────────── Row-Level Security ─────────────
-- API sets per transaction:  SET LOCAL app.compound_id = '<uuid>';
-- Resident calls additionally: SET LOCAL app.person_id = '<uuid>';
-- (pattern shown for one table; applied identically to every table having compound_id)
ALTER TABLE request ENABLE ROW LEVEL SECURITY;
ALTER TABLE request FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON request
  USING (compound_id = current_setting('app.compound_id', true)::uuid)
  WITH CHECK (compound_id = current_setting('app.compound_id', true)::uuid);
-- Same policy on: admin_user, unit, unit_assignment, invitation, request_event, upload,
-- announcement, announcement_target, announcement_recipient, notification, message_delivery,
-- consent_record, audit_log.
-- Resident-side unit scoping (only units with an ACTIVE assignment) is enforced in the
-- service layer via the authorisation guard (05-auth-and-roles.md §3) — RLS is the backstop
-- for cross-compound isolation.

REVOKE UPDATE, DELETE ON audit_log FROM app_api, app_worker;
