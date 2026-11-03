-- Release 3 — Shared Projects, Contributor Evidence, and Basic Playable Demos
-- Additive migration over R1 + R2. Safe to run repeatedly and safe to run on
-- the existing database: nothing here drops a table, drops a column, or
-- rewrites an existing row, so R1 fixture data and R2 profiles survive intact
-- (R3.25).

-- ---------------------------------------------------------------------------
-- Shared project record (R3.05, R3.06, R3.26)
-- ---------------------------------------------------------------------------
-- The R1 `projects` table already IS the canonical shared record referenced by
-- many students through project_contributors, so R3 extends it rather than
-- introducing a parallel table. That is what makes R3.05 true by construction
-- and keeps the public URL stable through maintainer transfer (R3.26).

ALTER TABLE projects ADD COLUMN IF NOT EXISTS maintainer_student_id TEXT
  REFERENCES students(id) ON DELETE SET NULL;

-- R1 fixture projects are already public, so the default must be 'published'
-- or the R1 directory and project pages would empty out on deploy (R3.25).
-- Student-created projects are explicitly inserted as 'draft' by the API.
ALTER TABLE projects ADD COLUMN IF NOT EXISTS project_status TEXT NOT NULL DEFAULT 'published';

ALTER TABLE projects ADD COLUMN IF NOT EXISTS date_text  TEXT NOT NULL DEFAULT '';
ALTER TABLE projects ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
ALTER TABLE projects ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

-- R3.17 — optimistic concurrency. Every shared-field update must present the
-- version it read; the UPDATE matches on it, so a save from a stale version
-- affects zero rows and is reported as a conflict instead of overwriting.
ALTER TABLE projects ADD COLUMN IF NOT EXISTS version INT NOT NULL DEFAULT 1;

DO $$ BEGIN
  ALTER TABLE projects ADD CONSTRAINT projects_status_allowed
    CHECK (project_status IN ('draft', 'published'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ---------------------------------------------------------------------------
-- Presentation links, kept in separate slots (R3.18, R3.21)
-- ---------------------------------------------------------------------------
-- Separate columns rather than one JSON blob because R3.18 requires the three
-- kinds to be distinguishable, and R3.20 needs to know specifically whether a
-- PLAYABLE url exists before offering a Play Demo action.
-- Only URLs are stored. No raw HTML is ever accepted or rendered (R3.19).
ALTER TABLE projects ADD COLUMN IF NOT EXISTS playable_url       TEXT NOT NULL DEFAULT '';
ALTER TABLE projects ADD COLUMN IF NOT EXISTS video_url          TEXT NOT NULL DEFAULT '';
ALTER TABLE projects ADD COLUMN IF NOT EXISTS fallback_image_url TEXT NOT NULL DEFAULT '';
ALTER TABLE projects ADD COLUMN IF NOT EXISTS fallback_note      TEXT NOT NULL DEFAULT '';

-- ---------------------------------------------------------------------------
-- Repository links (R3.03, R3.04, R3.16)
-- ---------------------------------------------------------------------------
-- A separate table, not a column, because R3.04 requires zero, one or many
-- repositories per project and requires a project to stay valid when one is
-- disconnected. `normalized` is the comparison key for the duplicate warning:
-- host + path, lowercased, without scheme, "www.", ".git" or a trailing slash,
-- so the same repo typed three ways is recognised once (R3.16).
CREATE TABLE IF NOT EXISTS project_repositories (
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  url        TEXT NOT NULL,
  normalized TEXT NOT NULL,
  added_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (project_id, normalized)
);
CREATE INDEX IF NOT EXISTS idx_project_repositories_normalized
  ON project_repositories(normalized);

-- ---------------------------------------------------------------------------
-- Contributor relationship (R3.08 - R3.13, R3.15)
-- ---------------------------------------------------------------------------
-- Extends the R1 project_contributors table. Defaults matter here:
--   status     DEFAULT 'accepted'  so the R1 fixture contributors remain
--                                  publicly visible after this migration.
--                                  New invitations are inserted as 'invited'
--                                  and are never shown publicly (R3.09).
--   featured   DEFAULT TRUE        so R1 student pages keep listing projects.
--   removed_at DEFAULT NULL        a soft delete. A maintainer removal sets it
--                                  and can clear it again, so an accepted
--                                  relationship is never destroyed by one
--                                  unilateral action (R3.13).
ALTER TABLE project_contributors ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'accepted';
ALTER TABLE project_contributors ADD COLUMN IF NOT EXISTS contribution_statement TEXT NOT NULL DEFAULT '';
ALTER TABLE project_contributors ADD COLUMN IF NOT EXISTS featured BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE project_contributors ADD COLUMN IF NOT EXISTS invited_at   TIMESTAMPTZ NOT NULL DEFAULT NOW();
ALTER TABLE project_contributors ADD COLUMN IF NOT EXISTS responded_at TIMESTAMPTZ;
ALTER TABLE project_contributors ADD COLUMN IF NOT EXISTS removed_at   TIMESTAMPTZ;
ALTER TABLE project_contributors ADD COLUMN IF NOT EXISTS invited_by   TEXT
  REFERENCES students(id) ON DELETE SET NULL;

DO $$ BEGIN
  ALTER TABLE project_contributors ADD CONSTRAINT project_contributors_status_allowed
    CHECK (status IN ('invited', 'accepted', 'declined'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Deliberately NO check constraint on project_contributors.role.
-- R3.10 wants a standardized role, and the API validates new and updated roles
-- against data/standard_roles.json. A database constraint would instead reject
-- the R1 fixture roles already stored as free text, which would mean a data
-- migration and an R3.25 regression risk in exchange for nothing the
-- requirement asks for.
-- shortcut: legacy free-text roles stay as-is, upgrade when fixtures are reseeded.

CREATE INDEX IF NOT EXISTS idx_project_contributors_project_status
  ON project_contributors(project_id, status);
CREATE INDEX IF NOT EXISTS idx_projects_maintainer
  ON projects(maintainer_student_id);
