-- Release 2 — Student Identity and Profile Self-Service
-- Additive migration. Safe to run on the existing Release 1 database, and safe
-- to run more than once. Nothing here drops or rewrites Release 1 data (R2.28).

-- ---------------------------------------------------------------------------
-- Internal identity (R2.01, R2.02)
-- ---------------------------------------------------------------------------
-- github_user_id is GitHub's immutable numeric id, NOT the login name, so a
-- student renaming themselves on GitHub returns to the same profile (R2.02).
CREATE TABLE IF NOT EXISTS users (
  id              TEXT PRIMARY KEY,
  github_user_id  BIGINT NOT NULL UNIQUE,
  github_login    TEXT NOT NULL DEFAULT '',
  algoma_email    TEXT,
  verified_at     TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_login_at   TIMESTAMPTZ
);

-- ---------------------------------------------------------------------------
-- Affiliation verification (R2.04 - R2.09)
-- ---------------------------------------------------------------------------
-- Only a hash of the code is stored, so a database dump or log never reveals a
-- live code. used_at enforces single use (R2.06); expires_at enforces the
-- 30-minute ceiling (R2.07); attempts backs rate limiting (R2.08).
CREATE TABLE IF NOT EXISTS verification_challenges (
  id           BIGSERIAL PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  email        TEXT NOT NULL,
  code_hash    TEXT NOT NULL,
  expires_at   TIMESTAMPTZ NOT NULL,
  used_at      TIMESTAMPTZ,
  attempts     INT NOT NULL DEFAULT 0,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_vc_user ON verification_challenges(user_id);
CREATE INDEX IF NOT EXISTS idx_vc_expires ON verification_challenges(expires_at);

-- ---------------------------------------------------------------------------
-- Profile columns on the existing students table
-- ---------------------------------------------------------------------------
-- Student-owned profiles ARE students rows. Publishing therefore makes a
-- profile discoverable through the Release 1 directory with no synchronisation
-- step and no redeployment (R2.22) — the R1 query already filters on
-- profile_status = 'published'.
ALTER TABLE students ADD COLUMN IF NOT EXISTS user_id       TEXT REFERENCES users(id) ON DELETE CASCADE;
ALTER TABLE students ADD COLUMN IF NOT EXISTS bio           TEXT NOT NULL DEFAULT '';
ALTER TABLE students ADD COLUMN IF NOT EXISTS location_text TEXT NOT NULL DEFAULT '';
ALTER TABLE students ADD COLUMN IF NOT EXISTS contact_email TEXT NOT NULL DEFAULT '';
ALTER TABLE students ADD COLUMN IF NOT EXISTS education     TEXT NOT NULL DEFAULT '';
ALTER TABLE students ADD COLUMN IF NOT EXISTS experience    TEXT NOT NULL DEFAULT '';

-- Per-field public visibility (R2.18). Enforced server-side when building any
-- public response (R2.19) — never by hiding things in the frontend.
ALTER TABLE students ADD COLUMN IF NOT EXISTS visibility JSONB NOT NULL
  DEFAULT '{"availability":true,"links":true,"location":true,"contact_email":false,"education":true,"experience":true}'::jsonb;

-- Controlled presentation (R2.23). Theme is constrained to a known set so a
-- student cannot inject arbitrary styling, and presentation is kept separate
-- from the structured fields employers search (R2.24).
ALTER TABLE students ADD COLUMN IF NOT EXISTS theme TEXT NOT NULL DEFAULT 'classic';
ALTER TABLE students ADD COLUMN IF NOT EXISTS section_order JSONB NOT NULL
  DEFAULT '["about","skills","projects","experience"]'::jsonb;

DO $$ BEGIN
  ALTER TABLE students ADD CONSTRAINT students_theme_allowed
    CHECK (theme IN ('classic','slate','warm'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- profile_status already exists from R1 ('published' / 'unpublished').
-- R2 adds 'draft' for a profile that has never been published (R2.10).
DO $$ BEGIN
  ALTER TABLE students ADD CONSTRAINT students_profile_status_allowed
    CHECK (profile_status IN ('draft','unpublished','published'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_students_user ON students(user_id) WHERE user_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Resume import (R2.13 - R2.17)
-- ---------------------------------------------------------------------------
-- The uploaded PDF itself is NOT stored. It is parsed in memory and discarded,
-- which R2.18 explicitly permits and which removes any question of a private
-- resume being publicly downloadable. Only the extracted candidate values are
-- kept, and only until the student accepts or rejects them (R2.15).
CREATE TABLE IF NOT EXISTS resume_imports (
  id           BIGSERIAL PRIMARY KEY,
  student_id   TEXT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  filename     TEXT NOT NULL DEFAULT '',
  candidates   JSONB NOT NULL DEFAULT '{}'::jsonb,
  status       TEXT NOT NULL DEFAULT 'pending',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at  TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_resume_imports_student ON resume_imports(student_id);

DO $$ BEGIN
  ALTER TABLE resume_imports ADD CONSTRAINT resume_imports_status_allowed
    CHECK (status IN ('pending','applied','rejected'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ---------------------------------------------------------------------------
-- Skill suggestions (R2.12)
-- ---------------------------------------------------------------------------
-- A student may propose a skill that is not yet standardized. It is recorded
-- here for review and is NOT added to the public filter vocabulary, so
-- "c#", "C sharp" and "C#" can never become three separate filter options.
CREATE TABLE IF NOT EXISTS skill_suggestions (
  id           BIGSERIAL PRIMARY KEY,
  student_id   TEXT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  suggested    TEXT NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ---------------------------------------------------------------------------
-- Sessions (R2.01)
-- ---------------------------------------------------------------------------
-- Server-side sessions, so the browser only ever holds an opaque id. Render's
-- free tier restarts services, and a database-backed session survives that.
CREATE TABLE IF NOT EXISTS sessions (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at  TIMESTAMPTZ NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
