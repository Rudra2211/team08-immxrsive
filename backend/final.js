/**
 * Final Release — staff operations for launch: legacy migration (F.01-F.06),
 * profile claims and ownership recovery (F.07-F.10), alumni status (F.11,
 * F.12), duplicate merge and URL continuity (F.17, F.18), maintainer recovery
 * (F.19) and operational diagnostics (F.32).
 *
 * Every /api/staff/* route checks the staff role on the server (F.21). A
 * legacy record's email is used only to decide a claim and is shown only to
 * staff; it is never part of a public or student response (F.20).
 */
const { pool } = require("./db");
const { requireAuth, requireVerified } = require("./auth");
const { requireStaff } = require("./r4");
const { plainText } = require("./profile");
const { runMigration } = require("./migrate");

/** F.32 — best effort: diagnostics must never break the request they describe. */
function recordDiagnostic(kind, context, message) {
  pool
    .query("INSERT INTO diagnostic_events (kind, context, message) VALUES ($1, $2::jsonb, $3)", [
      String(kind).slice(0, 60),
      JSON.stringify(context || {}),
      String(message || "").slice(0, 500),
    ])
    .catch((err) => console.error("diagnostic write failed:", err.message));
}

async function logOwnership(client, kind, subjectId, from, to, actor, note) {
  await client.query(
    "INSERT INTO ownership_events (kind, subject_id, from_value, to_value, actor, note) VALUES ($1,$2,$3,$4,$5,$6)",
    [kind, subjectId, from || "", to || "", actor || "", note || ""]
  );
}

/**
 * F.18 — what an old public URL should say when the record is no longer
 * published. Returns null when the record never existed (a plain 404).
 */
async function continuity(kind, id) {
  if (kind === "student") {
    const r = await pool.query("SELECT id, name, profile_status, merged_into FROM students WHERE id = $1", [id]);
    const row = r.rows[0];
    if (!row) return null;
    if (row.merged_into) {
      // Follow a chain of merges to the record that survives.
      let target = row.merged_into;
      for (let i = 0; i < 5; i += 1) {
        const t = (await pool.query("SELECT id, name, merged_into, profile_status FROM students WHERE id = $1", [target])).rows[0];
        if (!t) break;
        if (!t.merged_into) {
          return {
            merged: true,
            merged_into: t.id,
            merged_into_name: t.profile_status === "published" ? t.name : "",
            message: "This profile was combined with another profile by ImmXrsive staff.",
          };
        }
        target = t.merged_into;
      }
      return null;
    }
    if (row.profile_status === "retired") {
      return { retired: true, id: row.id, name: row.name, message: "This portfolio has been archived by its owner." };
    }
    return null;
  }
  if (kind === "project") {
    const r = await pool.query("SELECT id, title, project_status FROM projects WHERE id = $1", [id]);
    const row = r.rows[0];
    if (row && row.project_status === "archived") {
      return { archived: true, id: row.id, title: row.title, message: "This project has been archived." };
    }
    return null;
  }
  if (kind === "company") {
    const r = await pool.query("SELECT id, merged_into FROM companies WHERE id = $1", [id]);
    const row = r.rows[0];
    if (row && row.merged_into) {
      const t = (await pool.query("SELECT id, name, status FROM companies WHERE id = $1", [row.merged_into])).rows[0];
      if (t) {
        return {
          merged: true,
          merged_into: t.id,
          merged_into_name: t.status === "published" ? t.name : "",
          message: "This partner record was combined with another one by ImmXrsive staff.",
        };
      }
    }
    return null;
  }
  return null;
}

/** Sends a consistent, readable error and records the failure for staff. */
function fail(res, req, err, message) {
  console.error(`${req.method} ${req.path} failed:`, err.message);
  res.status(500).json({ error: message });
}

// ---------------------------------------------------------------------------
// Merges (F.17)
// ---------------------------------------------------------------------------

