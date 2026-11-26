/**
 * Release 4 — staff operations, industry partners and collaborations.
 * R4.01 - R4.24. Chosen Challenge: R4.10 Untrusted Website Content (see
 * company-import.js). Private and limited collaborations are also filtered
 * server-side on every public route (R4.18), so the public API never carries a
 * private collaboration even though R4.19 was not the chosen Challenge.
 *
 * Authorization is decided on the server for every route (R4.02):
 *   /api/staff/*   staff role only — checked from the session's users row,
 *                  never from anything the request body or URL claims;
 *   /api/my/*      the signed-in student, and maintainer-only actions are
 *                  checked against the project row;
 *   /api/partners  public, and returns published companies and only the public
 *                  shape of each collaboration.
 */
const crypto = require("crypto");
const { pool } = require("./db");
const { requireAuth, requireVerified, currentUser, id } = require("./auth");
const { plainText } = require("./profile");
const { safeUrl } = require("./projects");
const { ImportError, fetchPage, extractCompany, domainOf } = require("./company-import");

// ---------------------------------------------------------------------------
// Staff accounts (R4.01)
// ---------------------------------------------------------------------------

const SCRYPT_KEYLEN = 64;

function hashPassword(password, salt = crypto.randomBytes(16).toString("hex")) {
  const key = crypto.scryptSync(String(password), salt, SCRYPT_KEYLEN).toString("hex");
  return `scrypt:${salt}:${key}`;
}

function passwordMatches(password, stored) {
  const [scheme, salt, key] = String(stored || "").split(":");
  if (scheme !== "scrypt" || !salt || !key) return false;
  const candidate = crypto.scryptSync(String(password), salt, SCRYPT_KEYLEN);
  const expected = Buffer.from(key, "hex");
  return expected.length === candidate.length && crypto.timingSafeEqual(expected, candidate);
}

/**
 * The staff test account comes from environment variables, so its password is
 * never in the repository. Re-running on every boot keeps it in step with the
 * environment (changing STAFF_PASSWORD on Render rotates it).
 */
async function ensureStaffAccount() {
  const username = String(process.env.STAFF_USERNAME || "").trim().toLowerCase();
  const password = String(process.env.STAFF_PASSWORD || "");
  if (!username || password.length < 10) return;
  await pool.query(
    `INSERT INTO users (id, github_user_id, github_login, role, username, password_hash, verified_at)
     VALUES ($1, NULL, $2, 'staff', $2, $3, NOW())
     ON CONFLICT (id) DO UPDATE SET role = 'staff', username = EXCLUDED.username,
       github_login = EXCLUDED.github_login, password_hash = EXCLUDED.password_hash`,
    [`u_staff_${username.replace(/[^a-z0-9]/g, "")}`, username, hashPassword(password)]
  );
}

/** Slows password guessing: at most 8 failed attempts per IP per 15 minutes. */
const failedLogins = new Map();
function tooManyAttempts(ip) {
  const entry = failedLogins.get(ip);
  return entry && entry.count >= 8 && entry.until > Date.now();
}
function recordFailure(ip) {
  const entry = failedLogins.get(ip);
  if (!entry || entry.until < Date.now()) failedLogins.set(ip, { count: 1, until: Date.now() + 15 * 60 * 1000 });
  else entry.count += 1;
}

