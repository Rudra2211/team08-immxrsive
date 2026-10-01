/**
 * Imports the supplied Release 1 fixtures into PostgreSQL (R1.03).
 * Idempotent: safe to run repeatedly. Run with `npm run import`,
 * or automatically on boot when SEED_ON_BOOT is not "false".
 */
const fs = require("fs");
const path = require("path");
const { pool, initDb } = require("./db");

const readFixture = (file) =>
  JSON.parse(fs.readFileSync(path.join(__dirname, "data", file), "utf8"));

async function importFixtures() {
  const students = readFixture("students.json");
  const projects = readFixture("projects.json");
  const skills = readFixture("skills.json");

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    for (const name of skills) {
      await client.query(
        "INSERT INTO skills (name) VALUES ($1) ON CONFLICT (name) DO NOTHING",
        [name]
      );
    }

    for (const s of students) {
      await client.query(
        `INSERT INTO students (id, name, headline, program, status, profile_status, links)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT (id) DO UPDATE SET
           name = EXCLUDED.name,
           headline = EXCLUDED.headline,
           program = EXCLUDED.program,
           status = EXCLUDED.status,
           profile_status = EXCLUDED.profile_status,
           links = EXCLUDED.links`,
        [s.id, s.name, s.headline || "", s.program || "", s.status,
         s.profile_status, JSON.stringify(s.links || {})]
      );

      await client.query("DELETE FROM student_skills WHERE student_id = $1", [s.id]);
      for (const skill of s.skills || []) {
        // Skills outside the standardized set are registered first so the
        // foreign key holds, but the filter list still comes from skills.json.
        await client.query(
          "INSERT INTO skills (name) VALUES ($1) ON CONFLICT (name) DO NOTHING",
          [skill]
        );
        await client.query(
          "INSERT INTO student_skills (student_id, skill_name) VALUES ($1,$2) ON CONFLICT DO NOTHING",
          [s.id, skill]
        );
      }

      await client.query("DELETE FROM student_availability WHERE student_id = $1", [s.id]);
      for (const value of s.availability || []) {
        await client.query(
          "INSERT INTO student_availability (student_id, value) VALUES ($1,$2) ON CONFLICT DO NOTHING",
          [s.id, value]
        );
      }
    }

    for (const p of projects) {
      await client.query(
        `INSERT INTO projects (id, title, description, domain, links)
         VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (id) DO UPDATE SET
           title = EXCLUDED.title,
           description = EXCLUDED.description,
           domain = EXCLUDED.domain,
           links = EXCLUDED.links`,
        [p.id, p.title, p.description || "", p.domain || "", JSON.stringify(p.links || {})]
      );

      await client.query("DELETE FROM project_technologies WHERE project_id = $1", [p.id]);
      for (const tech of p.technologies || []) {
        await client.query(
          "INSERT INTO project_technologies (project_id, technology) VALUES ($1,$2) ON CONFLICT DO NOTHING",
          [p.id, tech]
        );
      }

      await client.query("DELETE FROM project_contributors WHERE project_id = $1", [p.id]);
      for (const c of p.contributors || []) {
        const exists = await client.query("SELECT 1 FROM students WHERE id = $1", [c.student_id]);
        if (exists.rowCount === 0) {
          console.warn(`Skipping contributor ${c.student_id} on ${p.id}: unknown student.`);
          continue;
        }
        await client.query(
          "INSERT INTO project_contributors (project_id, student_id, role) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING",
          [p.id, c.student_id, c.role || ""]
        );
      }
    }

    await client.query("COMMIT");
    console.log(`Imported ${students.length} students, ${projects.length} projects, ${skills.length} skills.`);
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

if (require.main === module) {
  initDb()
    .then(importFixtures)
    .then(() => pool.end())
    .then(() => process.exit(0))
    .catch((err) => {
      console.error("Import failed:", err.message);
      process.exit(1);
    });
}

module.exports = { importFixtures };