async function mergeStudents(client, fromId, intoId, actor, note) {
  const rows = (await client.query("SELECT * FROM students WHERE id = ANY($1) FOR UPDATE", [[fromId, intoId]])).rows;
  const from = rows.find((r) => r.id === fromId);
  const into = rows.find((r) => r.id === intoId);
  if (!from || !into) return { status: 404, error: "Both profiles must exist." };
  if (fromId === intoId) return { status: 400, error: "Choose two different profiles." };
  if (from.merged_into || into.merged_into) return { status: 409, error: "One of these profiles has already been merged." };
  if (from.user_id && into.user_id && from.user_id !== into.user_id) {
    return { status: 409, error: "Both profiles belong to different signed-in owners. Resolve ownership first." };
  }

  // Contributor relationships: one per person per project, keeping the
  // surviving profile's own row where both were on the same project.
  const fromRows = (await client.query("SELECT * FROM project_contributors WHERE student_id = $1", [fromId])).rows;
  let moved = 0;
  for (const pc of fromRows) {
    const both = await client.query("SELECT role FROM project_contributors WHERE project_id = $1 AND student_id = $2", [pc.project_id, intoId]);
    if (both.rowCount) {
      if (!both.rows[0].role && pc.role) {
        await client.query("UPDATE project_contributors SET role = $3 WHERE project_id = $1 AND student_id = $2", [pc.project_id, intoId, pc.role]);
      }
      await client.query("DELETE FROM project_contributors WHERE project_id = $1 AND student_id = $2", [pc.project_id, fromId]);
    } else {
      await client.query("UPDATE project_contributors SET student_id = $3 WHERE project_id = $1 AND student_id = $2", [pc.project_id, fromId, intoId]);
    }
    moved += 1;
  }
  await client.query("UPDATE project_contributors SET invited_by = $2 WHERE invited_by = $1", [fromId, intoId]);
  await client.query("UPDATE projects SET maintainer_student_id = $2 WHERE maintainer_student_id = $1", [fromId, intoId]);
  await client.query(
    "INSERT INTO student_skills (student_id, skill_name) SELECT $2, skill_name FROM student_skills WHERE student_id = $1 ON CONFLICT DO NOTHING",
    [fromId, intoId]
  );
  const intoAvail = await client.query("SELECT 1 FROM student_availability WHERE student_id = $1", [intoId]);
  if (!intoAvail.rowCount) {
    await client.query(
      "INSERT INTO student_availability (student_id, value) SELECT $2, value FROM student_availability WHERE student_id = $1 ON CONFLICT DO NOTHING",
      [fromId, intoId]
    );
  }
  await client.query(
    "INSERT INTO collaboration_students (collaboration_id, student_id) SELECT collaboration_id, $2 FROM collaboration_students WHERE student_id = $1 ON CONFLICT DO NOTHING",
    [fromId, intoId]
  );
  await client.query("DELETE FROM collaboration_students WHERE student_id = $1", [fromId]);
  for (const table of ["partner_requests", "verification_requests"]) {
    await client.query(`UPDATE ${table} SET requested_by = $2 WHERE requested_by = $1`, [fromId, intoId]);
  }
  await client.query(
    "UPDATE profile_claims SET status = 'rejected', decided_by = $2, decided_at = NOW(), decision_note = 'Profile was merged into another profile.' WHERE student_id = $1 AND status = 'pending'",
    [fromId, actor]
  );
  if (from.user_id && !into.user_id) {
    await client.query("UPDATE students SET user_id = NULL WHERE id = $1", [fromId]);
    await client.query("UPDATE students SET user_id = $2 WHERE id = $1", [intoId, from.user_id]);
    await logOwnership(client, "student_owner", intoId, "", from.user_id, actor, "Owner moved with merge");
  }
  if (!into.legacy_email && from.legacy_email) {
    await client.query("UPDATE students SET legacy_email = $2 WHERE id = $1", [intoId, from.legacy_email]);
  }
  await client.query("UPDATE students SET merged_into = $2, profile_status = 'merged', user_id = NULL WHERE id = $1", [fromId, intoId]);
  await logOwnership(client, "student_merge", fromId, fromId, intoId, actor, note);
  return { status: 200, merged: fromId, into: intoId, contributor_relationships_moved: moved };
}

