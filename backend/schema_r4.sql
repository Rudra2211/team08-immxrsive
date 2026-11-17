-- Team 08 — Release 4: staff operations, industry partners, collaborations.
-- Additive and idempotent, like the R2 and R3 migrations: every boot re-runs it.

-- ---------------------------------------------------------------------------
-- Staff role (R4.01, R4.02)
-- ---------------------------------------------------------------------------
-- Staff are users with role 'staff'. They sign in with a username and password
-- (stored only as a scrypt hash) instead of GitHub, so a reviewer can be given a
-- staff test account without anyone's personal GitHub login. A staff row has no
-- GitHub id, so that column becomes optional; UNIQUE still applies to real ids.
ALTER TABLE users ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'student';
ALTER TABLE users ADD COLUMN IF NOT EXISTS username TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash TEXT;
ALTER TABLE users ALTER COLUMN github_user_id DROP NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username ON users(username) WHERE username IS NOT NULL;
DO $$ BEGIN
  ALTER TABLE users ADD CONSTRAINT users_role_allowed CHECK (role IN ('student', 'staff'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ---------------------------------------------------------------------------
-- Official project verification (R4.04 - R4.06)
-- ---------------------------------------------------------------------------
-- The marker lives on the project but only staff routes ever write it; the
-- student project editor whitelists its own fields and never touches these.
ALTER TABLE projects ADD COLUMN IF NOT EXISTS verified_at   TIMESTAMPTZ;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS verified_by   TEXT;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS verified_note TEXT NOT NULL DEFAULT '';

CREATE TABLE IF NOT EXISTS verification_requests (
  id             TEXT PRIMARY KEY,
  project_id     TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  requested_by   TEXT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  note           TEXT NOT NULL DEFAULT '',
  evidence_url   TEXT NOT NULL DEFAULT '',
  status         TEXT NOT NULL DEFAULT 'pending',
  decided_by     TEXT,
  decision_note  TEXT NOT NULL DEFAULT '',
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  decided_at     TIMESTAMPTZ
);
DO $$ BEGIN
  ALTER TABLE verification_requests ADD CONSTRAINT verification_requests_status_allowed
    CHECK (status IN ('pending', 'approved', 'rejected'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
-- One open request per project at a time (a repeat click cannot queue twins).
CREATE UNIQUE INDEX IF NOT EXISTS idx_verification_one_pending
  ON verification_requests(project_id) WHERE status = 'pending';

-- ---------------------------------------------------------------------------
-- Companies / industry partners (R4.07 - R4.14)
-- ---------------------------------------------------------------------------
-- status: 'draft' until staff publish it. An import never publishes (R4.09).
-- field_sources records, per field, where the current value came from:
--   {"name": {"source": "import", "url": "...", "at": "..."},
--    "description": {"source": "staff", "at": "..."}}   (R4.12)
CREATE TABLE IF NOT EXISTS companies (
  id             TEXT PRIMARY KEY,
  name           TEXT NOT NULL,
  website        TEXT NOT NULL DEFAULT '',
  domain         TEXT NOT NULL DEFAULT '',
  description    TEXT NOT NULL DEFAULT '',
  sector         TEXT NOT NULL DEFAULT '',
  keywords       TEXT[] NOT NULL DEFAULT '{}',
  location       TEXT NOT NULL DEFAULT '',
  status         TEXT NOT NULL DEFAULT 'draft',
  field_sources  JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by     TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  published_at   TIMESTAMPTZ
);
DO $$ BEGIN
  ALTER TABLE companies ADD CONSTRAINT companies_status_allowed CHECK (status IN ('draft', 'published'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE INDEX IF NOT EXISTS idx_companies_domain ON companies(domain);

-- Every website import attempt, successful or not: the source history (R4.12)
-- and the record that a failed fetch left the draft untouched (R4.11).
CREATE TABLE IF NOT EXISTS company_imports (
  id             TEXT PRIMARY KEY,
  company_id     TEXT REFERENCES companies(id) ON DELETE CASCADE,
  source_url     TEXT NOT NULL,
  final_url      TEXT NOT NULL DEFAULT '',
  ok             BOOLEAN NOT NULL,
  error          TEXT NOT NULL DEFAULT '',
  candidate      JSONB NOT NULL DEFAULT '{}'::jsonb,
  flagged_text   TEXT[] NOT NULL DEFAULT '{}',
  imported_by    TEXT,
  imported_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_company_imports_company ON company_imports(company_id);

-- ---------------------------------------------------------------------------
-- Collaborations (R4.15 - R4.19, R4.23)
-- ---------------------------------------------------------------------------
-- visibility: public (full), limited (only public_summary, years and status),
-- private (never returned by any public route).
CREATE TABLE IF NOT EXISTS collaborations (
  id             TEXT PRIMARY KEY,
  company_id     TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  title          TEXT NOT NULL,
  start_year     INT,
  end_year       INT,
  description    TEXT NOT NULL DEFAULT '',
  outcome        TEXT NOT NULL DEFAULT '',
  status         TEXT NOT NULL DEFAULT 'current',
  visibility     TEXT NOT NULL DEFAULT 'private',
  public_summary TEXT NOT NULL DEFAULT '',
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
DO $$ BEGIN
  ALTER TABLE collaborations ADD CONSTRAINT collaborations_status_allowed CHECK (status IN ('current', 'past'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE collaborations ADD CONSTRAINT collaborations_visibility_allowed
    CHECK (visibility IN ('public', 'limited', 'private'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE INDEX IF NOT EXISTS idx_collaborations_company ON collaborations(company_id);

CREATE TABLE IF NOT EXISTS collaboration_projects (
  collaboration_id TEXT NOT NULL REFERENCES collaborations(id) ON DELETE CASCADE,
  project_id       TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  PRIMARY KEY (collaboration_id, project_id)
);
CREATE TABLE IF NOT EXISTS collaboration_students (
  collaboration_id TEXT NOT NULL REFERENCES collaborations(id) ON DELETE CASCADE,
  student_id       TEXT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  PRIMARY KEY (collaboration_id, student_id)
);

-- ---------------------------------------------------------------------------
-- Student industry-association requests (R4.20, R4.21, R4.17)
-- ---------------------------------------------------------------------------
-- A request is never itself a relationship. Only staff approval writes a row
-- into project_partners, which is what public pages read.
CREATE TABLE IF NOT EXISTS partner_requests (
  id                TEXT PRIMARY KEY,
  project_id        TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  requested_by      TEXT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  company_id        TEXT REFERENCES companies(id) ON DELETE SET NULL,
  suggested_name    TEXT NOT NULL DEFAULT '',
  suggested_website TEXT NOT NULL DEFAULT '',
  explanation       TEXT NOT NULL DEFAULT '',
  status            TEXT NOT NULL DEFAULT 'pending',
  decided_by        TEXT,
  decision_note     TEXT NOT NULL DEFAULT '',
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  decided_at        TIMESTAMPTZ
);
DO $$ BEGIN
  ALTER TABLE partner_requests ADD CONSTRAINT partner_requests_status_allowed
    CHECK (status IN ('pending', 'approved', 'rejected'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS project_partners (
  project_id   TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  company_id   TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  request_id   TEXT,
  approved_by  TEXT,
  approved_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (project_id, company_id)
);
