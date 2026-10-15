/**
 * Release 2 — profile draft, privacy, presentation and publication.
 * R2.10 - R2.12, R2.18 - R2.25, R2.30.
 *
 * A student's profile IS a students row. Publishing therefore makes it
 * discoverable through the Release 1 directory with no synchronisation step
 * and no redeployment (R2.22), because the R1 query already filters on
 * profile_status = 'published'.
 */
const fs = require("fs");
const path = require("path");
const { pool } = require("./db");
const { requireAuth, requireVerified, id } = require("./auth");

const THEMES = ["classic", "slate", "warm"];
const SECTIONS = ["about", "skills", "projects", "experience"];
const AVAILABILITY = ["internship", "full-time", "contract"];
const STATUSES = ["current", "alumni"];
const VISIBILITY_FIELDS = [
  "availability",
  "links",
  "location",
  "contact_email",
  "education",
  "experience",
];

/** The standardized vocabulary. Anything outside it is a suggestion (R2.12). */
const VOCABULARY = JSON.parse(
  fs.readFileSync(path.join(__dirname, "data", "skills.json"), "utf8")
);
const VOCAB_BY_LOWER = new Map(VOCABULARY.map((s) => [s.toLowerCase(), s]));

/**
 * R2.25 — profile text is rendered as text, never as markup. Angle brackets
 * are stripped on the way in so a stored value can never become an element,
 * and the frontend additionally assigns via textContent. Defence at both ends
 * is deliberate: either alone would be enough, together they survive a
 * careless change on one side.
 */
function plainText(value, maxLength = 4000) {
  return String(value == null ? "" : value)
    .replace(/<[^>]*>/g, "")
    .replace(/[<>]/g, "")
    .trim()
    .slice(0, maxLength);
}

function oneOf(value, allowed, fallback) {
  const v = String(value || "").trim().toLowerCase();
  return allowed.includes(v) ? v : fallback;
}

/** Keeps only vocabulary skills; everything else is returned separately. */
function partitionSkills(input) {
  const seen = new Set();
  const standardized = [];
  const suggested = [];
  for (const raw of Array.isArray(input) ? input : []) {
    const value = String(raw || "").trim();
    if (!value) continue;
    const canonical = VOCAB_BY_LOWER.get(value.toLowerCase());
    const key = (canonical || value).toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    if (canonical) standardized.push(canonical);
    else suggested.push(value.slice(0, 60));
  }
  return { standardized, suggested };
}

/** The owner's own view: everything, including what is marked private. */
function ownerView(row, skills, availability) {
  return {
    id: row.id,
    name: row.name,
    headline: row.headline,
    program: row.program,
    bio: row.bio,
    location_text: row.location_text,
    contact_email: row.contact_email,
    education: row.education,
    experience: row.experience,
    status: row.status,
    profile_status: row.profile_status,
    links: row.links || {},
    visibility: row.visibility || {},
    theme: row.theme,
    section_order: row.section_order,
    skills,
    availability,
  };
}

/**
 * R2.19 — the public shape. A field the student marked private is ABSENT from
 * the object, not blanked and not merely hidden by the frontend. This one
 * function builds every public response, so there is a single place to get it
 * right.
 *
 * R2.24 — skills and availability are never filtered by visibility and are
 * untouched by theme, because employer search depends on them.
 */
function publicView(row, skills, availability) {
  const vis = row.visibility || {};
  const out = {
    id: row.id,
    name: row.name,
    headline: row.headline,
    program: row.program,
    bio: row.bio,
    status: row.status,
    theme: row.theme,
    section_order: row.section_order,
    skills,
  };
  if (vis.availability !== false) out.availability = availability;
  if (vis.links !== false) out.links = row.links || {};
  if (vis.location !== false && row.location_text) out.location_text = row.location_text;
  if (vis.contact_email === true && row.contact_email) out.contact_email = row.contact_email;
  if (vis.education !== false && row.education) out.education = row.education;
  if (vis.experience !== false && row.experience) out.experience = row.experience;
  return out;
}

async function loadSkillsAndAvailability(studentId) {
  const [s, a] = await Promise.all([
    pool.query(
      "SELECT skill_name FROM student_skills WHERE student_id = $1 ORDER BY skill_name",
      [studentId]
    ),
    // The R1 schema names this column "value", not "availability".
    pool.query(
      "SELECT value FROM student_availability WHERE student_id = $1 ORDER BY value",
      [studentId]
    ),
  ]);
  return {
    skills: s.rows.map((r) => r.skill_name),
    availability: a.rows.map((r) => r.value),
  };
}