async function mergeCompanies(client, fromId, intoId, actor, note) {
  const rows = (await client.query("SELECT * FROM companies WHERE id = ANY($1) FOR UPDATE", [[fromId, intoId]])).rows;
  const from = rows.find((r) => r.id === fromId);
  const into = rows.find((r) => r.id === intoId);
  if (!from || !into) return { status: 404, error: "Both partner records must exist." };
  if (fromId === intoId) return { status: 400, error: "Choose two different partners." };
  if (from.merged_into || into.merged_into) return { status: 409, error: "One of these partners has already been merged." };
  const moved = await client.query("UPDATE collaborations SET company_id = $2, updated_at = NOW() WHERE company_id = $1", [fromId, intoId]);
  await client.query(
    `INSERT INTO project_partners (project_id, company_id, request_id, approved_by, approved_at)
     SELECT project_id, $2, request_id, approved_by, approved_at FROM project_partners WHERE company_id = $1
     ON CONFLICT DO NOTHING`,
    [fromId, intoId]
  );
  await client.query("DELETE FROM project_partners WHERE company_id = $1", [fromId]);
  await client.query("UPDATE partner_requests SET company_id = $2 WHERE company_id = $1", [fromId, intoId]);
  await client.query("UPDATE company_imports SET company_id = $2 WHERE company_id = $1", [fromId, intoId]);
  await client.query("UPDATE companies SET merged_into = $2, status = 'merged', updated_at = NOW() WHERE id = $1", [fromId, intoId]);
  await logOwnership(client, "company_merge", fromId, fromId, intoId, actor, note);
  return { status: 200, merged: fromId, into: intoId, collaborations_moved: moved.rowCount };
}

async function inTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const out = await fn(client);
    await client.query(out && out.error ? "ROLLBACK" : "COMMIT");
    return out;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/** Finds a user by GitHub login, verified Algoma email or internal id. */
async function findUser(who) {
  const v = String(who || "").trim().toLowerCase();
  if (!v) return null;
  const r = await pool.query(
    `SELECT id, github_login, algoma_email, role FROM users
      WHERE role IS DISTINCT FROM 'staff'
        AND (id = $1 OR LOWER(github_login) = $1 OR LOWER(algoma_email) = $1) LIMIT 1`,
    [v]
  );
  return r.rows[0] || null;
}

