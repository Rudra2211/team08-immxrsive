const express = require("express");
const cors = require("cors");
const { pool, initDb } = require("./db");
const { importFixtures } = require("./import");

const app = express();
const PORT = process.env.PORT || 3000;

const allowedOrigins = (process.env.CORS_ORIGIN || "")
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);

app.use(cors({ origin: allowedOrigins.length ? allowedOrigins : true }));
app.use(express.json());

/** Query params may arrive as ?skill=A&skill=B or ?skill=A,B. Normalise both. */
function toList(value) {
  if (value === undefined || value === null) return [];
  const raw = Array.isArray(value) ? value : [value];
  return raw
    .flatMap((v) => String(v).split(","))
    .map((v) => v.trim())
    .filter(Boolean);
}

app.get("/", (req, res) => {
  res.json({
    service: "team08-immxrsive-backend",
    release: "R1",
    health: "/health",
    endpoints: ["/api/students", "/api/students/{id}", "/api/projects", "/api/projects/{id}", "/api/skills"],
  });
});

app.get("/health", async (req, res) => {
  try {
    const r = await pool.query("SELECT COUNT(*)::int AS n FROM students");
    res.json({ status: "ok", database: "connected", students: r.rows[0].n, time: new Date().toISOString() });
  } catch (err) {
    console.error("Health check failed:", err.message);
    res.status(503).json({ status: "error", database: "unreachable" });
  }
});

/** Standardized skill set used by the skill filter (R1.05). */
app.get("/api/skills", async (req, res) => {
  try {
    const r = await pool.query("SELECT name FROM skills ORDER BY name ASC");
    res.json(r.rows.map((row) => row.name));
  } catch (err) {
    console.error("GET /api/skills failed:", err.message);
    res.status(500).json({ error: "Could not load skills." });
  }
});

/**
 * Public talent directory (R1.01, R1.04–R1.10, R1.20).
 *   q            case-insensitive substring over name, headline, skill names
 *   skill        repeatable; multiple skills combine with AND
 *   availability repeatable; values within the category combine with OR
 *   status       repeatable; values within the category combine with OR
 * Categories combine with AND. Only published profiles are ever returned.
 */
app.get("/api/students", async (req, res) => {
  const q = (req.query.q || "").toString().trim();
  const skills = toList(req.query.skill);
  const availability = toList(req.query.availability);
  const status = toList(req.query.status);

  const params = [];
  const where = ["s.profile_status = 'published'"];

   if (q) {
    // Each whitespace-separated term must match somewhere, so "Unity C#" finds
    // students holding both rather than searching for that literal phrase (issue #1).
    for (const term of q.split(/[\s,]+/).filter(Boolean)) {
      params.push(`%${term}%`);
      const p = `$${params.length}`;
      where.push(`(
        s.name ILIKE ${p}
        OR s.headline ILIKE ${p}
        OR EXISTS (
          SELECT 1 FROM student_skills ss
          WHERE ss.student_id = s.id AND ss.skill_name ILIKE ${p}
        )
      )`);
    }
  }

  if (skills.length) {
    params.push(skills);
    const p = `$${params.length}`;
    params.push(skills.length);
    const n = `$${params.length}`;
    // AND semantics: the student must hold every selected skill (R1.06).
    where.push(`(
      SELECT COUNT(DISTINCT ss.skill_name) FROM student_skills ss
      WHERE ss.student_id = s.id AND ss.skill_name = ANY(${p}::text[])
    ) = ${n}`);
  }

  if (availability.length) {
    params.push(availability);
    const p = `$${params.length}`;
    where.push(`EXISTS (
      SELECT 1 FROM student_availability sa
      WHERE sa.student_id = s.id AND sa.value = ANY(${p}::text[])
    )`);
  }

  if (status.length) {
    params.push(status);
    where.push(`s.status = ANY($${params.length}::text[])`);
  }

  const sql = `
    SELECT
      s.id, s.name, s.headline, s.program, s.status, s.links,
      COALESCE((SELECT ARRAY_AGG(ss.skill_name ORDER BY ss.skill_name)
                FROM student_skills ss WHERE ss.student_id = s.id), '{}') AS skills,
      COALESCE((SELECT ARRAY_AGG(sa.value ORDER BY sa.value)
                FROM student_availability sa WHERE sa.student_id = s.id), '{}') AS availability,
      (SELECT COUNT(*)::int FROM project_contributors pc WHERE pc.student_id = s.id) AS project_count
    FROM students s
    WHERE ${where.join("\n      AND ")}
    ORDER BY s.name ASC, s.id ASC`; // stable, deterministic order (R1.10)

  try {
    const r = await pool.query(sql, params);
    res.json(r.rows);
  } catch (err) {
    console.error("GET /api/students failed:", err.message);
    res.status(500).json({ error: "Could not load students." });
  }
});

