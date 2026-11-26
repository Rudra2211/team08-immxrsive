/**
 * Final Release — legacy migration (F.01 - F.06, F.27).
 *
 * One import path for every bulk load: the legacy export, the scale fixture
 * and any later export all go through runMigration(), which writes the same
 * tables that self-service profiles and projects use. Staff run it from the
 * staff workspace (POST /api/staff/migrations) or from a shell:
 *
 *   DATABASE_URL=... node backend/migrate.js path/to/legacy_export.json
 *
 * Re-running the same file is safe (F.02): every record is found again
 * through legacy_ids, never by name, email, repository URL or domain (F.06),
 * and is reported as created, updated or skipped. Problems are reported, not
 * silently fixed (F.03): a contributor pointing at a student who does not
 * exist is listed as a broken reference and no relationship is invented.
 */
const crypto = require("crypto");
const fs = require("fs");
const { pool } = require("./db");
const { id } = require("./auth");
const { plainText, partitionSkills } = require("./profile");
const { normalizeRepo, safeUrl } = require("./projects");
const { domainOf } = require("./company-import");

const AVAILABILITY = ["internship", "full-time", "contract"];
const STATUS = ["current", "alumni"];
const PUBLICATION = { published: "published", unpublished: "unpublished", retired: "retired", draft: "unpublished" };

const hash = (value) => crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 32);

/** The scale fixture uses `id`/`student_id`; the legacy export uses `legacy_id`. Same importer for both. */
function normalise(data) {
  const students = Array.isArray(data && data.students) ? data.students : [];
  const projects = Array.isArray(data && data.projects) ? data.projects : [];
  const companies = Array.isArray(data && data.companies) ? data.companies : [];
  const collaborations = Array.isArray(data && data.collaborations) ? data.collaborations : [];
  const format = students.some((s) => s && s.legacy_id) || projects.some((p) => p && p.legacy_id) ? "legacy" : "scale";
  const lid = (r) => String((r && (r.legacy_id || r.id)) || "").trim();
  return {
    format,
    students: students.map((s) => ({ ...s, legacy_id: lid(s) })),
    projects: projects.map((p) => ({
      ...p,
      legacy_id: lid(p),
      contributors: (p.contributors || []).map((c) => ({
        student_legacy_id: String(c.student_legacy_id || c.student_id || "").trim(),
        role: c.role,
      })),
    })),
    companies: companies.map((c) => ({ ...c, legacy_id: lid(c) })),
    collaborations: collaborations.map((c) => ({ ...c, legacy_id: lid(c) })),
  };
}

function emptyCounts() {
  return { created: 0, updated: 0, skipped: 0, conflicts: 0 };
}

async function lookup(client, kind, legacyId) {
  const r = await client.query("SELECT internal_id, content_hash FROM legacy_ids WHERE kind = $1 AND legacy_id = $2", [kind, legacyId]);
  return r.rows[0] || null;
}

async function remember(client, kind, legacyId, internalId, contentHash, runId) {
  await client.query(
    `INSERT INTO legacy_ids (kind, legacy_id, internal_id, content_hash, first_run_id)
     VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (kind, legacy_id) DO UPDATE SET content_hash = EXCLUDED.content_hash, updated_at = NOW()`,
    [kind, legacyId, internalId, contentHash, runId]
  );
}

