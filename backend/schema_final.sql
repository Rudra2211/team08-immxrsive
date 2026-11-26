-- Final Release — legacy migration, profile claims, alumni/availability,
-- retirement, duplicate merge, demo state and operational diagnostics.
-- Additive and idempotent like the earlier migrations: nothing is dropped and
-- no existing row is rewritten, so R1-R4 data survives (F.39).

-- ---------------------------------------------------------------------------
-- Stable identity for migrated records (F.01, F.02, F.06)
-- ---------------------------------------------------------------------------
-- The legacy system's id maps to our own stable internal id. Re-running an
-- import looks records up here, never by name, email, repository URL or
-- company domain, so a renamed person or company keeps one record.
CREATE TABLE IF NOT EXISTS legacy_ids (
  kind         TEXT NOT NULL,            -- student | project | company | collaboration
  legacy_id    TEXT NOT NULL,
  internal_id  TEXT NOT NULL,
  content_hash TEXT NOT NULL DEFAULT '',
  first_run_id BIGINT,
  imported_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (kind, legacy_id)
);
CREATE INDEX IF NOT EXISTS idx_legacy_ids_internal ON legacy_ids(kind, internal_id);

CREATE TABLE IF NOT EXISTS migration_runs (
  id           BIGSERIAL PRIMARY KEY,
  source_name  TEXT NOT NULL DEFAULT '',
  format       TEXT NOT NULL DEFAULT 'legacy',
  run_by       TEXT NOT NULL DEFAULT '',
  report       JSONB NOT NULL DEFAULT '{}'::jsonb,
  archived_at  TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ---------------------------------------------------------------------------
-- Student profile: claim, availability, lifecycle, merge (F.07-F.18)
-- ---------------------------------------------------------------------------
-- legacy_email is private: it is used only to decide whether a claim may be
-- approved automatically and is never part of a public or non-owner response.
ALTER TABLE students ADD COLUMN IF NOT EXISTS legacy_email TEXT NOT NULL DEFAULT '';
ALTER TABLE students ADD COLUMN IF NOT EXISTS availability_mode TEXT NOT NULL DEFAULT 'active';
ALTER TABLE students ADD COLUMN IF NOT EXISTS availability_confirmed_at TIMESTAMPTZ;
ALTER TABLE students ADD COLUMN IF NOT EXISTS retired_at TIMESTAMPTZ;
ALTER TABLE students ADD COLUMN IF NOT EXISTS merged_into TEXT REFERENCES students(id) ON DELETE SET NULL;
ALTER TABLE students ADD COLUMN IF NOT EXISTS import_run_id BIGINT;

DO $$ BEGIN
  ALTER TABLE students ADD CONSTRAINT students_availability_mode_allowed
    CHECK (availability_mode IN ('active', 'showcase'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- F.15 — 'retired' (archived, restorable) and 'merged' (F.17) join the
-- existing draft/unpublished/published states. Neither deletes anything.
ALTER TABLE students DROP CONSTRAINT IF EXISTS students_profile_status_allowed;
ALTER TABLE students ADD CONSTRAINT students_profile_status_allowed
  CHECK (profile_status IN ('draft', 'unpublished', 'published', 'retired', 'merged'));

-- Profiles that already list availability count as confirmed the first time
-- this runs, so R1-R4 data keeps its availability (F.39). Later runs touch
-- nothing: the column is no longer NULL for them.
UPDATE students SET availability_confirmed_at = NOW()
 WHERE availability_confirmed_at IS NULL
   AND import_run_id IS NULL
   AND EXISTS (SELECT 1 FROM student_availability sa WHERE sa.student_id = students.id);

CREATE INDEX IF NOT EXISTS idx_students_status_name ON students(profile_status, name, id);

CREATE TABLE IF NOT EXISTS profile_claims (
  id            BIGSERIAL PRIMARY KEY,
  student_id    TEXT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  note          TEXT NOT NULL DEFAULT '',
  status        TEXT NOT NULL DEFAULT 'pending',
  method        TEXT NOT NULL DEFAULT 'staff',
  decided_by    TEXT NOT NULL DEFAULT '',
  decision_note TEXT NOT NULL DEFAULT '',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  decided_at    TIMESTAMPTZ
);
DO $$ BEGIN
  ALTER TABLE profile_claims ADD CONSTRAINT profile_claims_status_allowed
    CHECK (status IN ('pending', 'approved', 'rejected'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE UNIQUE INDEX IF NOT EXISTS idx_profile_claims_pending
  ON profile_claims(student_id, user_id) WHERE status = 'pending';

-- Ownership and record changes made by staff or by a claim, for audit (F.10, F.17, F.19).
CREATE TABLE IF NOT EXISTS ownership_events (
  id          BIGSERIAL PRIMARY KEY,
  kind        TEXT NOT NULL,
  subject_id  TEXT NOT NULL,
  from_value  TEXT NOT NULL DEFAULT '',
  to_value    TEXT NOT NULL DEFAULT '',
  actor       TEXT NOT NULL DEFAULT '',
  note        TEXT NOT NULL DEFAULT '',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ---------------------------------------------------------------------------
-- Companies: merge continuity (F.17, F.18)
-- ---------------------------------------------------------------------------
ALTER TABLE companies ADD COLUMN IF NOT EXISTS merged_into TEXT REFERENCES companies(id) ON DELETE SET NULL;
ALTER TABLE companies DROP CONSTRAINT IF EXISTS companies_status_allowed;
ALTER TABLE companies ADD CONSTRAINT companies_status_allowed
  CHECK (status IN ('draft', 'published', 'merged'));

-- ---------------------------------------------------------------------------
-- Projects: demo state and import batch (F.27, F.37)
-- ---------------------------------------------------------------------------
ALTER TABLE projects ADD COLUMN IF NOT EXISTS demo_status TEXT NOT NULL DEFAULT 'available';
ALTER TABLE projects ADD COLUMN IF NOT EXISTS demo_status_note TEXT NOT NULL DEFAULT '';
ALTER TABLE projects ADD COLUMN IF NOT EXISTS import_run_id BIGINT;
DO $$ BEGIN
  ALTER TABLE projects ADD CONSTRAINT projects_demo_status_allowed
    CHECK (demo_status IN ('available', 'unavailable', 'archived', 'replaced'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
ALTER TABLE projects DROP CONSTRAINT IF EXISTS projects_status_allowed;
ALTER TABLE projects ADD CONSTRAINT projects_status_allowed
  CHECK (project_status IN ('draft', 'published', 'archived'));
ALTER TABLE companies ADD COLUMN IF NOT EXISTS import_run_id BIGINT;

-- ---------------------------------------------------------------------------
-- Operational diagnostics (F.32) — staff-only, never public
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS diagnostic_events (
  id          BIGSERIAL PRIMARY KEY,
  kind        TEXT NOT NULL,
  context     JSONB NOT NULL DEFAULT '{}'::jsonb,
  message     TEXT NOT NULL DEFAULT '',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_diagnostic_events_created ON diagnostic_events(created_at DESC);