/** Student detail, including project evidence (R1.13, R1.14). */
app.get("/api/students/:id", async (req, res) => {
  const id = req.params.id;
  try {
    const r = await pool.query(
      `SELECT s.id, s.name, s.headline, s.program, s.status, s.links,
        COALESCE((SELECT ARRAY_AGG(ss.skill_name ORDER BY ss.skill_name)
                  FROM student_skills ss WHERE ss.student_id = s.id), '{}') AS skills,
        COALESCE((SELECT ARRAY_AGG(sa.value ORDER BY sa.value)
                  FROM student_availability sa WHERE sa.student_id = s.id), '{}') AS availability
       FROM students s
       WHERE s.id = $1 AND s.profile_status = 'published'`,
      [id]
    );
    if (r.rowCount === 0) {
      return res.status(404).json({ error: "Student not found." });
    }

    const projects = await pool.query(
      `SELECT p.id, p.title, p.description, p.domain, pc.role,
        COALESCE((SELECT ARRAY_AGG(pt.technology ORDER BY pt.technology)
                  FROM project_technologies pt WHERE pt.project_id = p.id), '{}') AS technologies
       FROM project_contributors pc
       JOIN projects p ON p.id = pc.project_id
       WHERE pc.student_id = $1
       ORDER BY p.title ASC, p.id ASC`,
      [id]
    );

    res.json({ ...r.rows[0], projects: projects.rows });
  } catch (err) {
    console.error("GET /api/students/:id failed:", err.message);
    res.status(500).json({ error: "Could not load student." });
  }
});

app.get("/api/projects", async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT p.id, p.title, p.description, p.domain, p.links,
        COALESCE((SELECT ARRAY_AGG(pt.technology ORDER BY pt.technology)
                  FROM project_technologies pt WHERE pt.project_id = p.id), '{}') AS technologies
       FROM projects p ORDER BY p.title ASC, p.id ASC`
    );
    res.json(r.rows);
  } catch (err) {
    console.error("GET /api/projects failed:", err.message);
    res.status(500).json({ error: "Could not load projects." });
  }
});

/** Project detail with contributors and roles (R1.16, R1.17). */
app.get("/api/projects/:id", async (req, res) => {
  const id = req.params.id;
  try {
    const r = await pool.query(
      `SELECT p.id, p.title, p.description, p.domain, p.links,
        COALESCE((SELECT ARRAY_AGG(pt.technology ORDER BY pt.technology)
                  FROM project_technologies pt WHERE pt.project_id = p.id), '{}') AS technologies
       FROM projects p WHERE p.id = $1`,
      [id]
    );
    if (r.rowCount === 0) {
      return res.status(404).json({ error: "Project not found." });
    }

    // Unpublished students are not exposed anywhere public (R1.20).
    const contributors = await pool.query(
      `SELECT s.id AS student_id, s.name, s.headline, pc.role
       FROM project_contributors pc
       JOIN students s ON s.id = pc.student_id
       WHERE pc.project_id = $1 AND s.profile_status = 'published'
       ORDER BY s.name ASC, s.id ASC`,
      [id]
    );

    res.json({ ...r.rows[0], contributors: contributors.rows });
  } catch (err) {
    console.error("GET /api/projects/:id failed:", err.message);
    res.status(500).json({ error: "Could not load project." });
  }
});

/** Simulated company intake (R1.18, R1.19) per company_intake_simulation.md. */
app.post("/api/inquiries", async (req, res) => {
  const b = req.body || {};
  const sourceType = String(b.source_type || "").trim();
  const sourceId = String(b.source_id || "").trim();
  const sourceName = String(b.source_name || "").trim();
  const sourceUrl = String(b.source_url || "").trim();
  const company = String(b.company_name || "").trim();
  const contact = String(b.contact_name || "").trim();
  const email = String(b.contact_email || "").trim();
  const description = String(b.description || "").trim();

  if (!["student", "project"].includes(sourceType) || !sourceId) {
    return res.status(400).json({ error: "Inquiry context (source_type and source_id) is required." });
  }
  if (!company || !contact || !email || !description) {
    return res.status(400).json({ error: "Company name, contact name, email and description are all required." });
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: "Please enter a valid email address." });
  }

  try {
    const r = await pool.query(
      `INSERT INTO inquiries
         (source_type, source_id, source_name, source_url, company_name, contact_name, contact_email, description)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       RETURNING id, source_type, source_id, created_at`,
      [sourceType, sourceId, sourceName, sourceUrl, company, contact, email, description]
    );
    res.status(201).json({ received: true, inquiry: r.rows[0] });
  } catch (err) {
    console.error("POST /api/inquiries failed:", err.message);
    res.status(500).json({ error: "Could not submit inquiry." });
  }
});

app.use((req, res) => res.status(404).json({ error: "Not found." }));

initDb()
  .then(async () => {
    if (process.env.SEED_ON_BOOT !== "false") {
      const r = await pool.query("SELECT COUNT(*)::int AS n FROM students");
      if (r.rows[0].n === 0) {
        console.log("Empty database detected — importing fixtures.");
        await importFixtures();
      }
    }
  })
  .then(() => {
    app.listen(PORT, () => console.log(`Backend listening on port ${PORT}`));
  })
  .catch((err) => {
    console.error("Startup failed:", err.message);
    process.exit(1);
  });
