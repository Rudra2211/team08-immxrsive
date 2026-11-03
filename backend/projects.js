/**
 * Release 3 — shared projects, contributor evidence and demo links.
 * R3.01 - R3.24.
 *
 * Two team decisions this release required us to make, recorded here because
 * the code has to have one answer (see RELEASE_NOTES.md):
 *
 *   Authorized editor (R3.06). The maintainer is the only person who may edit
 *   SHARED project fields. Accepted contributors always control their own
 *   contribution statement and their own featured flag (R3.11, R3.12).
 *
 *   Removal recovery (R3.13). A maintainer removing a contributor performs a
 *   reversible soft delete: removed_at is set, the row survives, and the
 *   maintainer can restore it. A contributor removing themselves only clears
 *   their own featured flag and never touches the canonical relationship.
 */
const fs = require("fs");
const path = require("path");
const { pool } = require("./db");
const { requireAuth, requireVerified, id } = require("./auth");
const { plainText } = require("./profile");

/** R3.10 — the standardized role vocabulary, from the Release 3 fixture. */
const STANDARD_ROLES = JSON.parse(
  fs.readFileSync(path.join(__dirname, "data", "standard_roles.json"), "utf8")
);
const ROLE_BY_LOWER = new Map(STANDARD_ROLES.map((r) => [r.toLowerCase(), r]));

const DOMAINS = [
  "XR / Immersive",
  "Games",
  "Web / Software",
  "Art / Visualization",
  "Data / AI",
  "Research",
  "Other",
];
const PROJECT_STAGES = ["concept", "in-progress", "complete", "archived"];

/**
 * R3.19 — students supply URLs, never markup. Anything that is not an http(s)
 * URL is rejected rather than stored, which is what stops `javascript:`,
 * `data:` and raw iframe/script text from ever reaching a public page. The
 * public pages additionally build links through the DOM rather than innerHTML,
 * so a stored value cannot become an element even if this check were bypassed.
 */
function safeUrl(value) {
  const raw = String(value == null ? "" : value).trim().slice(0, 500);
  if (!raw) return "";
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    return "";
  }
  return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed.toString() : "";
}

/**
 * R3.16 — the comparison key for "is this repository already connected?".
 * Host plus path, lowercased, without scheme, "www.", ".git" or a trailing
 * slash, so github.com/Org/Repo, https://www.github.com/org/repo/ and
 * git@-style https clones ending .git all collapse to one key.
 */
function normalizeRepo(value) {
  const url = safeUrl(value);
  if (!url) return "";
  const parsed = new URL(url);
  const host = parsed.host.toLowerCase().replace(/^www\./, "");
  const pathname = parsed.pathname.toLowerCase().replace(/\.git$/, "").replace(/\/+$/, "");
  return pathname && pathname !== "/" ? `${host}${pathname}` : "";
}