async function requireStaff(req, res, next) {
  try {
    const user = await currentUser(req);
    if (!user) return res.status(401).json({ error: "Sign in with a staff account to continue." });
    if (user.role !== "staff") {
      return res.status(403).json({ error: "This action is only available to ImmXrsive staff." });
    }
    req.user = user;
    next();
  } catch (err) {
    console.error("staff check failed:", err.message);
    res.status(500).json({ error: "Could not verify your session." });
  }
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

const VISIBILITIES = ["public", "limited", "private"];
const COLLAB_STATUSES = ["current", "past"];

function yearOrNull(value) {
  if (value === undefined || value === null || value === "") return null;
  const n = Number.parseInt(value, 10);
  return Number.isInteger(n) && n >= 1990 && n <= 2100 ? n : NaN;
}

function keywordList(value) {
  const raw = Array.isArray(value) ? value : String(value || "").split(",");
  const out = [];
  for (const v of raw) {
    const t = plainText(v, 40);
    if (t && !out.some((x) => x.toLowerCase() === t.toLowerCase())) out.push(t);
    if (out.length >= 12) break;
  }
  return out;
}

/** Company fields staff can edit, cleaned to plain text (no markup can survive). */
function companyFields(b) {
  const website = safeUrl(b.website && !/^[a-z][a-z0-9+.-]*:/i.test(b.website) ? `https://${b.website}` : b.website);
  return {
    name: plainText(b.name, 120),
    website,
    domain: domainOf(website),
    description: plainText(b.description, 1500),
    sector: plainText(b.sector, 120),
    keywords: keywordList(b.keywords),
    location: plainText(b.location, 120),
  };
}
const COMPANY_FIELD_NAMES = ["name", "website", "description", "sector", "keywords", "location"];

function sameValue(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

async function companiesWithDomain(domain, exceptId = null) {
  if (!domain) return [];
  const r = await pool.query(
    "SELECT id, name, website, status FROM companies WHERE domain = $1 AND ($2::text IS NULL OR id <> $2) ORDER BY created_at",
    [domain, exceptId]
  );
  return r.rows;
}

async function loadImport(importId) {
  if (!importId) return null;
  const r = await pool.query("SELECT * FROM company_imports WHERE id = $1 AND ok", [importId]);
  return r.rows[0] || null;
}

/**
 * R4.12 — provenance per field. A value that equals what the import proposed
 * is recorded as imported (with the URL and time); anything staff typed or
 * changed is recorded as a staff edit. Unchanged fields keep their history.
 */
function nextSources(previous, before, after, imp, staffName) {
  const sources = { ...(previous || {}) };
  const now = new Date().toISOString();
  // Compare against the import as it would be saved, so a normalised URL still counts as imported.
  const imported = imp ? companyFields(imp.candidate || {}) : null;
  for (const field of COMPANY_FIELD_NAMES) {
    if (before && sameValue(before[field], after[field])) continue;
    if (!after[field] || (Array.isArray(after[field]) && !after[field].length)) {
      delete sources[field];
      continue;
    }
    if (imported && sameValue(imported[field], after[field])) {
      sources[field] = { source: "import", url: imp.source_url, at: new Date(imp.imported_at).toISOString() };
    } else {
      sources[field] = { source: "staff", by: staffName, at: now };
    }
  }
  return sources;
}

async function staffCompany(companyId) {
  const c = await pool.query("SELECT * FROM companies WHERE id = $1", [companyId]);
  if (!c.rows[0]) return null;
  const [imports, collabs, partners] = await Promise.all([
    pool.query(
      `SELECT id, source_url, final_url, ok, error, candidate, flagged_text, imported_at
         FROM company_imports WHERE company_id = $1 ORDER BY imported_at DESC LIMIT 20`,
      [companyId]
    ),
    pool.query("SELECT * FROM collaborations WHERE company_id = $1 ORDER BY COALESCE(start_year, 0) DESC, created_at DESC", [companyId]),
    pool.query(
      `SELECT p.id, p.title, p.project_status, pp.approved_at
         FROM project_partners pp JOIN projects p ON p.id = pp.project_id
        WHERE pp.company_id = $1 ORDER BY p.title`,
      [companyId]
    ),
  ]);
  const collabIds = collabs.rows.map((x) => x.id);
  const [cp, cs] = collabIds.length
    ? await Promise.all([
        pool.query(
          `SELECT cp.collaboration_id, p.id, p.title FROM collaboration_projects cp
             JOIN projects p ON p.id = cp.project_id WHERE cp.collaboration_id = ANY($1) ORDER BY p.title`,
          [collabIds]
        ),
        pool.query(
          `SELECT cs.collaboration_id, s.id, s.name FROM collaboration_students cs
             JOIN students s ON s.id = cs.student_id WHERE cs.collaboration_id = ANY($1) ORDER BY s.name`,
          [collabIds]
        ),
      ])
    : [{ rows: [] }, { rows: [] }];
  return {
    ...c.rows[0],
    imports: imports.rows,
    collaborations: collabs.rows.map((x) => ({
      ...x,
      projects: cp.rows.filter((r) => r.collaboration_id === x.id).map(({ id: pid, title }) => ({ id: pid, title })),
      students: cs.rows.filter((r) => r.collaboration_id === x.id).map(({ id: sid, name }) => ({ id: sid, name })),
    })),
    partner_projects: partners.rows,
  };
}

/** Validates a collaboration body. Returns { value } or { error }. */
async function collaborationFields(b) {
  const title = plainText(b.title, 200);
  if (!title) return { error: "Give the collaboration a title." };
  const start = yearOrNull(b.start_year);
  const end = yearOrNull(b.end_year);
  if (Number.isNaN(start) || Number.isNaN(end)) return { error: "Years must be four-digit years such as 2025." };
  if (start === null) return { error: "Add the year the collaboration started." };
  if (end !== null && end < start) return { error: "The end year cannot be before the start year." };
  const status = COLLAB_STATUSES.includes(b.status) ? b.status : null;
  if (!status) return { error: "Choose whether this collaboration is current or past." };
  const visibility = VISIBILITIES.includes(b.visibility) ? b.visibility : null;
  if (!visibility) return { error: "Choose who can see this collaboration: public, limited or private." };
  const publicSummary = plainText(b.public_summary, 300);
  if (visibility === "limited" && !publicSummary) {
    return { error: "A limited collaboration needs a short public summary — that summary is all visitors will see." };
  }

  const projectIds = [...new Set((Array.isArray(b.project_ids) ? b.project_ids : []).map(String))].slice(0, 20);
  const studentIds = [...new Set((Array.isArray(b.student_ids) ? b.student_ids : []).map(String))].slice(0, 30);
  if (projectIds.length) {
    const r = await pool.query("SELECT id FROM projects WHERE id = ANY($1)", [projectIds]);
    if (r.rowCount !== projectIds.length) return { error: "One of the selected projects no longer exists." };
  }
  if (studentIds.length) {
    const r = await pool.query("SELECT id FROM students WHERE id = ANY($1)", [studentIds]);
    if (r.rowCount !== studentIds.length) return { error: "One of the selected students no longer exists." };
  }
  return {
    value: {
      title,
      start_year: start,
      end_year: end,
      description: plainText(b.description, 2000),
      outcome: plainText(b.outcome, 1000),
      status,
      visibility,
      public_summary: publicSummary,
      project_ids: projectIds,
      student_ids: studentIds,
    },
  };
}

async function saveCollaborationLinks(client, collabId, v) {
  await client.query("DELETE FROM collaboration_projects WHERE collaboration_id = $1", [collabId]);
  await client.query("DELETE FROM collaboration_students WHERE collaboration_id = $1", [collabId]);
  for (const pid of v.project_ids) {
    await client.query("INSERT INTO collaboration_projects (collaboration_id, project_id) VALUES ($1,$2)", [collabId, pid]);
  }
  for (const sid of v.student_ids) {
    await client.query("INSERT INTO collaboration_students (collaboration_id, student_id) VALUES ($1,$2)", [collabId, sid]);
  }
}

/** The signed-in student and, for maintainer actions, the project they maintain. */
async function maintainerOf(req, res) {
  const me = await pool.query("SELECT id, name FROM students WHERE user_id = $1", [req.user.id]);
  if (!me.rows[0]) {
    res.status(409).json({ error: "Create your student profile first." });
    return null;
  }
  const p = await pool.query("SELECT * FROM projects WHERE id = $1", [req.params.id]);
  if (!p.rows[0]) {
    res.status(404).json({ error: "Project not found." });
    return null;
  }
  if (p.rows[0].maintainer_student_id !== me.rows[0].id) {
    res.status(403).json({ error: "Only the project maintainer can do this." });
    return null;
  }
  return { me: me.rows[0], project: p.rows[0] };
}

// ---------------------------------------------------------------------------
// Public shapes (R4.18, R4.22, R4.23)
// ---------------------------------------------------------------------------

/**
 * The ONLY shape a collaboration takes on a public route. Private ones never
 * reach this function; limited ones keep only their summary, years and status
 * — no title, description, outcome, projects or students.
 */
function publicCollaboration(c, projects, students) {
  if (c.visibility === "limited") {
    return {
      id: c.id,
      visibility: "limited",
      summary: c.public_summary,
      start_year: c.start_year,
      end_year: c.end_year,
      status: c.status,
    };
  }
  return {
    id: c.id,
    visibility: "public",
    title: c.title,
    start_year: c.start_year,
    end_year: c.end_year,
    status: c.status,
    description: c.description,
    outcome: c.outcome,
    projects,
    students,
  };
}

async function publicPartner(companyId) {
  const c = await pool.query(
    `SELECT id, name, website, domain, description, sector, keywords, location, published_at
       FROM companies WHERE id = $1 AND status = 'published'`,
    [companyId]
  );
  if (!c.rows[0]) return null;

  // Private rows are excluded in SQL, so they are never even loaded here.
  const collabs = await pool.query(
    `SELECT * FROM collaborations
      WHERE company_id = $1 AND visibility IN ('public', 'limited')
      ORDER BY (status = 'current') DESC, COALESCE(end_year, start_year, 0) DESC, start_year DESC, created_at DESC`,
    [companyId]
  );
  const publicIds = collabs.rows.filter((x) => x.visibility === "public").map((x) => x.id);
  const [cp, cs, partnerProjects] = await Promise.all([
    publicIds.length
      ? pool.query(
          `SELECT cp.collaboration_id, p.id, p.title FROM collaboration_projects cp
             JOIN projects p ON p.id = cp.project_id
            WHERE cp.collaboration_id = ANY($1) AND p.project_status = 'published' ORDER BY p.title`,
          [publicIds]
        )
      : { rows: [] },
    publicIds.length
      ? pool.query(
          `SELECT cs.collaboration_id, s.id, s.name FROM collaboration_students cs
             JOIN students s ON s.id = cs.student_id
            WHERE cs.collaboration_id = ANY($1) AND s.profile_status = 'published' ORDER BY s.name`,
          [publicIds]
        )
      : { rows: [] },
    pool.query(
      `SELECT p.id, p.title, p.description FROM project_partners pp
         JOIN projects p ON p.id = pp.project_id
        WHERE pp.company_id = $1 AND p.project_status = 'published' ORDER BY p.title`,
      [companyId]
    ),
  ]);

  const collaborations = collabs.rows.map((x) =>
    publicCollaboration(
      x,
      cp.rows.filter((r) => r.collaboration_id === x.id).map(({ id: pid, title }) => ({ id: pid, title })),
      cs.rows.filter((r) => r.collaboration_id === x.id).map(({ id: sid, name }) => ({ id: sid, name }))
    )
  );
  const relationship = collaborations.some((x) => x.status === "current")
    ? "current"
    : collaborations.length || partnerProjects.rowCount
      ? "past"
      : "";
  return { ...c.rows[0], relationship, collaborations, projects: partnerProjects.rows };
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

function register(app) {
  // ---- Staff sign-in -------------------------------------------------------

  app.post("/auth/staff/login", async (req, res) => {
    const ip = req.ip || "unknown";
    if (tooManyAttempts(ip)) {
      return res.status(429).json({ error: "Too many attempts. Wait 15 minutes and try again." });
    }
    const username = String((req.body || {}).username || "").trim().toLowerCase();
    const password = String((req.body || {}).password || "");
    try {
      const r = await pool.query("SELECT * FROM users WHERE username = $1 AND role = 'staff'", [username]);
      const user = r.rows[0];
      if (!user || !passwordMatches(password, user.password_hash)) {
        recordFailure(ip);
        return res.status(401).json({ error: "That username and password do not match a staff account." });
      }
      const { createSessionCookie } = require("./auth");
      const cookie = await createSessionCookie(user.id);
      await pool.query("UPDATE users SET last_login_at = NOW() WHERE id = $1", [user.id]);
      res.setHeader("Set-Cookie", cookie);
      res.json({ signed_in: true, role: "staff", username: user.username });
    } catch (err) {
      console.error("POST /auth/staff/login failed:", err.message);
      res.status(500).json({ error: "Could not sign you in." });
    }
  });

  // ---- Staff work queue (R4.03) --------------------------------------------

  app.get("/api/staff/queue", requireStaff, async (req, res) => {
    try {
      const [verifications, partnerRequests, drafts] = await Promise.all([
        pool.query(
          `SELECT vr.id, vr.project_id, p.title AS project_title, s.name AS requested_by, vr.note, vr.created_at
             FROM verification_requests vr
             JOIN projects p ON p.id = vr.project_id
             JOIN students s ON s.id = vr.requested_by
            WHERE vr.status = 'pending' ORDER BY vr.created_at`
        ),
        pool.query(
          `SELECT pr.id, pr.project_id, p.title AS project_title, s.name AS requested_by,
                  COALESCE(c.name, pr.suggested_name) AS company_name, pr.company_id IS NOT NULL AS existing_company,
                  pr.explanation, pr.created_at
             FROM partner_requests pr
             JOIN projects p ON p.id = pr.project_id
             JOIN students s ON s.id = pr.requested_by
             LEFT JOIN companies c ON c.id = pr.company_id
            WHERE pr.status = 'pending' ORDER BY pr.created_at`
        ),
        pool.query(
          `SELECT c.id, c.name, c.website, c.updated_at,
                  (SELECT ci.source_url FROM company_imports ci WHERE ci.company_id = c.id AND ci.ok
                    ORDER BY ci.imported_at DESC LIMIT 1) AS imported_from
             FROM companies c WHERE c.status = 'draft' ORDER BY c.updated_at DESC`
        ),
      ]);
      res.json({
        project_verifications: verifications.rows,
        partner_requests: partnerRequests.rows,
        company_drafts: drafts.rows,
      });
    } catch (err) {
      console.error("GET /api/staff/queue failed:", err.message);
      res.status(500).json({ error: "Could not load the work queue." });
    }
  });

  /** Projects and published students for the collaboration form's pickers. */
  app.get("/api/staff/options", requireStaff, async (req, res) => {
    try {
      const [projects, students, companies] = await Promise.all([
        pool.query("SELECT id, title, project_status FROM projects ORDER BY title, id"),
        pool.query("SELECT id, name FROM students WHERE profile_status = 'published' ORDER BY name, id"),
        pool.query("SELECT id, name, domain, status FROM companies ORDER BY name"),
      ]);
      res.json({ projects: projects.rows, students: students.rows, companies: companies.rows });
    } catch (err) {
      console.error("GET /api/staff/options failed:", err.message);
      res.status(500).json({ error: "Could not load options." });
    }
  });

  // ---- Project verification (R4.04 - R4.06) --------------------------------

  app.get("/api/staff/verifications/:rid", requireStaff, async (req, res) => {
    try {
      const r = await pool.query(
        `SELECT vr.*, s.name AS requested_by_name FROM verification_requests vr
           JOIN students s ON s.id = vr.requested_by WHERE vr.id = $1`,
        [req.params.rid]
      );
      const request = r.rows[0];
      if (!request) return res.status(404).json({ error: "That verification request no longer exists." });
      const [project, contributors, techs] = await Promise.all([
        pool.query(
          `SELECT id, title, description, domain, date_text, project_status, playable_url, fallback_image_url,
                  verified_at, links FROM projects WHERE id = $1`,
          [request.project_id]
        ),
        pool.query(
          `SELECT s.id, s.name, pc.role, pc.status, pc.contribution_statement, pc.removed_at,
                  (pc.student_id = p.maintainer_student_id) AS is_maintainer
             FROM project_contributors pc JOIN students s ON s.id = pc.student_id
             JOIN projects p ON p.id = pc.project_id
            WHERE pc.project_id = $1 ORDER BY is_maintainer DESC, s.name`,
          [request.project_id]
        ),
        pool.query("SELECT technology FROM project_technologies WHERE project_id = $1 ORDER BY technology", [request.project_id]),
      ]);
      res.json({
        request,
        project: { ...project.rows[0], technologies: techs.rows.map((t) => t.technology) },
        contributors: contributors.rows,
      });
    } catch (err) {
      console.error("GET /api/staff/verifications/:rid failed:", err.message);
      res.status(500).json({ error: "Could not load the request." });
    }
  });

  app.post("/api/staff/verifications/:rid/decision", requireStaff, async (req, res) => {
    const decision = String((req.body || {}).decision || "");
    const note = plainText((req.body || {}).note, 500);
    if (!["approve", "reject"].includes(decision)) return res.status(400).json({ error: "Choose approve or reject." });
    if (decision === "reject" && !note) {
      return res.status(400).json({ error: "Tell the student why — a short reason is required when rejecting." });
    }
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const r = await client.query(
        `UPDATE verification_requests SET status = $1, decided_by = $2, decision_note = $3, decided_at = NOW()
          WHERE id = $4 AND status = 'pending' RETURNING project_id`,
        [decision === "approve" ? "approved" : "rejected", req.user.username, note, req.params.rid]
      );
      if (!r.rowCount) {
        await client.query("ROLLBACK");
        return res.status(409).json({ error: "This request was already decided. Refresh the work queue." });
      }
      if (decision === "approve") {
        await client.query(
          "UPDATE projects SET verified_at = NOW(), verified_by = $1, verified_note = $2 WHERE id = $3",
          [req.user.username, note, r.rows[0].project_id]
        );
      }
      await client.query("COMMIT");
      res.json({ decided: true, status: decision === "approve" ? "approved" : "rejected" });
    } catch (err) {
      await client.query("ROLLBACK");
      console.error("verification decision failed:", err.message);
      res.status(500).json({ error: "Could not save the decision." });
    } finally {
      client.release();
    }
  });

  // ---- Companies (R4.07 - R4.14) -------------------------------------------

  app.get("/api/staff/companies", requireStaff, async (req, res) => {
    try {
      const r = await pool.query(
        `SELECT c.id, c.name, c.website, c.domain, c.status, c.updated_at,
                (SELECT COUNT(*)::int FROM collaborations x WHERE x.company_id = c.id) AS collaboration_count
           FROM companies c ORDER BY c.status, c.name`
      );
      res.json(r.rows);
    } catch (err) {
      console.error("GET /api/staff/companies failed:", err.message);
      res.status(500).json({ error: "Could not load partners." });
    }
  });

  /**
   * R4.08 — fetch the page and return CANDIDATE values. Nothing is written to
   * any company here (R4.09); the attempt itself is logged for provenance and
   * so a failure leaves a trace without touching the draft (R4.11).
   */
  app.post("/api/staff/companies/import", requireStaff, async (req, res) => {
    const b = req.body || {};
    const companyId = b.company_id ? String(b.company_id) : null;
    if (companyId) {
      const c = await pool.query("SELECT id FROM companies WHERE id = $1", [companyId]);
      if (!c.rowCount) return res.status(404).json({ error: "That partner no longer exists." });
    }
    const sourceUrl = String(b.url || "").trim().slice(0, 500);
    const importId = id("imp");
    try {
      const page = await fetchPage(sourceUrl);
      const { candidate, flagged, missing } = extractCompany(page.html, page.finalUrl);
      await pool.query(
        `INSERT INTO company_imports (id, company_id, source_url, final_url, ok, candidate, flagged_text, imported_by)
         VALUES ($1,$2,$3,$4,TRUE,$5,$6,$7)`,
        [importId, companyId, sourceUrl, page.finalUrl, JSON.stringify(candidate), flagged, req.user.username]
      );
      res.json({
        import_id: importId,
        source_url: sourceUrl,
        final_url: page.finalUrl,
        candidate,
        flagged_text: flagged,
        missing,
        duplicates: await companiesWithDomain(candidate.domain, companyId),
      });
    } catch (err) {
      const message = err instanceof ImportError ? err.message : "The import failed unexpectedly. Enter the details manually.";
      if (!(err instanceof ImportError)) console.error("company import failed:", err.message);
      require("./final").recordDiagnostic("company_import_failed", { source_url: String(sourceUrl || "").slice(0, 300) }, err.message);
      await pool
        .query(
          `INSERT INTO company_imports (id, company_id, source_url, ok, error, imported_by)
           VALUES ($1,$2,$3,FALSE,$4,$5)`,
          [importId, companyId, sourceUrl || "(empty)", message, req.user.username]
        )
        .catch(() => {});
      res.status(422).json({ error: message, fallback: "manual" });
    }
  });

  /** R4.07 — create a draft, manually or from a reviewed import candidate. */
  app.post("/api/staff/companies", requireStaff, async (req, res) => {
    const b = req.body || {};
    const fields = companyFields(b);
    if (!fields.name) return res.status(400).json({ error: "A partner name is required." });
    try {
      const duplicates = await companiesWithDomain(fields.domain);
      // Name similarity alone never blocks or merges; only the same website
      // domain asks staff to confirm, and they can open the existing record.
      if (duplicates.length && !b.confirm_new) {
        return res.status(409).json({
          error: `A partner already uses ${fields.domain}. Open the existing partner, or confirm that this is a different organisation.`,
          duplicates,
        });
      }
      const imp = await loadImport(b.import_id);
      const companyId = id("co");
      const sources = nextSources({}, null, fields, imp, req.user.username);
      await pool.query(
        `INSERT INTO companies (id, name, website, domain, description, sector, keywords, location, status, field_sources, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'draft',$9,$10)`,
        [companyId, fields.name, fields.website, fields.domain, fields.description, fields.sector, fields.keywords,
          fields.location, JSON.stringify(sources), req.user.username]
      );
      if (imp) await pool.query("UPDATE company_imports SET company_id = $1 WHERE id = $2", [companyId, imp.id]);
      res.status(201).json(await staffCompany(companyId));
    } catch (err) {
      console.error("POST /api/staff/companies failed:", err.message);
      res.status(500).json({ error: "Could not save the partner draft." });
    }
  });

  app.get("/api/staff/companies/:cid", requireStaff, async (req, res) => {
    try {
      const company = await staffCompany(req.params.cid);
      if (!company) return res.status(404).json({ error: "That partner no longer exists." });
      res.json(company);
    } catch (err) {
      console.error("GET /api/staff/companies/:cid failed:", err.message);
      res.status(500).json({ error: "Could not load the partner." });
    }
  });

  /** Save edits. Only fields present in the body change; provenance follows. */
  app.put("/api/staff/companies/:cid", requireStaff, async (req, res) => {
    const b = req.body || {};
    try {
      const cur = await pool.query("SELECT * FROM companies WHERE id = $1", [req.params.cid]);
      const before = cur.rows[0];
      if (!before) return res.status(404).json({ error: "That partner no longer exists." });
      const incoming = companyFields({ ...before, ...b });
      if (!incoming.name) return res.status(400).json({ error: "A partner name is required." });
      if (incoming.domain && incoming.domain !== before.domain) {
        const duplicates = await companiesWithDomain(incoming.domain, before.id);
        if (duplicates.length && !b.confirm_new) {
          return res.status(409).json({
            error: `Another partner already uses ${incoming.domain}. Check it is not the same organisation, then confirm.`,
            duplicates,
          });
        }
      }
      const imp = await loadImport(b.import_id);
      const sources = nextSources(before.field_sources, before, incoming, imp, req.user.username);
      await pool.query(
        `UPDATE companies SET name=$1, website=$2, domain=$3, description=$4, sector=$5, keywords=$6, location=$7,
                field_sources=$8, updated_at=NOW() WHERE id=$9`,
        [incoming.name, incoming.website, incoming.domain, incoming.description, incoming.sector, incoming.keywords,
          incoming.location, JSON.stringify(sources), before.id]
      );
      if (imp && !imp.company_id) await pool.query("UPDATE company_imports SET company_id = $1 WHERE id = $2", [before.id, imp.id]);
      res.json(await staffCompany(before.id));
    } catch (err) {
      console.error("PUT /api/staff/companies/:cid failed:", err.message);
      res.status(500).json({ error: "Could not save the partner." });
    }
  });

  app.post("/api/staff/companies/:cid/publish", requireStaff, async (req, res) => {
    const publish = (req.body || {}).publish !== false;
    try {
      const cur = await pool.query("SELECT * FROM companies WHERE id = $1", [req.params.cid]);
      const company = cur.rows[0];
      if (!company) return res.status(404).json({ error: "That partner no longer exists." });
      if (publish && (!company.name || !company.description)) {
        return res.status(400).json({ error: "Add a name and a short description before publishing — visitors need both." });
      }
      await pool.query(
        `UPDATE companies SET status = $1, published_at = CASE WHEN $1 = 'published' THEN NOW() ELSE published_at END,
                updated_at = NOW() WHERE id = $2`,
        [publish ? "published" : "draft", company.id]
      );
      res.json(await staffCompany(company.id));
    } catch (err) {
      console.error("publish company failed:", err.message);
      res.status(500).json({ error: "Could not change the publication state." });
    }
  });

  // ---- Collaborations (R4.15 - R4.18) --------------------------------------

  app.post("/api/staff/companies/:cid/collaborations", requireStaff, async (req, res) => {
    const company = await pool.query("SELECT id FROM companies WHERE id = $1", [req.params.cid]);
    if (!company.rowCount) return res.status(404).json({ error: "That partner no longer exists." });
    const { value, error } = await collaborationFields(req.body || {});
    if (error) return res.status(400).json({ error });
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const collabId = id("col");
      await client.query(
        `INSERT INTO collaborations (id, company_id, title, start_year, end_year, description, outcome, status, visibility, public_summary)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [collabId, req.params.cid, value.title, value.start_year, value.end_year, value.description, value.outcome,
          value.status, value.visibility, value.public_summary]
      );
      await saveCollaborationLinks(client, collabId, value);
      await client.query("COMMIT");
      res.status(201).json(await staffCompany(req.params.cid));
    } catch (err) {
      await client.query("ROLLBACK");
      console.error("add collaboration failed:", err.message);
      res.status(500).json({ error: "Could not add the collaboration." });
    } finally {
      client.release();
    }
  });

  app.put("/api/staff/collaborations/:colid", requireStaff, async (req, res) => {
    const cur = await pool.query("SELECT company_id FROM collaborations WHERE id = $1", [req.params.colid]);
    if (!cur.rowCount) return res.status(404).json({ error: "That collaboration no longer exists." });
    const { value, error } = await collaborationFields(req.body || {});
    if (error) return res.status(400).json({ error });
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        `UPDATE collaborations SET title=$1, start_year=$2, end_year=$3, description=$4, outcome=$5, status=$6,
                visibility=$7, public_summary=$8, updated_at=NOW() WHERE id=$9`,
        [value.title, value.start_year, value.end_year, value.description, value.outcome, value.status,
          value.visibility, value.public_summary, req.params.colid]
      );
      await saveCollaborationLinks(client, req.params.colid, value);
      await client.query("COMMIT");
      res.json(await staffCompany(cur.rows[0].company_id));
    } catch (err) {
      await client.query("ROLLBACK");
      console.error("edit collaboration failed:", err.message);
      res.status(500).json({ error: "Could not save the collaboration." });
    } finally {
      client.release();
    }
  });

  // ---- Student partner requests: staff side (R4.21) ------------------------

  app.get("/api/staff/partner-requests/:rid", requireStaff, async (req, res) => {
    try {
      const r = await pool.query(
        `SELECT pr.*, p.title AS project_title, p.description AS project_description, p.project_status,
                s.name AS requested_by_name, c.name AS company_name, c.status AS company_status
           FROM partner_requests pr
           JOIN projects p ON p.id = pr.project_id
           JOIN students s ON s.id = pr.requested_by
           LEFT JOIN companies c ON c.id = pr.company_id
          WHERE pr.id = $1`,
        [req.params.rid]
      );
      if (!r.rows[0]) return res.status(404).json({ error: "That request no longer exists." });
      const domain = domainOf(r.rows[0].suggested_website);
      res.json({ ...r.rows[0], matching_companies: await companiesWithDomain(domain) });
    } catch (err) {
      console.error("GET partner request failed:", err.message);
      res.status(500).json({ error: "Could not load the request." });
    }
  });

  /**
   * Approve: link the project to an existing partner (the one requested, or
   * one staff picked) or create a draft from the student's suggestion. Only
   * this route ever writes project_partners.
   */
  app.post("/api/staff/partner-requests/:rid/decision", requireStaff, async (req, res) => {
    const b = req.body || {};
    const decision = String(b.decision || "");
    const note = plainText(b.note, 500);
    if (!["approve", "reject"].includes(decision)) return res.status(400).json({ error: "Choose approve or reject." });
    if (decision === "reject" && !note) {
      return res.status(400).json({ error: "Tell the student why — a short reason is required when rejecting." });
    }
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const r = await client.query("SELECT * FROM partner_requests WHERE id = $1 FOR UPDATE", [req.params.rid]);
      const request = r.rows[0];
      if (!request) {
        await client.query("ROLLBACK");
        return res.status(404).json({ error: "That request no longer exists." });
      }
      if (request.status !== "pending") {
        await client.query("ROLLBACK");
        return res.status(409).json({ error: "This request was already decided. Refresh the work queue." });
      }

      let companyId = null;
      if (decision === "approve") {
        companyId = b.company_id ? String(b.company_id) : request.company_id;
        if (companyId) {
          const c = await client.query("SELECT id FROM companies WHERE id = $1", [companyId]);
          if (!c.rowCount) {
            await client.query("ROLLBACK");
            return res.status(400).json({ error: "Choose an existing partner, or create a draft from the suggestion." });
          }
        } else if (b.create_draft) {
          const fields = companyFields({ name: request.suggested_name, website: request.suggested_website });
          if (!fields.name) {
            await client.query("ROLLBACK");
            return res.status(400).json({ error: "The suggestion has no company name to create a draft from." });
          }
          companyId = id("co");
          await client.query(
            `INSERT INTO companies (id, name, website, domain, status, field_sources, created_by)
             VALUES ($1,$2,$3,$4,'draft',$5,$6)`,
            [companyId, fields.name, fields.website, fields.domain,
              JSON.stringify({ name: { source: "student suggestion", request: request.id, at: new Date().toISOString() } }),
              req.user.username]
          );
        } else {
          await client.query("ROLLBACK");
          return res.status(400).json({ error: "Choose which partner this project worked with before approving." });
        }
        await client.query(
          `INSERT INTO project_partners (project_id, company_id, request_id, approved_by)
           VALUES ($1,$2,$3,$4) ON CONFLICT (project_id, company_id) DO NOTHING`,
          [request.project_id, companyId, request.id, req.user.username]
        );
      }
      await client.query(
        `UPDATE partner_requests SET status = $1, company_id = COALESCE($2, company_id), decided_by = $3,
                decision_note = $4, decided_at = NOW() WHERE id = $5`,
        [decision === "approve" ? "approved" : "rejected", companyId, req.user.username, note, request.id]
      );
      await client.query("COMMIT");
      res.json({ decided: true, status: decision === "approve" ? "approved" : "rejected", company_id: companyId });
    } catch (err) {
      await client.query("ROLLBACK");
      console.error("partner request decision failed:", err.message);
      res.status(500).json({ error: "Could not save the decision." });
    } finally {
      client.release();
    }
  });

  // ---- Student side: requests from a project (R4.04, R4.20) ----------------

  /** Published partners a student can pick from. */
  app.get("/api/companies/options", requireAuth, async (req, res) => {
    try {
      const r = await pool.query("SELECT id, name, domain FROM companies WHERE status = 'published' ORDER BY name");
      res.json(r.rows);
    } catch (err) {
      console.error("GET /api/companies/options failed:", err.message);
      res.status(500).json({ error: "Could not load partners." });
    }
  });

  /** Request state for the project editor. Visible to anyone on the project. */
  app.get("/api/my/projects/:id/requests", requireAuth, async (req, res) => {
    try {
      const me = await pool.query("SELECT id FROM students WHERE user_id = $1", [req.user.id]);
      const sid = me.rows[0] && me.rows[0].id;
      const p = await pool.query("SELECT id, maintainer_student_id, verified_at, verified_note FROM projects WHERE id = $1", [req.params.id]);
      const project = p.rows[0];
      if (!project) return res.status(404).json({ error: "Project not found." });
      const onProject = await pool.query(
        "SELECT 1 FROM project_contributors WHERE project_id = $1 AND student_id = $2",
        [project.id, sid]
      );
      if (project.maintainer_student_id !== sid && !onProject.rowCount) {
        return res.status(403).json({ error: "You are not on this project." });
      }
      const [verifications, partners, linked] = await Promise.all([
        pool.query(
          "SELECT id, status, note, decision_note, created_at, decided_at FROM verification_requests WHERE project_id = $1 ORDER BY created_at DESC",
          [project.id]
        ),
        pool.query(
          `SELECT pr.id, pr.status, COALESCE(c.name, pr.suggested_name) AS company_name, pr.explanation,
                  pr.decision_note, pr.created_at, pr.decided_at
             FROM partner_requests pr LEFT JOIN companies c ON c.id = pr.company_id
            WHERE pr.project_id = $1 ORDER BY pr.created_at DESC`,
          [project.id]
        ),
        pool.query(
          `SELECT c.id, c.name, c.status FROM project_partners pp JOIN companies c ON c.id = pp.company_id
            WHERE pp.project_id = $1 ORDER BY c.name`,
          [project.id]
        ),
      ]);
      res.json({
        is_maintainer: project.maintainer_student_id === sid,
        verified: Boolean(project.verified_at),
        verified_at: project.verified_at,
        verification_requests: verifications.rows,
        partner_requests: partners.rows,
        partners: linked.rows,
      });
    } catch (err) {
      console.error("GET project requests failed:", err.message);
      res.status(500).json({ error: "Could not load requests." });
    }
  });

  app.post("/api/my/projects/:id/verification-request", requireAuth, requireVerified, async (req, res) => {
    const ctx = await maintainerOf(req, res);
    if (!ctx) return;
    const note = plainText((req.body || {}).note, 1000);
    const evidence = safeUrl((req.body || {}).evidence_url);
    if (note.length < 10) {
      return res.status(400).json({ error: "Explain in a sentence or two why this project should be officially verified." });
    }
    if (ctx.project.verified_at) return res.status(409).json({ error: "This project is already officially verified." });
    try {
      await pool.query(
        `INSERT INTO verification_requests (id, project_id, requested_by, note, evidence_url) VALUES ($1,$2,$3,$4,$5)`,
        [id("ver"), ctx.project.id, ctx.me.id, note, evidence]
      );
      res.status(201).json({ requested: true, status: "pending" });
    } catch (err) {
      if (err.code === "23505") return res.status(409).json({ error: "A verification request for this project is already waiting for staff." });
      console.error("verification request failed:", err.message);
      res.status(500).json({ error: "Could not send the request." });
    }
  });

  app.post("/api/my/projects/:id/partner-requests", requireAuth, requireVerified, async (req, res) => {
    const ctx = await maintainerOf(req, res);
    if (!ctx) return;
    const b = req.body || {};
    const explanation = plainText(b.explanation, 1500);
    if (explanation.length < 10) {
      return res.status(400).json({ error: "Explain how this project worked with the company (at least a sentence)." });
    }
    let companyId = b.company_id ? String(b.company_id) : null;
    let suggestedName = "";
    let suggestedWebsite = "";
    try {
      if (companyId) {
        const c = await pool.query("SELECT id FROM companies WHERE id = $1 AND status = 'published'", [companyId]);
        if (!c.rowCount) return res.status(400).json({ error: "Choose a company from the list, or suggest a new one." });
        const already = await pool.query("SELECT 1 FROM project_partners WHERE project_id = $1 AND company_id = $2", [ctx.project.id, companyId]);
        if (already.rowCount) return res.status(409).json({ error: "This company is already an approved partner on this project." });
      } else {
        suggestedName = plainText(b.suggested_name, 120);
        suggestedWebsite = safeUrl(b.suggested_website && !/^[a-z][a-z0-9+.-]*:/i.test(b.suggested_website) ? `https://${b.suggested_website}` : b.suggested_website);
        if (!suggestedName) return res.status(400).json({ error: "Choose a company from the list, or type the name of the one you suggest." });
      }
      const dup = await pool.query(
        `SELECT 1 FROM partner_requests WHERE project_id = $1 AND status = 'pending'
            AND ((company_id IS NOT NULL AND company_id = $2) OR (company_id IS NULL AND lower(suggested_name) = lower($3)))`,
        [ctx.project.id, companyId, suggestedName]
      );
      if (dup.rowCount) return res.status(409).json({ error: "You already have a request for this company waiting for staff." });
      await pool.query(
        `INSERT INTO partner_requests (id, project_id, requested_by, company_id, suggested_name, suggested_website, explanation)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [id("prq"), ctx.project.id, ctx.me.id, companyId, suggestedName, suggestedWebsite, explanation]
      );
      res.status(201).json({ requested: true, status: "pending" });
    } catch (err) {
      console.error("partner request failed:", err.message);
      res.status(500).json({ error: "Could not send the request." });
    }
  });

  // ---- Public partner pages (R4.22 - R4.24) --------------------------------

  app.get("/api/partners", async (req, res) => {
    try {
      const r = await pool.query(
        `SELECT c.id, c.name, c.description, c.sector, c.keywords, c.location, c.website,
                EXISTS (SELECT 1 FROM collaborations x WHERE x.company_id = c.id
                         AND x.visibility IN ('public','limited') AND x.status = 'current') AS has_current,
                (SELECT COUNT(*)::int FROM collaborations x WHERE x.company_id = c.id
                  AND x.visibility IN ('public','limited')) AS collaboration_count
           FROM companies c WHERE c.status = 'published' ORDER BY c.name, c.id`
      );
      res.json(
        r.rows.map(({ has_current: cur, ...rest }) => ({
          ...rest,
          relationship: cur ? "current" : rest.collaboration_count ? "past" : "",
        }))
      );
    } catch (err) {
      console.error("GET /api/partners failed:", err.message);
      res.status(500).json({ error: "Could not load industry partners." });
    }
  });

  app.get("/api/partners/:cid", async (req, res) => {
    try {
      const partner = await publicPartner(req.params.cid);
      if (!partner) {
        // F.18 — a merged partner's old URL points at the surviving record.
        const gone = await require("./final").continuity("company", req.params.cid);
        if (gone) return res.status(410).json(gone);
        return res.status(404).json({ error: "Partner not found." });
      }
      res.json(partner);
    } catch (err) {
      console.error("GET /api/partners/:cid failed:", err.message);
      res.status(500).json({ error: "Could not load the partner." });
    }
  });
}

module.exports = { register, ensureStaffAccount, requireStaff, hashPassword, passwordMatches, publicCollaboration };