/** Imports one parsed export. Returns the report; throws only on a database failure (rolled back). */
async function runMigration(data, { sourceName = "", runBy = "" } = {}) {
  const src = normalise(data);
  const report = {
    format: src.format,
    source_name: sourceName,
    source_counts: {
      students: src.students.length,
      projects: src.projects.length,
      companies: src.companies.length,
      collaborations: src.collaborations.length,
    },
    students: emptyCounts(),
    projects: emptyCounts(),
    companies: emptyCounts(),
    collaborations: emptyCounts(),
    duplicate_student_candidates: [],
    duplicate_company_candidates: [],
    broken_references: [],
    // Records that look like ones already on the platform (for example the
    // Release 1 seed). Never matched automatically (F.06); staff merge them.
    possible_existing_matches: [],
    unclaimed_profiles: [],
    awaiting_owner_account: [],
    stale_availability: [],
    issues: [],
  };
  const issue = (kind, legacyId, message) => report.issues.push({ kind, legacy_id: legacyId, message });

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const run = await client.query(
      "INSERT INTO migration_runs (source_name, format, run_by) VALUES ($1,$2,$3) RETURNING id, created_at",
      [sourceName, src.format, runBy]
    );
    const runId = run.rows[0].id;
    report.run_id = Number(runId);
    report.run_at = run.rows[0].created_at;

    // ---- students ---------------------------------------------------------
    const studentIds = new Map(); // legacy id -> internal id
    const emailOwner = new Map(); // lowercased email -> legacy id seen first in this file
    const seen = new Set();
    for (const s of src.students) {
      const legacyId = s.legacy_id;
      if (!legacyId) {
        report.students.conflicts += 1;
        issue("student", "", "Record has no legacy id; it was skipped.");
        continue;
      }
      if (seen.has(legacyId)) {
        report.students.conflicts += 1;
        issue("student", legacyId, "The same legacy id appears twice in this file; the second copy was skipped.");
        continue;
      }
      seen.add(legacyId);

      const name = plainText(s.name, 120);
      const email = String(s.email || "").trim().toLowerCase();
      const status = STATUS.includes(String(s.status || "").toLowerCase()) ? String(s.status).toLowerCase() : null;
      const publication = PUBLICATION[String(s.publication || "").toLowerCase()] || null;
      const availability = [].concat(s.availability || []).map((v) => String(v).toLowerCase()).filter((v) => AVAILABILITY.includes(v));
      const confirmed = s.availability_confirmed && !Number.isNaN(Date.parse(s.availability_confirmed)) ? s.availability_confirmed : null;
      const { standardized: skills } = partitionSkills(s.skills || []);
      if (!name) {
        report.students.conflicts += 1;
        issue("student", legacyId, "Record has no name; it was skipped.");
        continue;
      }
      if (!status) issue("student", legacyId, `Unknown status "${s.status}"; imported as current.`);
      if (!publication) issue("student", legacyId, `Unknown publication "${s.publication}"; imported as unpublished.`);

      // F.03 — duplicates are reported for staff to merge (F.17), never merged silently.
      const declared = s.possible_duplicate_of ? String(s.possible_duplicate_of) : "";
      const sameEmail = email && emailOwner.has(email) ? emailOwner.get(email) : "";
      if (declared || sameEmail) {
        report.duplicate_student_candidates.push({
          legacy_id: legacyId,
          possible_duplicate_of: sameEmail || declared,
          reason: sameEmail ? "same email" : "marked as a possible duplicate in the legacy export",
        });
      }
      if (email && !emailOwner.has(email)) emailOwner.set(email, legacyId);

      const record = { name, email, status: status || "current", publication: publication || "unpublished", availability, confirmed, skills };
      const contentHash = hash(record);
      const known = await lookup(client, "student", legacyId);
      let internalId = known && known.internal_id;
      const existing = internalId
        ? (await client.query("SELECT id, user_id, profile_status, merged_into FROM students WHERE id = $1", [internalId])).rows[0]
        : null;

      if (existing && existing.merged_into) {
        report.students.skipped += 1;
        issue("student", legacyId, `Already merged into ${existing.merged_into} by staff; not re-created.`);
        studentIds.set(legacyId, existing.merged_into);
        continue;
      }
      if (existing && existing.user_id) {
        // A claimed profile is maintained by its owner from now on.
        report.students.skipped += 1;
        if (known.content_hash !== contentHash) issue("student", legacyId, "Profile is claimed by its owner; legacy changes were not applied.");
        studentIds.set(legacyId, internalId);
        continue;
      }
      if (existing && known.content_hash === contentHash) {
        report.students.skipped += 1;
        studentIds.set(legacyId, internalId);
      } else {
        const mode = availability.length ? "active" : "showcase";
        const retiredAt = record.publication === "retired" ? new Date() : null;
        if (existing) {
          await client.query(
            `UPDATE students SET name=$2, status=$3, profile_status=$4, legacy_email=$5, availability_mode=$6,
               availability_confirmed_at=$7, retired_at = CASE WHEN $4 = 'retired' THEN COALESCE(retired_at, NOW()) ELSE NULL END
             WHERE id=$1`,
            [internalId, name, record.status, record.publication, email, mode, confirmed]
          );
          report.students.updated += 1;
        } else {
          internalId = id("P");
          await client.query(
            `INSERT INTO students (id, name, headline, program, status, profile_status, links, legacy_email,
               availability_mode, availability_confirmed_at, retired_at, import_run_id)
             VALUES ($1,$2,'','',$3,$4,'{}'::jsonb,$5,$6,$7,$8,$9)`,
            [internalId, name, record.status, record.publication, email, mode, confirmed, retiredAt, runId]
          );
          report.students.created += 1;
          const twin = await client.query(
            `SELECT id FROM students WHERE LOWER(name) = LOWER($1) AND id <> $2 AND merged_into IS NULL
               AND id NOT IN (SELECT internal_id FROM legacy_ids WHERE kind = 'student') LIMIT 1`,
            [name, internalId]
          );
          if (twin.rowCount) report.possible_existing_matches.push({ kind: "student", legacy_id: legacyId, existing_id: twin.rows[0].id, reason: "same name as an existing profile" });
        }
        await client.query("DELETE FROM student_availability WHERE student_id = $1", [internalId]);
        for (const v of availability) {
          await client.query("INSERT INTO student_availability (student_id, value) VALUES ($1,$2) ON CONFLICT DO NOTHING", [internalId, v]);
        }
        if (skills.length) {
          await client.query("DELETE FROM student_skills WHERE student_id = $1", [internalId]);
          for (const sk of skills) {
            await client.query("INSERT INTO student_skills (student_id, skill_name) VALUES ($1,$2) ON CONFLICT DO NOTHING", [internalId, sk]);
          }
        }
        await remember(client, "student", legacyId, internalId, contentHash, runId);
        studentIds.set(legacyId, internalId);
      }

      const isDuplicate = report.duplicate_student_candidates.some((d) => d.legacy_id === legacyId);
      if (!isDuplicate) {
        if (s.claimed === true) report.awaiting_owner_account.push(legacyId);
        else report.unclaimed_profiles.push(legacyId);
      }
      if (availability.length && (!confirmed || Date.now() - Date.parse(confirmed) > 365 * 86400000)) {
        report.stale_availability.push(legacyId);
      }
    }

    // Students referenced by an earlier run but not present in this file.
    const resolveStudent = async (legacyId) => {
      if (studentIds.has(legacyId)) return studentIds.get(legacyId);
      const known = await lookup(client, "student", legacyId);
      if (!known) return null;
      const row = (await client.query("SELECT id, merged_into FROM students WHERE id = $1", [known.internal_id])).rows[0];
      return row ? row.merged_into || row.id : null;
    };

    // ---- projects -----------------------------------------------------------
    const projectIds = new Map();
    for (const p of src.projects) {
      const legacyId = p.legacy_id;
      const title = plainText(p.title, 200);
      if (!legacyId || !title) {
        report.projects.conflicts += 1;
        issue("project", legacyId, "Project has no legacy id or title; it was skipped.");
        continue;
      }
      // F.04 — every valid contributor becomes a relationship on ONE shared project.
      const contributors = [];
      for (const c of p.contributors) {
        const studentId = c.student_legacy_id ? await resolveStudent(c.student_legacy_id) : null;
        if (!studentId) {
          report.broken_references.push({ project_legacy_id: legacyId, student_legacy_id: c.student_legacy_id || "(missing)" });
          continue;
        }
        if (!contributors.some((x) => x.studentId === studentId)) {
          contributors.push({ studentId, role: plainText(c.role, 80) || "Contributor" });
        }
      }
      const repository = safeUrl(p.repository || "");
      const playable = safeUrl(p.demo_url || "");
      const technologies = [].concat(p.technologies || []).map((t) => plainText(t, 60)).filter(Boolean);
      const contentHash = hash({ title, contributors, repository, playable, technologies, description: p.description || "" });

      const known = await lookup(client, "project", legacyId);
      let internalId = known && known.internal_id;
      const exists = internalId && (await client.query("SELECT id FROM projects WHERE id = $1", [internalId])).rowCount;
      if (exists && known.content_hash === contentHash) {
        report.projects.skipped += 1;
        projectIds.set(legacyId, internalId);
        continue;
      }
      if (exists) {
        // Shared fields may since have been edited by the maintainer; only
        // add what the legacy file contributes, never remove people.
        report.projects.updated += 1;
      } else {
        internalId = id("proj");
        await client.query(
          `INSERT INTO projects (id, title, description, domain, links, maintainer_student_id, project_status, playable_url, import_run_id)
           VALUES ($1,$2,$3,'','{}'::jsonb,$4,'published',$5,$6)`,
          [internalId, title, plainText(p.description, 4000), contributors[0] ? contributors[0].studentId : null, playable, runId]
        );
        report.projects.created += 1;
        const twin = await client.query(
          `SELECT id FROM projects WHERE LOWER(title) = LOWER($1) AND id <> $2
             AND id NOT IN (SELECT internal_id FROM legacy_ids WHERE kind = 'project') LIMIT 1`,
          [title, internalId]
        );
        if (twin.rowCount) report.possible_existing_matches.push({ kind: "project", legacy_id: legacyId, existing_id: twin.rows[0].id, reason: "same title as an existing project" });
      }
      for (const t of technologies) {
        await client.query(
          "INSERT INTO project_technologies (project_id, technology) VALUES ($1,$2) ON CONFLICT DO NOTHING",
          [internalId, t]
        );
      }
      for (const c of contributors) {
        await client.query(
          `INSERT INTO project_contributors (project_id, student_id, role, status, featured, responded_at)
           VALUES ($1,$2,$3,'accepted',TRUE,NOW())
           ON CONFLICT (project_id, student_id) DO NOTHING`,
          [internalId, c.studentId, c.role]
        );
      }
      const normalized = normalizeRepo(repository);
      if (normalized) {
        await client.query(
          "INSERT INTO project_repositories (project_id, url, normalized) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING",
          [internalId, repository, normalized]
        );
      }
      await remember(client, "project", legacyId, internalId, contentHash, runId);
      projectIds.set(legacyId, internalId);
    }
    const resolveProject = async (legacyId) => {
      if (projectIds.has(legacyId)) return projectIds.get(legacyId);
      const known = await lookup(client, "project", legacyId);
      return known ? known.internal_id : null;
    };

    // ---- companies ---------------------------------------------------------
    const companyIds = new Map();
    const domainOwner = new Map();
    for (const c of src.companies) {
      const legacyId = c.legacy_id;
      const name = plainText(c.name, 200);
      if (!legacyId || !name) {
        report.companies.conflicts += 1;
        issue("company", legacyId, "Company has no legacy id or name; it was skipped.");
        continue;
      }
      const domain = domainOf(c.domain || c.website || "");
      const sameDomain = domain && domainOwner.has(domain) ? domainOwner.get(domain) : "";
      if (c.possible_duplicate_of || sameDomain) {
        report.duplicate_company_candidates.push({
          legacy_id: legacyId,
          possible_duplicate_of: sameDomain || String(c.possible_duplicate_of),
          reason: sameDomain ? "same website domain" : "marked as a possible duplicate in the legacy export",
        });
      }
      if (domain && !domainOwner.has(domain)) domainOwner.set(domain, legacyId);

      const contentHash = hash({ name, domain });
      const known = await lookup(client, "company", legacyId);
      let internalId = known && known.internal_id;
      const row = internalId ? (await client.query("SELECT id, merged_into FROM companies WHERE id = $1", [internalId])).rows[0] : null;
      if (row && row.merged_into) {
        report.companies.skipped += 1;
        issue("company", legacyId, `Already merged into ${row.merged_into} by staff; not re-created.`);
        companyIds.set(legacyId, row.merged_into);
        continue;
      }
      if (row && known.content_hash === contentHash) {
        report.companies.skipped += 1;
      } else if (row) {
        await client.query("UPDATE companies SET name=$2, domain=$3, updated_at=NOW() WHERE id=$1", [internalId, name, domain]);
        report.companies.updated += 1;
      } else {
        internalId = id("co");
        await client.query(
          `INSERT INTO companies (id, name, website, domain, status, created_by, published_at, field_sources, import_run_id)
           VALUES ($1,$2,$3,$4,'published',$5,NOW(),$6::jsonb,$7)`,
          [internalId, name, domain ? `https://${domain}` : "", domain, runBy || "migration",
           JSON.stringify({ name: { source: "legacy", url: sourceName, at: new Date().toISOString() } }), runId]
        );
        report.companies.created += 1;
        const twin = domain
          ? await client.query(
              `SELECT id FROM companies WHERE domain = $1 AND id <> $2 AND merged_into IS NULL
                 AND id NOT IN (SELECT internal_id FROM legacy_ids WHERE kind = 'company') LIMIT 1`,
              [domain, internalId]
            )
          : { rowCount: 0 };
        if (twin.rowCount) report.possible_existing_matches.push({ kind: "company", legacy_id: legacyId, existing_id: twin.rows[0].id, reason: "same website domain as an existing partner" });
      }
      await remember(client, "company", legacyId, internalId, contentHash, runId);
      companyIds.set(legacyId, internalId);
    }
    const resolveCompany = async (legacyId) => {
      if (companyIds.has(legacyId)) return companyIds.get(legacyId);
      const known = await lookup(client, "company", legacyId);
      if (!known) return null;
      const row = (await client.query("SELECT id, merged_into FROM companies WHERE id = $1", [known.internal_id])).rows[0];
      return row ? row.merged_into || row.id : null;
    };

    // ---- collaborations (F.05) ----------------------------------------------
    for (const co of src.collaborations) {
      const legacyId = co.legacy_id;
      const companyId = co.company_legacy_id ? await resolveCompany(String(co.company_legacy_id)) : null;
      const title = plainText(co.title, 200);
      if (!legacyId || !title || !companyId) {
        report.collaborations.conflicts += 1;
        if (!companyId) report.broken_references.push({ collaboration_legacy_id: legacyId, company_legacy_id: co.company_legacy_id || "(missing)" });
        else issue("collaboration", legacyId, "Collaboration has no legacy id or title; it was skipped.");
        continue;
      }
      const status = co.status === "past" ? "past" : "current";
      let visibility = ["public", "limited", "private"].includes(co.visibility) ? co.visibility : "private";
      const summary = plainText(co.public_summary, 300);
      if (visibility === "limited" && !summary) {
        visibility = "private";
        issue("collaboration", legacyId, "Marked limited but has no public summary; imported as private until staff add one.");
      }
      const projectIdsHere = [];
      for (const pl of co.project_legacy_ids || []) {
        const pid = await resolveProject(String(pl));
        if (pid) projectIdsHere.push(pid);
        else report.broken_references.push({ collaboration_legacy_id: legacyId, project_legacy_id: String(pl) });
      }
      const year = (v) => (Number.isInteger(Number(v)) && Number(v) > 1900 ? Number(v) : null);
      const fields = { companyId, title, status, visibility, summary, start: year(co.start_year), end: year(co.end_year), description: plainText(co.description, 4000), projects: projectIdsHere };
      const contentHash = hash(fields);
      const known = await lookup(client, "collaboration", legacyId);
      let internalId = known && known.internal_id;
      const exists = internalId && (await client.query("SELECT id FROM collaborations WHERE id = $1", [internalId])).rowCount;
      if (exists && known.content_hash === contentHash) {
        report.collaborations.skipped += 1;
        continue;
      }
      if (exists) {
        await client.query(
          `UPDATE collaborations SET company_id=$2, title=$3, status=$4, visibility=$5, public_summary=$6,
             start_year=$7, end_year=$8, description=$9, updated_at=NOW() WHERE id=$1`,
          [internalId, companyId, title, status, visibility, summary, fields.start, fields.end, fields.description]
        );
        report.collaborations.updated += 1;
      } else {
        internalId = id("col");
        await client.query(
          `INSERT INTO collaborations (id, company_id, title, status, visibility, public_summary, start_year, end_year, description)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
          [internalId, companyId, title, status, visibility, summary, fields.start, fields.end, fields.description]
        );
        report.collaborations.created += 1;
      }
      for (const pid of projectIdsHere) {
        await client.query("INSERT INTO collaboration_projects (collaboration_id, project_id) VALUES ($1,$2) ON CONFLICT DO NOTHING", [internalId, pid]);
        // Only a public collaboration becomes a visible project-partner link;
        // a private or limited one must not reveal the relationship (F.20).
        if (visibility === "public") {
          await client.query(
            `INSERT INTO project_partners (project_id, company_id, approved_by) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`,
            [pid, companyId, runBy || "migration"]
          );
        }
      }
      await remember(client, "collaboration", legacyId, internalId, contentHash, runId);
    }

    await client.query("UPDATE migration_runs SET report = $2::jsonb WHERE id = $1", [runId, JSON.stringify(report)]);
    await client.query("COMMIT");
    return report;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { runMigration, normalise };

if (require.main === module) {
  const file = process.argv[2];
  if (!file) {
    console.error("Usage: node backend/migrate.js <export.json>");
    process.exit(2);
  }
  const { initDb } = require("./db");
  initDb()
    .then(() => runMigration(JSON.parse(fs.readFileSync(file, "utf8")), { sourceName: require("path").basename(file), runBy: "cli" }))
    .then((report) => {
      console.log(JSON.stringify(report, null, 2));
      process.exit(0);
    })
    .catch((err) => {
      console.error("Migration failed and was rolled back:", err.message);
      process.exit(1);
    });
}