/** Lowercase alphanumerics only, for the advisory title-similarity warning. */
function titleKey(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** Significant words of a title. Two-letter tokens like "XR" carry little
 *  discriminating power across an XR portfolio, so they are dropped. */
function titleTokens(value) {
  return String(value || "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 3);
}

/**
 * R3.16 — advisory only. Similar titles produce a warning the user can ignore;
 * they must never merge records, so this is deliberately a weak signal used
 * for nothing but the message shown on screen.
 *
 * Containment alone is not enough: the fixture's
 * similar_title_different_repository case pairs "XR Anatomy Learning Lab" with
 * "XR Anatomy Lab", where neither string contains the other because the extra
 * word sits in the middle. Token overlap catches that; containment still
 * catches "Anatomy Lab" inside "Anatomy Lab 2026".
 */
function similarTitle(a, b) {
  const x = titleKey(a);
  const y = titleKey(b);
  if (!x || !y) return false;
  if (x === y) return true;
  if (x.length >= 4 && y.length >= 4 && (x.includes(y) || y.includes(x))) return true;

  const ta = new Set(titleTokens(a));
  const tb = new Set(titleTokens(b));
  if (!ta.size || !tb.size) return false;
  let shared = 0;
  for (const t of ta) if (tb.has(t)) shared += 1;
  return shared >= 2 && shared / Math.min(ta.size, tb.size) >= 0.6;
}

function standardRole(value) {
  return ROLE_BY_LOWER.get(String(value || "").trim().toLowerCase()) || "";
}

function toStringList(input, maxItems = 30, maxLength = 60) {
  const out = [];
  const seen = new Set();
  for (const raw of Array.isArray(input) ? input : String(input || "").split(",")) {
    const value = plainText(raw, maxLength);
    if (!value) continue;
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(value);
    if (out.length >= maxItems) break;
  }
  return out;
}

/**
 * The signed-in user's own students row. A project is owned by a STUDENT, not
 * by a user, because contributors are students everywhere else in the schema.
 */
async function myStudent(req, res) {
  const r = await pool.query("SELECT id, name FROM students WHERE user_id = $1", [req.user.id]);
  if (!r.rows[0]) {
    res.status(409).json({ error: "Create your student profile before adding a project." });
    return null;
  }
  return r.rows[0];
}

/**
 * R3.24 — authorization is resolved from the project row and the signed-in
 * student, never from anything in the request body. A request naming another
 * student's project is refused even though no button in the UI produces one.
 * `need` is "maintainer" for shared fields or "contributor" for own-row edits.
 */
async function authorize(req, res, need) {
  const me = await myStudent(req, res);
  if (!me) return null;

  const p = await pool.query("SELECT * FROM projects WHERE id = $1", [req.params.id]);
  const project = p.rows[0];
  if (!project) {
    res.status(404).json({ error: "Project not found." });
    return null;
  }

  if (need === "maintainer") {
    if (project.maintainer_student_id !== me.id) {
      res.status(403).json({ error: "Only the project maintainer can change this project." });
      return null;
    }
    return { me, project, contribution: null };
  }

  const c = await pool.query(
    "SELECT * FROM project_contributors WHERE project_id = $1 AND student_id = $2",
    [project.id, me.id]
  );
  if (!c.rows[0]) {
    res.status(403).json({ error: "You are not a contributor on this project." });
    return null;
  }
  return { me, project, contribution: c.rows[0] };
}

/** One shape for every editable view, so the editor and the API cannot drift. */
async function editableProject(projectId, viewerStudentId) {
  const p = await pool.query("SELECT * FROM projects WHERE id = $1", [projectId]);
  const project = p.rows[0];
  if (!project) return null;

  const [techs, repos, contributors] = await Promise.all([
    pool.query(
      "SELECT technology FROM project_technologies WHERE project_id = $1 ORDER BY technology",
      [projectId]
    ),
    pool.query(
      "SELECT url, normalized FROM project_repositories WHERE project_id = $1 ORDER BY added_at",
      [projectId]
    ),
    pool.query(
      `SELECT pc.student_id, s.name, pc.role, pc.status, pc.contribution_statement,
              pc.featured, pc.removed_at, pc.invited_at, pc.responded_at
         FROM project_contributors pc
         JOIN students s ON s.id = pc.student_id
        WHERE pc.project_id = $1
        ORDER BY pc.invited_at, s.name`,
      [projectId]
    ),
  ]);

  const mine = contributors.rows.find((c) => c.student_id === viewerStudentId) || null;
  return {
    id: project.id,
    title: project.title,
    description: project.description,
    domain: project.domain,
    date_text: project.date_text,
    project_status: project.project_status,
    version: project.version,
    playable_url: project.playable_url,
    video_url: project.video_url,
    fallback_image_url: project.fallback_image_url,
    fallback_note: project.fallback_note,
    links: project.links || {},
    technologies: techs.rows.map((r) => r.technology),
    repositories: repos.rows,
    maintainer_student_id: project.maintainer_student_id,
    is_maintainer: project.maintainer_student_id === viewerStudentId,
    contributors: contributors.rows,
    my_contribution: mine,
  };
}

function register(app) {
  // -------------------------------------------------------------------------
  // Vocabulary and lookups
  // -------------------------------------------------------------------------

  /** Registered before server.js's /api/projects/:id so :id cannot swallow it. */
  app.get("/api/projects/options", (req, res) => {
    res.json({ roles: STANDARD_ROLES, domains: DOMAINS, stages: PROJECT_STAGES });
  });

  /**
   * R3.16 — duplicate warning. Advisory by design: it reports what already
   * exists and never merges, blocks or rewrites anything. The caller decides.
   */
  app.get("/api/projects/duplicate-check", requireAuth, requireVerified, async (req, res) => {
    const normalized = normalizeRepo(req.query.repository);
    const title = plainText(req.query.title, 200);
    const domain = plainText(req.query.domain, 120);
    try {
      const byRepo = normalized
        ? await pool.query(
            `SELECT p.id, p.title, p.domain, pr.url
               FROM project_repositories pr
               JOIN projects p ON p.id = pr.project_id
              WHERE pr.normalized = $1`,
            [normalized]
          )
        : { rows: [] };

      let byTitle = [];
      const tokens = titleTokens(title);
      if (title && tokens.length) {
        // Candidates are anything sharing one significant word; similarTitle
        // then decides. LIMIT keeps this bounded as the project count grows.
        const candidates = await pool.query(
          `SELECT id, title, domain FROM projects
            WHERE title ILIKE ANY($1::text[]) LIMIT 50`,
          [tokens.map((t) => `%${t}%`)]
        );
        const repoIds = new Set(byRepo.rows.map((r) => r.id));
        byTitle = candidates.rows.filter((r) => {
          if (repoIds.has(r.id) || !similarTitle(r.title, title)) return false;
          // A declared domain that differs is a deliberate signal that these
          // are different pieces of work — the fixture's
          // same_title_different_domain case expects creation to be allowed
          // rather than warned about. An unstated domain cannot distinguish
          // them, so the warning stands.
          if (domain && r.domain && domain.toLowerCase() !== r.domain.toLowerCase()) return false;
          return true;
        });
      }

      res.json({
        repository_matches: byRepo.rows,
        title_matches: byTitle,
        // The repository match is the strong warning, with a route to join the
        // existing project; a title match is only a hint. Neither ever merges
        // records, and neither blocks creation (R3.16).
        advice: byRepo.rows.length
          ? "warn_existing_project"
          : byTitle.length
          ? "warn_if_useful_but_do_not_auto_merge"
          : "allow_distinct_project_do_not_auto_merge",
      });
    } catch (err) {
      console.error("GET /api/projects/duplicate-check failed:", err.message);
      res.status(500).json({ error: "Could not check for existing projects." });
    }
  });

  /**
   * R3.03 — GitHub import. Returns EDITABLE SUGGESTIONS only; nothing is
   * created and nothing is saved here. The student reviews and may change
   * every value before creating the project.
   */
  app.post("/api/projects/import-github", requireAuth, requireVerified, async (req, res) => {
    const repoUrl = safeUrl(req.body && req.body.repository);
    const normalized = normalizeRepo(repoUrl);
    if (!normalized.startsWith("github.com/")) {
      return res.status(400).json({ error: "Enter a public GitHub repository URL, for example https://github.com/owner/name." });
    }
    const slug = normalized.slice("github.com/".length);
    if (slug.split("/").length !== 2) {
      return res.status(400).json({ error: "That GitHub URL does not point at a repository." });
    }

    try {
      const headers = { Accept: "application/vnd.github+json", "User-Agent": "team08-immxrsive" };
      const [repoRes, langRes] = await Promise.all([
        fetch(`https://api.github.com/repos/${slug}`, { headers, signal: AbortSignal.timeout(8000) }),
        fetch(`https://api.github.com/repos/${slug}/languages`, { headers, signal: AbortSignal.timeout(8000) }),
      ]);

      if (repoRes.status === 404) {
        return res.status(404).json({ error: "That repository could not be found. Check the URL, and that the repository is public." });
      }
      if (!repoRes.ok) {
        return res.status(502).json({ error: "GitHub could not be reached just now. You can still enter the project manually." });
      }

      const repo = await repoRes.json();
      const languages = langRes.ok ? Object.keys(await langRes.json()) : [];

      // Suggestions, not values. plainText strips markup from the description
      // exactly as it does for profile text (R2.25).
      res.json({
        suggestions: {
          title: plainText(repo.name, 200),
          description: plainText(repo.description, 2000),
          repository: repo.html_url || repoUrl,
          technologies: toStringList(
            [repo.language, ...languages].filter(Boolean)
          ),
          links: { homepage: safeUrl(repo.homepage) },
        },
        note: "These are suggestions. Edit anything before saving.",
      });
    } catch (err) {
      console.error("POST /api/projects/import-github failed:", err.message);
      res.status(502).json({ error: "GitHub could not be reached just now. You can still enter the project manually." });
    }
  });

  /**
   * R3.08 — teammate lookup for invitations. Authenticated and verified only,
   * and it returns nothing but an id and a display name, so it is not a public
   * directory of unpublished students (R1.20 remains about public exposure).
   */
  app.get("/api/students/search", requireAuth, requireVerified, async (req, res) => {
    const q = plainText(req.query.q, 100);
    if (!q) return res.json([]);
    try {
      const r = await pool.query(
        `SELECT id, name FROM students
          WHERE user_id IS NOT NULL AND user_id <> $1 AND name ILIKE $2
          ORDER BY name LIMIT 10`,
        [req.user.id, `%${q}%`]
      );
      res.json(r.rows);
    } catch (err) {
      console.error("GET /api/students/search failed:", err.message);
      res.status(500).json({ error: "Could not search for students." });
    }
  });

  // -------------------------------------------------------------------------
  // My projects
  // -------------------------------------------------------------------------

  /** Everything the signed-in student maintains, contributes to, or is invited to. */
  app.get("/api/my/projects", requireAuth, async (req, res) => {
    try {
      const me = await pool.query("SELECT id FROM students WHERE user_id = $1", [req.user.id]);
      if (!me.rows[0]) return res.json({ maintaining: [], contributing: [], invitations: [] });
      const sid = me.rows[0].id;

      const r = await pool.query(
        `SELECT p.id, p.title, p.domain, p.project_status, p.updated_at,
                p.maintainer_student_id, p.playable_url,
                pc.status AS my_status, pc.role AS my_role, pc.featured, pc.removed_at,
                (SELECT COUNT(*)::int FROM project_contributors x
                  WHERE x.project_id = p.id AND x.status = 'accepted' AND x.removed_at IS NULL)
                  AS accepted_contributors
           FROM projects p
           LEFT JOIN project_contributors pc
             ON pc.project_id = p.id AND pc.student_id = $1
          WHERE p.maintainer_student_id = $1 OR pc.student_id = $1
          ORDER BY p.updated_at DESC, p.title ASC`,
        [sid]
      );

      const rows = r.rows.map((row) => ({ ...row, is_maintainer: row.maintainer_student_id === sid }));
      res.json({
        student_id: sid,
        maintaining: rows.filter((x) => x.is_maintainer),
        contributing: rows.filter((x) => !x.is_maintainer && x.my_status === "accepted"),
        invitations: rows.filter((x) => x.my_status === "invited"),
      });
    } catch (err) {
      console.error("GET /api/my/projects failed:", err.message);
      res.status(500).json({ error: "Could not load your projects." });
    }
  });

  /**
   * R3.01, R3.02, R3.06 — one Add Project workflow. The creator becomes the
   * maintainer and the first accepted contributor. Created as a private draft,
   * so nothing appears publicly until the student publishes it.
   */
  app.post("/api/my/projects", requireAuth, requireVerified, async (req, res) => {
    const me = await myStudent(req, res);
    if (!me) return;

    const b = req.body || {};
    const title = plainText(b.title, 200);
    if (!title) return res.status(400).json({ error: "A project title is required." });

    const role = standardRole(b.role) || "Software Developer";
    const repositories = toStringList(b.repositories, 5, 500)
      .map((u) => ({ url: safeUrl(u), normalized: normalizeRepo(u) }))
      .filter((r) => r.normalized);

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const projectId = id("proj");

      await client.query(
        `INSERT INTO projects
           (id, title, description, domain, links, date_text, project_status,
            maintainer_student_id, playable_url, video_url, fallback_image_url, fallback_note)
         VALUES ($1,$2,$3,$4,$5,$6,'draft',$7,$8,$9,$10,$11)`,
        [
          projectId,
          title,
          plainText(b.description, 4000),
          plainText(b.domain, 120),
          JSON.stringify({ homepage: safeUrl(b.links && b.links.homepage) }),
          plainText(b.date_text, 120),
          me.id,
          safeUrl(b.playable_url),
          safeUrl(b.video_url),
          safeUrl(b.fallback_image_url),
          plainText(b.fallback_note, 500),
        ]
      );

      for (const tech of toStringList(b.technologies)) {
        await client.query(
          "INSERT INTO project_technologies (project_id, technology) VALUES ($1,$2) ON CONFLICT DO NOTHING",
          [projectId, tech]
        );
      }
      for (const repo of repositories) {
        await client.query(
          "INSERT INTO project_repositories (project_id, url, normalized) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING",
          [projectId, repo.url, repo.normalized]
        );
      }
      await client.query(
        `INSERT INTO project_contributors
           (project_id, student_id, role, status, responded_at, invited_by)
         VALUES ($1,$2,$3,'accepted',NOW(),$2)`,
        [projectId, me.id, role]
      );

      await client.query("COMMIT");
      res.status(201).json(await editableProject(projectId, me.id));
    } catch (err) {
      await client.query("ROLLBACK");
      console.error("POST /api/my/projects failed:", err.message);
      res.status(500).json({ error: "Could not create the project." });
    } finally {
      client.release();
    }
  });

  /** Editable view. A maintainer or any contributor may read it. */
  app.get("/api/my/projects/:id", requireAuth, async (req, res) => {
    try {
      const me = await pool.query("SELECT id FROM students WHERE user_id = $1", [req.user.id]);
      if (!me.rows[0]) return res.status(409).json({ error: "Create your student profile first." });
      const sid = me.rows[0].id;

      const view = await editableProject(req.params.id, sid);
      if (!view) return res.status(404).json({ error: "Project not found." });
      const isContributor = view.contributors.some((c) => c.student_id === sid);
      if (!view.is_maintainer && !isContributor) {
        return res.status(403).json({ error: "You are not a contributor on this project." });
      }
      res.json(view);
    } catch (err) {
      console.error("GET /api/my/projects/:id failed:", err.message);
      res.status(500).json({ error: "Could not load the project." });
    }
  });

  /**
   * R3.17, R3.24 — shared-field update. The client must send the version it
   * read. The UPDATE matches on that version, so a save built on a stale copy
   * matches zero rows and is reported as a conflict with the current record
   * rather than silently overwriting a newer change.
   */
  app.put("/api/my/projects/:id", requireAuth, requireVerified, async (req, res) => {
    const ctx = await authorize(req, res, "maintainer");
    if (!ctx) return;

    const b = req.body || {};
    const version = Number.parseInt(b.version, 10);
    if (!Number.isInteger(version)) {
      return res.status(400).json({ error: "The project version is missing. Reload the project and try again." });
    }
    const title = plainText(b.title, 200);
    if (!title) return res.status(400).json({ error: "A project title is required." });

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const upd = await client.query(
        `UPDATE projects SET
           title = $1, description = $2, domain = $3, date_text = $4, links = $5,
           playable_url = $6, video_url = $7, fallback_image_url = $8, fallback_note = $9,
           version = version + 1, updated_at = NOW()
         WHERE id = $10 AND version = $11
         RETURNING version`,
        [
          title,
          plainText(b.description, 4000),
          plainText(b.domain, 120),
          plainText(b.date_text, 120),
          JSON.stringify({ homepage: safeUrl(b.links && b.links.homepage) }),
          safeUrl(b.playable_url),
          safeUrl(b.video_url),
          safeUrl(b.fallback_image_url),
          plainText(b.fallback_note, 500),
          ctx.project.id,
          version,
        ]
      );

      if (upd.rowCount === 0) {
        await client.query("ROLLBACK");
        const current = await editableProject(ctx.project.id, ctx.me.id);
        return res.status(409).json({
          error:
            "Someone else saved a newer version of this project. Your changes were not applied. Review the current version below and re-apply what you need.",
          conflict: true,
          current,
        });
      }

      if (b.technologies !== undefined) {
        await client.query("DELETE FROM project_technologies WHERE project_id = $1", [ctx.project.id]);
        for (const tech of toStringList(b.technologies)) {
          await client.query(
            "INSERT INTO project_technologies (project_id, technology) VALUES ($1,$2) ON CONFLICT DO NOTHING",
            [ctx.project.id, tech]
          );
        }
      }

      await client.query("COMMIT");
      res.json(await editableProject(ctx.project.id, ctx.me.id));
    } catch (err) {
      await client.query("ROLLBACK");
      console.error("PUT /api/my/projects/:id failed:", err.message);
      res.status(500).json({ error: "Could not save the project." });
    } finally {
      client.release();
    }
  });

  for (const [route, status] of [["publish", "published"], ["unpublish", "draft"]]) {
    app.post(`/api/my/projects/:id/${route}`, requireAuth, requireVerified, async (req, res) => {
      const ctx = await authorize(req, res, "maintainer");
      if (!ctx) return;
      try {
        await pool.query(
          "UPDATE projects SET project_status = $1, updated_at = NOW() WHERE id = $2",
          [status, ctx.project.id]
        );
        res.json(await editableProject(ctx.project.id, ctx.me.id));
      } catch (err) {
        console.error(`POST /api/my/projects/:id/${route} failed:`, err.message);
        res.status(500).json({ error: "Could not change the project's visibility." });
      }
    });
  }

  // -------------------------------------------------------------------------
  // Repositories (R3.04)
  // -------------------------------------------------------------------------

  /** A project may hold zero, one or many repositories, and stays valid either way. */
  app.post("/api/my/projects/:id/repositories", requireAuth, requireVerified, async (req, res) => {
    const ctx = await authorize(req, res, "maintainer");
    if (!ctx) return;
    const url = safeUrl(req.body && req.body.repository);
    const normalized = normalizeRepo(url);
    if (!normalized) return res.status(400).json({ error: "Enter a repository URL starting with https://." });
    try {
      await pool.query(
        "INSERT INTO project_repositories (project_id, url, normalized) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING",
        [ctx.project.id, url, normalized]
      );
      await pool.query("UPDATE projects SET updated_at = NOW() WHERE id = $1", [ctx.project.id]);
      res.json(await editableProject(ctx.project.id, ctx.me.id));
    } catch (err) {
      console.error("POST repositories failed:", err.message);
      res.status(500).json({ error: "Could not add the repository." });
    }
  });

  /** Disconnecting the last repository is allowed — the project survives (R3.04). */
  app.delete("/api/my/projects/:id/repositories", requireAuth, requireVerified, async (req, res) => {
    const ctx = await authorize(req, res, "maintainer");
    if (!ctx) return;
    const normalized = normalizeRepo(req.body && req.body.repository);
    if (!normalized) return res.status(400).json({ error: "Which repository should be disconnected?" });
    try {
      await pool.query(
        "DELETE FROM project_repositories WHERE project_id = $1 AND normalized = $2",
        [ctx.project.id, normalized]
      );
      await pool.query("UPDATE projects SET updated_at = NOW() WHERE id = $1", [ctx.project.id]);
      res.json(await editableProject(ctx.project.id, ctx.me.id));
    } catch (err) {
      console.error("DELETE repositories failed:", err.message);
      res.status(500).json({ error: "Could not disconnect the repository." });
    }
  });

  // -------------------------------------------------------------------------
  // Contributors (R3.08 - R3.13)
  // -------------------------------------------------------------------------

  /** R3.08 — invite an existing platform student and propose a standardized role. */
  app.post("/api/my/projects/:id/invite", requireAuth, requireVerified, async (req, res) => {
    const ctx = await authorize(req, res, "maintainer");
    if (!ctx) return;

    const studentId = plainText(req.body && req.body.student_id, 80);
    const role = standardRole(req.body && req.body.role);
    if (!studentId) return res.status(400).json({ error: "Choose a student to invite." });
    if (!role) {
      return res.status(400).json({ error: `Choose a standard role: ${STANDARD_ROLES.join(", ")}.` });
    }
    if (studentId === ctx.me.id) return res.status(400).json({ error: "You are already on this project." });

    try {
      const target = await pool.query(
        "SELECT id FROM students WHERE id = $1 AND user_id IS NOT NULL",
        [studentId]
      );
      if (!target.rows[0]) return res.status(404).json({ error: "That student is not on the platform." });

      const existing = await pool.query(
        "SELECT status, removed_at FROM project_contributors WHERE project_id = $1 AND student_id = $2",
        [ctx.project.id, studentId]
      );
      if (existing.rows[0] && existing.rows[0].status === "accepted" && !existing.rows[0].removed_at) {
        return res.status(409).json({ error: "That student is already an accepted contributor." });
      }

      // Re-inviting someone who declined or was removed reopens the SAME row,
      // which keeps the historical relationship rather than creating a second
      // one (R3.13).
      await pool.query(
        `INSERT INTO project_contributors
           (project_id, student_id, role, status, invited_at, invited_by)
         VALUES ($1,$2,$3,'invited',NOW(),$4)
         ON CONFLICT (project_id, student_id) DO UPDATE
           SET role = EXCLUDED.role, status = 'invited', invited_at = NOW(),
               responded_at = NULL, removed_at = NULL, invited_by = EXCLUDED.invited_by`,
        [ctx.project.id, studentId, role, ctx.me.id]
      );
      res.json(await editableProject(ctx.project.id, ctx.me.id));
    } catch (err) {
      console.error("POST invite failed:", err.message);
      res.status(500).json({ error: "Could not send the invitation." });
    }
  });

  /** R3.10 — the maintainer sets the standardized role; never the statement (R3.11). */
  app.put("/api/my/projects/:id/contributors/:sid", requireAuth, requireVerified, async (req, res) => {
    const ctx = await authorize(req, res, "maintainer");
    if (!ctx) return;
    const role = standardRole(req.body && req.body.role);
    if (!role) {
      return res.status(400).json({ error: `Choose a standard role: ${STANDARD_ROLES.join(", ")}.` });
    }
    try {
      const r = await pool.query(
        "UPDATE project_contributors SET role = $1 WHERE project_id = $2 AND student_id = $3",
        [role, ctx.project.id, req.params.sid]
      );
      if (r.rowCount === 0) return res.status(404).json({ error: "That contributor is not on this project." });
      res.json(await editableProject(ctx.project.id, ctx.me.id));
    } catch (err) {
      console.error("PUT contributor role failed:", err.message);
      res.status(500).json({ error: "Could not update the role." });
    }
  });

  /**
   * R3.13 — removal is a reversible soft delete. The row and its history
   * survive, and /restore puts the contributor back, so one unilateral action
   * can never destroy an accepted relationship.
   */
  for (const [route, sql, missing] of [
    ["remove", "removed_at = NOW()", "That contributor is not on this project."],
    ["restore", "removed_at = NULL", "There is nothing to restore for that contributor."],
  ]) {
    app.post(
      `/api/my/projects/:id/contributors/:sid/${route}`,
      requireAuth,
      requireVerified,
      async (req, res) => {
        const ctx = await authorize(req, res, "maintainer");
        if (!ctx) return;
        if (req.params.sid === ctx.project.maintainer_student_id) {
          return res.status(409).json({
            error: "Transfer maintenance to another contributor before removing the maintainer.",
          });
        }
        try {
          const r = await pool.query(
            `UPDATE project_contributors SET ${sql} WHERE project_id = $1 AND student_id = $2`,
            [ctx.project.id, req.params.sid]
          );
          if (r.rowCount === 0) return res.status(404).json({ error: missing });
          res.json(await editableProject(ctx.project.id, ctx.me.id));
        } catch (err) {
          console.error(`POST contributor ${route} failed:`, err.message);
          res.status(500).json({ error: "Could not update the contributor." });
        }
      }
    );
  }

  /**
   * R3.07, R3.26 — transfer maintenance. The project id, the public URL and
   * every contributor relationship are untouched; only the maintainer changes.
   */
  app.post("/api/my/projects/:id/transfer", requireAuth, requireVerified, async (req, res) => {
    const ctx = await authorize(req, res, "maintainer");
    if (!ctx) return;
    const studentId = plainText(req.body && req.body.student_id, 80);
    try {
      const target = await pool.query(
        `SELECT 1 FROM project_contributors
          WHERE project_id = $1 AND student_id = $2 AND status = 'accepted' AND removed_at IS NULL`,
        [ctx.project.id, studentId]
      );
      if (!target.rows[0]) {
        return res.status(400).json({ error: "Maintenance can only be transferred to an accepted contributor." });
      }
      await pool.query(
        "UPDATE projects SET maintainer_student_id = $1, updated_at = NOW() WHERE id = $2",
        [studentId, ctx.project.id]
      );
      res.json(await editableProject(ctx.project.id, ctx.me.id));
    } catch (err) {
      console.error("POST transfer failed:", err.message);
      res.status(500).json({ error: "Could not transfer maintenance." });
    }
  });

  // -------------------------------------------------------------------------
  // The contributor's own side (R3.09 - R3.12)
  // -------------------------------------------------------------------------

  /** R3.09 — accept or decline. Until accepted, nothing is shown publicly. */
  app.post("/api/my/projects/:id/respond", requireAuth, requireVerified, async (req, res) => {
    const ctx = await authorize(req, res, "contributor");
    if (!ctx) return;
    if (ctx.contribution.status !== "invited") {
      return res.status(409).json({ error: "That invitation has already been answered." });
    }
    const accept = req.body && req.body.accept === true;
    try {
      await pool.query(
        `UPDATE project_contributors SET status = $1, responded_at = NOW()
          WHERE project_id = $2 AND student_id = $3`,
        [accept ? "accepted" : "declined", ctx.project.id, ctx.me.id]
      );
      res.json({ accepted: accept, project: await editableProject(ctx.project.id, ctx.me.id) });
    } catch (err) {
      console.error("POST respond failed:", err.message);
      res.status(500).json({ error: "Could not record your answer." });
    }
  });

  /**
   * R3.11, R3.12 — the contributor's own row. Only the signed-in contributor
   * can reach it, so no maintainer or other contributor can rewrite someone
   * else's contribution statement. featured=false removes the project from
   * this student's portfolio without touching the relationship (R3.13).
   */
  app.put("/api/my/projects/:id/contribution", requireAuth, requireVerified, async (req, res) => {
    const ctx = await authorize(req, res, "contributor");
    if (!ctx) return;
    if (ctx.contribution.status !== "accepted") {
      return res.status(409).json({ error: "Accept the invitation before editing your contribution." });
    }
    const b = req.body || {};
    try {
      await pool.query(
        `UPDATE project_contributors
            SET contribution_statement = $1,
                featured = $2
          WHERE project_id = $3 AND student_id = $4`,
        [
          plainText(b.contribution_statement, 1000),
          b.featured === undefined ? ctx.contribution.featured : b.featured === true,
          ctx.project.id,
          ctx.me.id,
        ]
      );
      res.json(await editableProject(ctx.project.id, ctx.me.id));
    } catch (err) {
      console.error("PUT contribution failed:", err.message);
      res.status(500).json({ error: "Could not save your contribution." });
    }
  });
}

module.exports = {
  register,
  normalizeRepo,
  safeUrl,
  similarTitle,
  standardRole,
  STANDARD_ROLES,
};
