-- Team 08 — Release 1 schema (PostgreSQL / Supabase)
-- Student skills and project technologies are SEPARATE tables on purpose (R1.15).

CREATE TABLE IF NOT EXISTS students (
  id             TEXT PRIMARY KEY,
  name           TEXT NOT NULL,
  headline       TEXT NOT NULL DEFAULT '',
  program        TEXT NOT NULL DEFAULT '',
  status         TEXT NOT NULL,
  profile_status TEXT NOT NULL,
  links          JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS skills (
  name TEXT PRIMARY KEY
);

CREATE TABLE IF NOT EXISTS student_skills (
  student_id TEXT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  skill_name TEXT NOT NULL REFERENCES skills(name) ON DELETE CASCADE,
  PRIMARY KEY (student_id, skill_name)
);

CREATE TABLE IF NOT EXISTS student_availability (
  student_id TEXT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  value      TEXT NOT NULL,
  PRIMARY KEY (student_id, value)
);

CREATE TABLE IF NOT EXISTS projects (
  id          TEXT PRIMARY KEY,
  title       TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  domain      TEXT NOT NULL DEFAULT '',
  links       JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS project_technologies (
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  technology TEXT NOT NULL,
  PRIMARY KEY (project_id, technology)
);

CREATE TABLE IF NOT EXISTS project_contributors (
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  student_id TEXT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  role       TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (project_id, student_id)
);

CREATE TABLE IF NOT EXISTS inquiries (
  id            SERIAL PRIMARY KEY,
  source_type   TEXT NOT NULL,
  source_id     TEXT NOT NULL,
  source_name   TEXT NOT NULL,
  source_url    TEXT NOT NULL DEFAULT '',
  company_name  TEXT NOT NULL,
  contact_name  TEXT NOT NULL,
  contact_email TEXT NOT NULL,
  description   TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_students_profile_status ON students(profile_status);
CREATE INDEX IF NOT EXISTS idx_student_skills_skill ON student_skills(skill_name);
CREATE INDEX IF NOT EXISTS idx_project_contributors_student ON project_contributors(student_id);