/**
 * R2.30 — ownership is checked on the server for every write, against the
 * signed-in user, never inferred from what the UI offered. A request naming
 * another student's id is refused even though no button produces one.
 */
async function ownedProfile(req, res) {
  const r = await pool.query("SELECT * FROM students WHERE user_id = $1", [req.user.id]);
  if (!r.rows[0]) {
    res.status(404).json({ error: "You do not have a profile yet." });
    return null;
  }
  const requested = req.params.id || (req.body && req.body.id);
  if (requested && requested !== r.rows[0].id) {
    res.status(403).json({ error: "You can only modify your own profile." });
    return null;
  }
  return r.rows[0];
}

function register(app) {
  /** R2.10 — create a private draft. Creating one does not publish it. */
  app.post("/api/profile", requireAuth, requireVerified, async (req, res) => {
    try {
      const existing = await pool.query("SELECT id FROM students WHERE user_id = $1", [
        req.user.id,
      ]);
      if (existing.rows[0]) {
        return res
          .status(409)
          .json({ error: "You already have a profile.", id: existing.rows[0].id });
      }
      const name = plainText(req.body && req.body.name, 120) || req.user.github_login || "New student";
      const studentId = id("P");
      await pool.query(
        `INSERT INTO students (id, name, headline, program, status, profile_status, links, user_id)
         VALUES ($1,$2,'','','current','draft','{}'::jsonb,$3)`,
        [studentId, name, req.user.id]
      );
      res.status(201).json({ id: studentId, profile_status: "draft" });
    } catch (err) {
      console.error("POST /api/profile failed:", err.message);
      res.status(500).json({ error: "Could not create your profile." });
    }
  });

  /** The owner's own view, including private fields. */
  app.get("/api/profile", requireAuth, async (req, res) => {
    try {
      const row = await ownedProfile(req, res);
      if (!row) return;
      const { skills, availability } = await loadSkillsAndAvailability(row.id);
      res.json(ownerView(row, skills, availability));
    } catch (err) {
      console.error("GET /api/profile failed:", err.message);
      res.status(500).json({ error: "Could not load your profile." });
    }
  });

  /** R2.11, R2.12, R2.18, R2.23 — save the maintained profile. */
  app.put("/api/profile", requireAuth, requireVerified, async (req, res) => {
    const client = await pool.connect();
    try {
      const row = await ownedProfile(req, res);
      if (!row) return;
      const b = req.body || {};

      const visibility = Object.assign({}, row.visibility || {});
      if (b.visibility && typeof b.visibility === "object") {
        for (const field of VISIBILITY_FIELDS) {
          if (field in b.visibility) visibility[field] = Boolean(b.visibility[field]);
        }
      }

      // Honour the student's chosen order (R2.23), keeping only known
      // sections and appending any they left out, so the set stays complete
      // however the client posts it.
      const sectionOrder = Array.isArray(b.section_order)
        ? b.section_order
            .filter((s) => SECTIONS.includes(s))
            .filter((s, i, a) => a.indexOf(s) === i)
            .concat(SECTIONS.filter((s) => !b.section_order.includes(s)))
        : row.section_order;

      const links = {};
      for (const key of ["github", "linkedin", "portfolio"]) {
        const value = plainText(b.links && b.links[key], 300);
        // Only http(s). A javascript: or data: URL must never reach an href.
        if (value && /^https?:\/\//i.test(value)) links[key] = value;
      }

      await client.query("BEGIN");
      await client.query(
        `UPDATE students SET
           name = $2, headline = $3, program = $4, bio = $5, location_text = $6,
           contact_email = $7, education = $8, experience = $9, status = $10,
           links = $11::jsonb, visibility = $12::jsonb, theme = $13, section_order = $14::jsonb
         WHERE id = $1`,
        [
          row.id,
          plainText(b.name, 120) || row.name,
          plainText(b.headline, 200),
          plainText(b.program, 120),
          plainText(b.bio, 4000),
          plainText(b.location_text, 120),
          plainText(b.contact_email, 200),
          plainText(b.education, 2000),
          plainText(b.experience, 4000),
          oneOf(b.status, STATUSES, row.status),
          JSON.stringify(links),
          JSON.stringify(visibility),
          oneOf(b.theme, THEMES, row.theme),
          JSON.stringify(sectionOrder),
        ]
      );

      if (Array.isArray(b.skills)) {
        const { standardized, suggested } = partitionSkills(b.skills);
        await client.query("DELETE FROM student_skills WHERE student_id = $1", [row.id]);
        for (const skill of standardized) {
          await client.query(
            "INSERT INTO student_skills (student_id, skill_name) VALUES ($1,$2) ON CONFLICT DO NOTHING",
            [row.id, skill]
          );
        }
        // R2.12 — a free-form variant is recorded for review, never promoted
        // to a public filter value, so "c#", "C sharp" and "C#" cannot become
        // three separate options.
        for (const s of suggested) {
          await client.query(
            "INSERT INTO skill_suggestions (student_id, suggested) VALUES ($1,$2)",
            [row.id, s]
          );
        }
      }

      if (Array.isArray(b.availability)) {
        const values = b.availability
          .map((v) => String(v || "").trim().toLowerCase())
          .filter((v) => AVAILABILITY.includes(v));
        await client.query("DELETE FROM student_availability WHERE student_id = $1", [row.id]);
        for (const v of Array.from(new Set(values))) {
          await client.query(
            "INSERT INTO student_availability (student_id, value) VALUES ($1,$2) ON CONFLICT DO NOTHING",
            [row.id, v]
          );
        }
      }

      await client.query("COMMIT");
      const fresh = await pool.query("SELECT * FROM students WHERE id = $1", [row.id]);
      const { skills, availability } = await loadSkillsAndAvailability(row.id);
      res.json(ownerView(fresh.rows[0], skills, availability));
    } catch (err) {
      await client.query("ROLLBACK").catch(() => {});
      console.error("PUT /api/profile failed:", err.message);
      res.status(500).json({ error: "Could not save your profile." });
    } finally {
      client.release();
    }
  });

  /** R2.20 — preview exactly what the public would see, before publishing. */
  app.get("/api/profile/preview", requireAuth, async (req, res) => {
    try {
      const row = await ownedProfile(req, res);
      if (!row) return;
      const { skills, availability } = await loadSkillsAndAvailability(row.id);
      res.json({
        // Built by the same function that serves real public requests, so the
        // preview cannot drift from what visitors actually get.
        public: publicView(row, skills, availability),
        hidden: VISIBILITY_FIELDS.filter((f) => (row.visibility || {})[f] === false),
        profile_status: row.profile_status,
      });
    } catch (err) {
      console.error("GET /api/profile/preview failed:", err.message);
      res.status(500).json({ error: "Could not build the preview." });
    }
  });

  /** R2.21, R2.22 — publish and unpublish, without deleting the draft. */
  app.post("/api/profile/publish", requireAuth, requireVerified, async (req, res) => {
    try {
      const row = await ownedProfile(req, res);
      if (!row) return;
      if (!row.name.trim() || !row.headline.trim()) {
        return res.status(400).json({ error: "Add your name and a headline before publishing." });
      }
      await pool.query("UPDATE students SET profile_status = 'published' WHERE id = $1", [row.id]);
      res.json({ profile_status: "published", id: row.id });
    } catch (err) {
      console.error("POST /api/profile/publish failed:", err.message);
      res.status(500).json({ error: "Could not publish your profile." });
    }
  });

  app.post("/api/profile/unpublish", requireAuth, requireVerified, async (req, res) => {
    try {
      const row = await ownedProfile(req, res);
      if (!row) return;
      // 'unpublished' rather than deleted: the maintained draft survives.
      await pool.query("UPDATE students SET profile_status = 'unpublished' WHERE id = $1", [row.id]);
      res.json({ profile_status: "unpublished", id: row.id });
    } catch (err) {
      console.error("POST /api/profile/unpublish failed:", err.message);
      res.status(500).json({ error: "Could not unpublish your profile." });
    }
  });

  /** The vocabulary the editor offers, so the client never invents one. */
  app.get("/api/profile/options", (req, res) => {
    res.json({
      skills: VOCABULARY,
      availability: AVAILABILITY,
      statuses: STATUSES,
      themes: THEMES,
      sections: SECTIONS,
      visibility_fields: VISIBILITY_FIELDS,
    });
  });
}

module.exports = { register, publicView, plainText, partitionSkills, VISIBILITY_FIELDS };