function register(app) {
  // -------------------------------------------------------------------------
  // F.01 - F.03, F.27 — migration runs
  // -------------------------------------------------------------------------
  app.post("/api/staff/migrations", requireStaff, async (req, res) => {
    const b = req.body || {};
    const data = b.data && typeof b.data === "object" ? b.data : null;
    if (!data || !["students", "projects", "companies", "collaborations"].some((k) => Array.isArray(data[k]))) {
      return res.status(400).json({ error: "Choose a legacy export JSON file with students, projects, companies or collaborations." });
    }
    try {
      const report = await runMigration(data, {
        sourceName: plainText(b.source_name, 200) || "upload.json",
        runBy: req.user.username || req.user.github_login || req.user.id,
      });
      res.status(201).json(report);
    } catch (err) {
      recordDiagnostic("migration_failed", { source_name: plainText(b.source_name, 200) }, err.message);
      fail(res, req, err, "The import failed and nothing was saved. The error was recorded for staff diagnostics.");
    }
  });

  app.get("/api/staff/migrations", requireStaff, async (req, res) => {
    try {
      const r = await pool.query(
        `SELECT id, source_name, format, run_by, created_at, archived_at,
                report->'source_counts' AS source_counts,
                jsonb_build_object('students', report->'students', 'projects', report->'projects',
                  'companies', report->'companies', 'collaborations', report->'collaborations') AS counts
           FROM migration_runs ORDER BY id DESC LIMIT 50`
      );
      res.json(r.rows);
    } catch (err) {
      fail(res, req, err, "Could not load the migration history.");
    }
  });

  app.get("/api/staff/migrations/:runId", requireStaff, async (req, res) => {
    try {
      const r = await pool.query("SELECT id, source_name, format, run_by, created_at, archived_at, report FROM migration_runs WHERE id = $1", [
        Number(req.params.runId) || 0,
      ]);
      if (!r.rowCount) return res.status(404).json({ error: "Migration run not found." });
      res.json(r.rows[0]);
    } catch (err) {
      fail(res, req, err, "Could not load the migration report.");
    }
  });

  /**
   * Archive what one import batch created (for example the scale fixture):
   * unclaimed profiles become retired and projects archived. Nothing is
   * deleted, and claimed profiles are left alone.
   */
  app.post("/api/staff/migrations/:runId/archive", requireStaff, async (req, res) => {
    const runId = Number(req.params.runId) || 0;
    try {
      const out = await inTransaction(async (client) => {
        const run = await client.query("SELECT id, archived_at FROM migration_runs WHERE id = $1", [runId]);
        if (!run.rowCount) return { error: "Migration run not found.", status: 404 };
        const s = await client.query(
          `UPDATE students SET profile_status = 'retired', retired_at = NOW()
            WHERE import_run_id = $1 AND user_id IS NULL AND profile_status <> 'merged'`,
          [runId]
        );
        const p = await client.query("UPDATE projects SET project_status = 'archived' WHERE import_run_id = $1", [runId]);
        const c = await client.query("UPDATE companies SET status = 'draft' WHERE import_run_id = $1 AND status = 'published'", [runId]);
        await client.query("UPDATE migration_runs SET archived_at = NOW() WHERE id = $1", [runId]);
        await logOwnership(client, "batch_archive", String(runId), "", "archived", req.user.username, "");
        return { archived_run: runId, students_retired: s.rowCount, projects_archived: p.rowCount, companies_unpublished: c.rowCount };
      });
      if (out.error) return res.status(out.status).json({ error: out.error });
      res.json(out);
    } catch (err) {
      fail(res, req, err, "Could not archive that import batch.");
    }
  });

  // -------------------------------------------------------------------------
  // F.07 - F.10 — claiming an existing profile
  // -------------------------------------------------------------------------

  /** Unclaimed profiles a verified user may ask for. No email is returned. */
  app.get("/api/claims/candidates", requireAuth, requireVerified, async (req, res) => {
    const q = plainText(req.query.q, 80);
    if (q.length < 2) return res.json([]);
    try {
      const r = await pool.query(
        `SELECT id, name, headline, status, profile_status FROM students
          WHERE user_id IS NULL AND merged_into IS NULL AND profile_status IN ('published', 'retired', 'unpublished')
            AND name ILIKE $1
          ORDER BY name, id LIMIT 20`,
        [`%${q}%`]
      );
      res.json(r.rows);
    } catch (err) {
      fail(res, req, err, "Could not search profiles.");
    }
  });

  app.get("/api/claims/mine", requireAuth, async (req, res) => {
    try {
      const r = await pool.query(
        `SELECT c.id, c.student_id, s.name, c.status, c.method, c.note, c.decision_note, c.created_at, c.decided_at
           FROM profile_claims c JOIN students s ON s.id = c.student_id
          WHERE c.user_id = $1 ORDER BY c.id DESC`,
        [req.user.id]
      );
      res.json(r.rows);
    } catch (err) {
      fail(res, req, err, "Could not load your claims.");
    }
  });

  /**
   * F.08, F.09 — automatic approval ONLY when the address this user verified
   * (R2.04) equals the address the legacy record carried. Names, GitHub
   * handles and merely holding some Algoma address never decide a claim.
   */
  app.post("/api/claims", requireAuth, requireVerified, async (req, res) => {
    const studentId = String((req.body && req.body.student_id) || "");
    const note = plainText(req.body && req.body.note, 1000);
    try {
      const out = await inTransaction(async (client) => {
        const s = (await client.query("SELECT id, name, user_id, merged_into, legacy_email FROM students WHERE id = $1 FOR UPDATE", [studentId])).rows[0];
        if (!s || s.merged_into) return { status: 404, error: "That profile cannot be claimed." };
        if (s.user_id === req.user.id) return { status: 409, error: "This is already your profile." };
        if (s.user_id) return { status: 409, error: "That profile already has an owner. Contact ImmXrsive staff if you believe it is yours." };
        const pending = await client.query("SELECT id FROM profile_claims WHERE student_id = $1 AND user_id = $2 AND status = 'pending'", [studentId, req.user.id]);
        if (pending.rowCount) return { status: 409, error: "You already have a claim waiting for staff review." };
        const own = await client.query("SELECT id FROM students WHERE user_id = $1", [req.user.id]);
        const emailMatch =
          s.legacy_email && req.user.algoma_email && s.legacy_email.toLowerCase() === String(req.user.algoma_email).toLowerCase();
        if (emailMatch && !own.rowCount) {
          await client.query("UPDATE students SET user_id = $2 WHERE id = $1", [studentId, req.user.id]);
          const c = await client.query(
            `INSERT INTO profile_claims (student_id, user_id, note, status, method, decided_by, decided_at)
             VALUES ($1,$2,$3,'approved','verified_email','automatic',NOW()) RETURNING id`,
            [studentId, req.user.id, note]
          );
          await logOwnership(client, "student_owner", studentId, "", req.user.id, "automatic", "Verified email matched the legacy record");
          return { status: 201, id: c.rows[0].id, claim_status: "approved", student_id: studentId,
            message: "Your verified email matches this profile's record, so it is now yours." };
        }
        const c = await client.query(
          "INSERT INTO profile_claims (student_id, user_id, note, status, method) VALUES ($1,$2,$3,'pending','staff') RETURNING id",
          [studentId, req.user.id, note]
        );
        return { status: 201, id: c.rows[0].id, claim_status: "pending", student_id: studentId,
          message: own.rowCount
            ? "Sent to staff. You already have a profile, so staff will check the claim and may merge the two."
            : "Sent to staff for review. Nothing changes until staff approve it." };
      });
      const { status, ...body } = out;
      res.status(status).json(body);
    } catch (err) {
      fail(res, req, err, "Could not send your claim.");
    }
  });

  app.get("/api/staff/claims", requireStaff, async (req, res) => {
    try {
      const r = await pool.query(
        `SELECT c.id, c.student_id, s.name AS student_name, s.legacy_email, s.user_id AS current_owner,
                c.user_id, u.github_login, u.algoma_email, c.note, c.status, c.method,
                c.decided_by, c.decision_note, c.created_at, c.decided_at,
                EXISTS (SELECT 1 FROM students o WHERE o.user_id = c.user_id) AS claimant_has_profile
           FROM profile_claims c
           JOIN students s ON s.id = c.student_id
           JOIN users u ON u.id = c.user_id
          ORDER BY (c.status = 'pending') DESC, c.id DESC LIMIT 100`
      );
      res.json(r.rows);
    } catch (err) {
      fail(res, req, err, "Could not load claims.");
    }
  });

  app.post("/api/staff/claims/:claimId/decision", requireStaff, async (req, res) => {
    const decision = req.body && req.body.decision;
    const note = plainText(req.body && req.body.note, 1000);
    if (!["approve", "reject"].includes(decision)) return res.status(400).json({ error: "Choose approve or reject." });
    if (decision === "reject" && !note) return res.status(400).json({ error: "Add a note explaining the rejection; the student sees it." });
    try {
      const out = await inTransaction(async (client) => {
        const c = (await client.query("SELECT * FROM profile_claims WHERE id = $1 FOR UPDATE", [Number(req.params.claimId) || 0])).rows[0];
        if (!c) return { status: 404, error: "Claim not found." };
        if (c.status !== "pending") return { status: 409, error: "This claim was already decided." };
        if (decision === "approve") {
          const s = (await client.query("SELECT user_id, merged_into FROM students WHERE id = $1 FOR UPDATE", [c.student_id])).rows[0];
          if (!s || s.merged_into) return { status: 409, error: "That profile was merged; approve a claim on the surviving profile instead." };
          if (s.user_id) return { status: 409, error: "That profile already has an owner. Use Change owner if it must move." };
          const own = await client.query("SELECT id FROM students WHERE user_id = $1", [c.user_id]);
          if (own.rowCount) {
            return { status: 409, error: `The claimant already owns profile ${own.rows[0].id}. Merge that profile into this one first, then approve.` };
          }
          await client.query("UPDATE students SET user_id = $2 WHERE id = $1", [c.student_id, c.user_id]);
          await logOwnership(client, "student_owner", c.student_id, "", c.user_id, req.user.username, note || "Claim approved");
        }
        await client.query(
          "UPDATE profile_claims SET status = $2, decided_by = $3, decision_note = $4, decided_at = NOW() WHERE id = $1",
          [c.id, decision === "approve" ? "approved" : "rejected", req.user.username, note]
        );
        return { status: 200, id: c.id, claim_status: decision === "approve" ? "approved" : "rejected" };
      });
      const { status, ...body } = out;
      res.status(status).json(body);
    } catch (err) {
      fail(res, req, err, "Could not record the decision.");
    }
  });

  // -------------------------------------------------------------------------
  // Staff record tools: search, owner recovery, alumni status, merges
  // -------------------------------------------------------------------------
  app.get("/api/staff/students", requireStaff, async (req, res) => {
    const q = plainText(req.query.q, 80);
    try {
      const r = await pool.query(
        `SELECT s.id, s.name, s.status, s.profile_status, s.merged_into, s.legacy_email,
                s.availability_mode, s.availability_confirmed_at, s.user_id,
                u.github_login AS owner_login, u.algoma_email AS owner_email,
                (SELECT STRING_AGG(l.legacy_id, ', ') FROM legacy_ids l WHERE l.kind = 'student' AND l.internal_id = s.id) AS legacy_ids,
                (SELECT COUNT(*)::int FROM project_contributors pc WHERE pc.student_id = s.id AND pc.removed_at IS NULL) AS projects
           FROM students s LEFT JOIN users u ON u.id = s.user_id
          WHERE ($1 = '' OR s.name ILIKE '%' || $1 || '%' OR s.id = $1 OR s.legacy_email ILIKE '%' || $1 || '%'
                 OR EXISTS (SELECT 1 FROM legacy_ids l WHERE l.kind = 'student' AND l.internal_id = s.id AND l.legacy_id ILIKE $1))
          ORDER BY s.name, s.id LIMIT 50`,
        [q]
      );
      res.json(r.rows);
    } catch (err) {
      fail(res, req, err, "Could not search profiles.");
    }
  });

  /** F.10 — recover or reassign ownership; every change is logged. */
  app.post("/api/staff/students/:sid/owner", requireStaff, async (req, res) => {
    const b = req.body || {};
    const note = plainText(b.note, 1000);
    if (!note) return res.status(400).json({ error: "Add a note explaining why ownership is changing." });
    try {
      let user = null;
      if (!b.clear) {
        user = await findUser(b.user);
        if (!user) return res.status(404).json({ error: "No student account matches that GitHub login or verified email." });
      }
      const out = await inTransaction(async (client) => {
        const s = (await client.query("SELECT id, user_id, merged_into FROM students WHERE id = $1 FOR UPDATE", [req.params.sid])).rows[0];
        if (!s || s.merged_into) return { status: 404, error: "Profile not found or already merged." };
        if (user) {
          const own = await client.query("SELECT id FROM students WHERE user_id = $1 AND id <> $2", [user.id, s.id]);
          if (own.rowCount) return { status: 409, error: `That account already owns profile ${own.rows[0].id}. Merge the profiles first.` };
        }
        await client.query("UPDATE students SET user_id = $2 WHERE id = $1", [s.id, user ? user.id : null]);
        await logOwnership(client, "student_owner", s.id, s.user_id || "", user ? user.id : "", req.user.username, note);
        return { status: 200, id: s.id, owner: user ? user.github_login || user.id : null };
      });
      const { status, ...body } = out;
      res.status(status).json(body);
    } catch (err) {
      fail(res, req, err, "Could not change the owner.");
    }
  });

  /**
   * F.11, F.12 — graduating changes status only: publication, the portfolio
   * and the user's verified affiliation are untouched.
   */
  app.post("/api/staff/students/:sid/status", requireStaff, async (req, res) => {
    const status = req.body && req.body.status;
    if (!["current", "alumni"].includes(status)) return res.status(400).json({ error: "Status must be current or alumni." });
    try {
      const r = await pool.query("UPDATE students SET status = $2 WHERE id = $1 AND merged_into IS NULL RETURNING id, status, profile_status", [
        req.params.sid,
        status,
      ]);
      if (!r.rowCount) return res.status(404).json({ error: "Profile not found." });
      await logOwnership(pool, "student_status", req.params.sid, "", status, req.user.username, "");
      res.json(r.rows[0]);
    } catch (err) {
      fail(res, req, err, "Could not change the status.");
    }
  });

  app.post("/api/staff/students/merge", requireStaff, async (req, res) => {
    const b = req.body || {};
    try {
      const out = await inTransaction((client) =>
        mergeStudents(client, String(b.from_id || ""), String(b.into_id || ""), req.user.username, plainText(b.note, 1000))
      );
      const { status, ...body } = out;
      res.status(status).json(body);
    } catch (err) {
      fail(res, req, err, "Could not merge the profiles; nothing was changed.");
    }
  });

  app.get("/api/staff/companies-all", requireStaff, async (req, res) => {
    try {
      const r = await pool.query(
        `SELECT c.id, c.name, c.domain, c.status, c.merged_into,
                (SELECT STRING_AGG(l.legacy_id, ', ') FROM legacy_ids l WHERE l.kind = 'company' AND l.internal_id = c.id) AS legacy_ids,
                (SELECT COUNT(*)::int FROM collaborations co WHERE co.company_id = c.id) AS collaborations
           FROM companies c ORDER BY c.name, c.id LIMIT 200`
      );
      res.json(r.rows);
    } catch (err) {
      fail(res, req, err, "Could not load partners.");
    }
  });

  app.post("/api/staff/companies/merge", requireStaff, async (req, res) => {
    const b = req.body || {};
    try {
      const out = await inTransaction((client) =>
        mergeCompanies(client, String(b.from_id || ""), String(b.into_id || ""), req.user.username, plainText(b.note, 1000))
      );
      const { status, ...body } = out;
      res.status(status).json(body);
    } catch (err) {
      fail(res, req, err, "Could not merge the partners; nothing was changed.");
    }
  });

  // -------------------------------------------------------------------------
  // F.19 — maintainer recovery
  // -------------------------------------------------------------------------
  app.get("/api/staff/projects", requireStaff, async (req, res) => {
    const q = plainText(req.query.q, 80);
    try {
      const r = await pool.query(
        `SELECT p.id, p.title, p.project_status, p.maintainer_student_id, m.name AS maintainer_name,
                COALESCE((SELECT JSON_AGG(JSON_BUILD_OBJECT('student_id', s.id, 'name', s.name, 'role', pc.role, 'status', pc.status) ORDER BY s.name)
                   FROM project_contributors pc JOIN students s ON s.id = pc.student_id
                  WHERE pc.project_id = p.id AND pc.removed_at IS NULL), '[]') AS contributors
           FROM projects p LEFT JOIN students m ON m.id = p.maintainer_student_id
          WHERE ($1 = '' OR p.title ILIKE '%' || $1 || '%' OR p.id = $1)
          ORDER BY p.title, p.id LIMIT 50`,
        [q]
      );
      res.json(r.rows);
    } catch (err) {
      fail(res, req, err, "Could not search projects.");
    }
  });

  app.post("/api/staff/projects/:pid/maintainer", requireStaff, async (req, res) => {
    const studentId = String((req.body && req.body.student_id) || "");
    const note = plainText(req.body && req.body.note, 1000);
    if (!note) return res.status(400).json({ error: "Add a note explaining why the maintainer is changing." });
    try {
      const out = await inTransaction(async (client) => {
        const p = (await client.query("SELECT id, maintainer_student_id FROM projects WHERE id = $1 FOR UPDATE", [req.params.pid])).rows[0];
        if (!p) return { status: 404, error: "Project not found." };
        const pc = await client.query(
          "SELECT 1 FROM project_contributors WHERE project_id = $1 AND student_id = $2 AND status = 'accepted' AND removed_at IS NULL",
          [p.id, studentId]
        );
        if (!pc.rowCount) return { status: 400, error: "The new maintainer must be an accepted contributor on this project." };
        await client.query("UPDATE projects SET maintainer_student_id = $2, updated_at = NOW(), version = version + 1 WHERE id = $1", [p.id, studentId]);
        await logOwnership(client, "project_maintainer", p.id, p.maintainer_student_id || "", studentId, req.user.username, note);
        return { status: 200, id: p.id, maintainer_student_id: studentId };
      });
      const { status, ...body } = out;
      res.status(status).json(body);
    } catch (err) {
      fail(res, req, err, "Could not change the maintainer.");
    }
  });

  // -------------------------------------------------------------------------
  // F.32 — diagnostics and the ownership audit trail (staff only)
  // -------------------------------------------------------------------------
  app.get("/api/staff/diagnostics", requireStaff, async (req, res) => {
    try {
      const [events, audit] = await Promise.all([
        pool.query("SELECT id, kind, context, message, created_at FROM diagnostic_events ORDER BY id DESC LIMIT 100"),
        pool.query("SELECT id, kind, subject_id, from_value, to_value, actor, note, created_at FROM ownership_events ORDER BY id DESC LIMIT 100"),
      ]);
      res.json({ events: events.rows, audit: audit.rows });
    } catch (err) {
      fail(res, req, err, "Could not load diagnostics.");
    }
  });
}

module.exports = { register, recordDiagnostic, continuity, mergeStudents, mergeCompanies };
