/*
 * Release 4 API acceptance pass.
 *   DATABASE_URL=... BASE_URL=http://127.0.0.1:3001 FIXTURE_BASE=http://127.0.0.1:8080/fixtures/r4 \
 *   STAFF_USERNAME=... STAFF_PASSWORD=... node tests/r4-api.js
 *
 * Covers staff authorization, the four website-import fixtures (R4.07-R4.12),
 * partner records and collaboration visibility (R4.13-R4.18), and the student
 * verification and partner request flows (R4.04-R4.06, R4.19-R4.22).
 * Rows it creates are prefixed t4_ or named "T4 ...". The import fixtures must
 * be reachable from the backend; locally that needs ALLOW_PRIVATE_IMPORT=true.
 * Run it against a LOCAL test database only: it deletes partners that carry the
 * fixture names, which would remove real evidence from the deployed database.
 */
const fs = require("fs");
const path = require("path");
const { pool } = require("../backend/db");

const BASE = (process.env.BASE_URL || "http://127.0.0.1:3001").replace(/\/+$/, "");
const FIXTURES = (process.env.FIXTURE_BASE || "http://127.0.0.1:8080/fixtures/r4").replace(/\/+$/, "");
const STAFF_USER = process.env.STAFF_USERNAME || "staff.tester";
const STAFF_PASS = process.env.STAFF_PASSWORD || "local-test-pass-123";
const expected = JSON.parse(
  fs.readFileSync(path.join(__dirname, "../backend/data/r4/expected_company_imports.json"), "utf8")
);

const results = [];
let failures = 0;
function check(name, ok, detail = "") {
  if (!ok) failures += 1;
  results.push(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? " — " + detail : ""}`);
}

async function api(method, p, { sid, body } = {}) {
  const res = await fetch(`${BASE}${p}`, {
    method,
    headers: { "Content-Type": "application/json", ...(sid ? { Cookie: `sid=${sid}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let json = null;
  try {
    json = await res.json();
  } catch {
    /* empty */
  }
  return { status: res.status, body: json, headers: res.headers };
}

async function seedStudent(key, name) {
  const userId = `t4_user_${key}`;
  const studentId = `t4_stu_${key}`;
  const sid = `t4_sid_${key}`;
  await pool.query(
    `INSERT INTO users (id, github_user_id, github_login, algoma_email, verified_at)
     VALUES ($1,$2,$3,$4,NOW()) ON CONFLICT (id) DO UPDATE SET verified_at = NOW()`,
    [userId, 940000 + key.charCodeAt(0), `t4-${key}`, `t4-${key}@algomau.ca`]
  );
  await pool.query(
    `INSERT INTO students (id, name, status, profile_status, user_id)
     VALUES ($1,$2,'current','published',$3)
     ON CONFLICT (id) DO UPDATE SET user_id = EXCLUDED.user_id, profile_status = 'published'`,
    [studentId, name, userId]
  );
  await pool.query(
    `INSERT INTO sessions (id, user_id, expires_at) VALUES ($1,$2,NOW() + INTERVAL '1 day')
     ON CONFLICT (id) DO UPDATE SET expires_at = NOW() + INTERVAL '1 day'`,
    [sid, userId]
  );
  return { sid, studentId };
}

/** Removes only what an earlier run of this file created, so runs repeat. */
async function reset() {
  const fixtureNames = Object.values(expected).map((e) => e.name);
  await pool.query(
    "DELETE FROM companies WHERE created_by = $1 AND (name LIKE 'T4 %' OR name = ANY($2))",
    [STAFF_USER, fixtureNames]
  );
  await pool.query("DELETE FROM company_imports WHERE imported_by = $1 AND company_id IS NULL", [STAFF_USER]);
  await pool.query("DELETE FROM projects WHERE maintainer_student_id LIKE 't4\\_%'");
  await pool.query("DELETE FROM sessions WHERE id LIKE 't4\\_%'");
  await pool.query("DELETE FROM students WHERE id LIKE 't4\\_%'");
  await pool.query("DELETE FROM users WHERE id LIKE 't4\\_%'");
}

function cookieSid(res) {
  const m = (res.headers.get("set-cookie") || "").match(/sid=([^;]+)/);
  return m && m[1];
}

(async () => {
  await reset();
  const a = await seedStudent("a", "T4 Maintainer");
  const b = await seedStudent("b", "T4 Teammate");

  // --- R4.01-R4.03 staff sign-in and authorization ---------------------------------
  const bad = await api("POST", "/auth/staff/login", { body: { username: STAFF_USER, password: "wrong-password-x" } });
  check("R4.01 wrong staff password is refused", bad.status === 401, `status ${bad.status}`);
  const login = await api("POST", "/auth/staff/login", { body: { username: STAFF_USER, password: STAFF_PASS } });
  const staff = cookieSid(login);
  check("R4.01 staff sign-in succeeds", login.status === 200 && Boolean(staff), `status ${login.status}`);
  const me = await api("GET", "/api/me", { sid: staff });
  check("R4.02 /api/me reports the staff role", me.body && me.body.role === "staff");
  const meStudent = await api("GET", "/api/me", { sid: a.sid });
  check("R4.02 a student session reports the student role", meStudent.body && meStudent.body.role === "student");

  const staffRoutes = [
    ["GET", "/api/staff/queue"],
    ["GET", "/api/staff/options"],
    ["GET", "/api/staff/companies"],
    ["POST", "/api/staff/companies", { name: "T4 Sneaky" }],
    ["POST", "/api/staff/companies/import", { url: `${FIXTURES}/company_normal.html` }],
    ["POST", "/api/staff/verifications/none/decision", { decision: "approve" }],
    ["POST", "/api/staff/partner-requests/none/decision", { decision: "approve" }],
  ];
  for (const [m, p, body] of staffRoutes) {
    const anon = await api(m, p, { body });
    const stu = await api(m, p, { sid: a.sid, body });
    check(`R4.02 ${m} ${p} refuses anonymous (401) and students (403)`, anon.status === 401 && stu.status === 403, `${anon.status}/${stu.status}`);
  }

  // --- R4.07-R4.12 website import ------------------------------------------------------
  const imported = {};
  for (const [file, want] of Object.entries(expected)) {
    const r = await api("POST", "/api/staff/companies/import", { sid: staff, body: { url: `${FIXTURES}/${file}` } });
    imported[file] = r.body || {};
    const cand = (r.body && r.body.candidate) || {};
    check(`R4.08 import ${file} returns a candidate`, r.status === 200 && Boolean(r.body && r.body.candidate), `status ${r.status}`);
    check(`R4.08 ${file} name`, cand.name === want.name, `got ${JSON.stringify(cand.name)}`);
    if (want.location) check(`R4.08 ${file} location`, cand.location === want.location, `got ${JSON.stringify(cand.location)}`);
    if (want.keywords) {
      check(`R4.08 ${file} keywords`, want.keywords.every((k) => (cand.keywords || []).includes(k)), `got ${JSON.stringify(cand.keywords)}`);
    }
  }
  const inj = imported["company_prompt_injection.html"];
  check("R4.10 instruction-like text is flagged", Array.isArray(inj.flagged_text) && inj.flagged_text.length > 0);
  const injFields = JSON.stringify(inj.candidate || {});
  check(
    "R4.10 flagged text is not copied into any field",
    inj.flagged_text.every((t) => !injFields.includes(t)) && !/ignore (all )?previous|grant admin|mark .*verified/i.test(injFields),
    injFields.slice(0, 160)
  );
  const sparse = imported["company_sparse.html"];
  check("R4.11 sparse import lists missing fields", Array.isArray(sparse.missing) && sparse.missing.length > 0, JSON.stringify(sparse.missing));

  const failed = await api("POST", "/api/staff/companies/import", { sid: staff, body: { url: "http://nonexistent.invalid/" } });
  check("R4.11 unreachable site gives a manual fallback", failed.status === 422 && failed.body && failed.body.fallback === "manual", `status ${failed.status}`);
  const badScheme = await api("POST", "/api/staff/companies/import", { sid: staff, body: { url: "file:///etc/passwd" } });
  check("R4.10 non-http import URL is refused", [400, 422].includes(badScheme.status), `status ${badScheme.status}`);
  const afterImport = await api("GET", "/api/staff/companies", { sid: staff });
  check("R4.09 an import alone creates no partner", !afterImport.body.some((c) => c.name === "North Shore Simulations"));

  const normal = imported["company_normal.html"];
  const saved = await api("POST", "/api/staff/companies", { sid: staff, body: { ...normal.candidate, import_id: normal.import_id } });
  check("R4.09 saving an import makes a DRAFT", saved.status === 201 && saved.body.status === "draft", `status ${saved.status}`);
  const company = saved.body;
  check("R4.12 imported fields record their source", Boolean(company.field_sources && company.field_sources.name && company.field_sources.name.source === "import"));

  const injSaved = await api("POST", "/api/staff/companies", { sid: staff, body: { ...inj.candidate, import_id: inj.import_id, confirm_new: true } });
  check("R4.10 injection page saves only as a draft", injSaved.status === 201 && injSaved.body.status === "draft", `status ${injSaved.status}`);
  check("R4.10 injection page is not verified or published", injSaved.body.published_at == null);
  const publicList0 = await api("GET", "/api/partners");
  check("R4.09 drafts are not public", !publicList0.body.some((c) => c.id === company.id || c.id === injSaved.body.id));

  const other = imported["company_same_name_other_domain.html"];
  const otherSaved = await api("POST", "/api/staff/companies", { sid: staff, body: { ...other.candidate, import_id: other.import_id } });
  check("R4.13 a similar name on another domain is not merged or blocked", otherSaved.status === 201 && otherSaved.body.id !== company.id, `status ${otherSaved.status}`);
  const dup = await api("POST", "/api/staff/companies", { sid: staff, body: { name: "T4 Copy", website: company.website } });
  check("R4.13 the same website domain asks for confirmation", dup.status === 409 && dup.body.duplicates.some((d) => d.id === company.id), `status ${dup.status}`);

  const edited = await api("PUT", `/api/staff/companies/${company.id}`, { sid: staff, body: { ...normal.candidate, description: "T4 edited description by staff." } });
  check(
    "R4.12 a staff edit is recorded as staff, imported fields stay imported",
    edited.status === 200 && edited.body.field_sources.description.source === "staff" && edited.body.field_sources.name.source === "import",
    `status ${edited.status}`
  );
  const refresh = await api("POST", "/api/staff/companies/import", { sid: staff, body: { url: `${FIXTURES}/company_normal.html`, company_id: company.id } });
  const afterRefresh = await api("GET", `/api/staff/companies/${company.id}`, { sid: staff });
  check("R4.11 re-importing does not overwrite saved fields", refresh.status === 200 && afterRefresh.body.description === "T4 edited description by staff.");

  // --- R4.14-R4.18 publish and collaborations -------------------------------------------
  const pubR = await api("POST", `/api/staff/companies/${company.id}/publish`, { sid: staff, body: { publish: true } });
  check("R4.14 staff can publish a partner", pubR.status === 200, `status ${pubR.status}`);

  const created = await api("POST", "/api/my/projects", {
    sid: a.sid,
    body: { title: "T4 Partner Project", description: "Synthetic R4 project.", domain: "XR / Immersive", technologies: ["Unity"], role: "XR Developer" },
  });
  const project = created.body;
  await api("POST", `/api/my/projects/${project.id}/publish`, { sid: a.sid });

  const mk = (body) => api("POST", `/api/staff/companies/${company.id}/collaborations`, { sid: staff, body });
  const past = await mk({ title: "T4 Past Work", start_year: 2025, status: "past", visibility: "public", description: "Safety training prototype.", project_ids: [project.id], student_ids: [a.studentId] });
  check("R4.15 add a past public collaboration", [200, 201].includes(past.status), `status ${past.status}`);
  const current = await mk({ title: "T4 Current Work", start_year: 2026, status: "current", visibility: "public", description: "Maintenance study." });
  check("R4.16 add a current collaboration", [200, 201].includes(current.status), `status ${current.status}`);
  const limitedNoSummary = await mk({ title: "T4 Limited", start_year: 2026, status: "current", visibility: "limited" });
  check("R4.17 limited visibility requires a public summary", limitedNoSummary.status === 400, `status ${limitedNoSummary.status}`);
  await mk({ title: "T4 Secret Limited Title", start_year: 2026, status: "current", visibility: "limited", public_summary: "T4 confidential prototype", description: "T4 hidden detail" });
  await mk({ title: "T4 Private Work", start_year: 2026, status: "current", visibility: "private", description: "T4 private detail" });
  const badYears = await mk({ title: "T4 Bad Years", start_year: 2027, end_year: 2025, status: "past", visibility: "public" });
  check("R4.15 end year before start year is refused", badYears.status === 400, `status ${badYears.status}`);

  const pubDetail = await api("GET", `/api/partners/${company.id}`);
  const text = JSON.stringify(pubDetail.body);
  check("R4.18 public partner page shows public collaborations", pubDetail.status === 200 && text.includes("T4 Past Work") && text.includes("T4 Current Work"));
  check("R4.18 private collaborations never reach the public API", !text.includes("T4 Private Work") && !text.includes("T4 private detail"));
  check("R4.18 limited collaborations show only the summary", text.includes("T4 confidential prototype") && !text.includes("T4 Secret Limited Title") && !text.includes("T4 hidden detail"));
  const listed = (await api("GET", "/api/partners")).body.find((c) => c.id === company.id);
  check("R4.16 a partner with current work is listed as current", Boolean(listed) && listed.relationship === "current");
  const draftDetail = await api("GET", `/api/partners/${injSaved.body.id}`);
  check("R4.14 a draft partner page is not public", draftDetail.status === 404, `status ${draftDetail.status}`);

  // --- R4.04-R4.06 verification requests --------------------------------------------------
  const inv = await api("POST", `/api/my/projects/${project.id}/invite`, { sid: a.sid, body: { student_id: b.studentId, role: "3D Artist" } });
  const acc = await api("POST", `/api/my/projects/${project.id}/respond`, { sid: b.sid, body: { accept: true } });
  check("setup: teammate joins the project as a contributor", [200, 201].includes(inv.status) && acc.status === 200, `${inv.status}/${acc.status}`);

  const shortNote = await api("POST", `/api/my/projects/${project.id}/verification-request`, { sid: a.sid, body: { note: "short" } });
  check("R4.04 a verification request needs a reason", shortNote.status === 400, `status ${shortNote.status}`);
  const byContributor = await api("POST", `/api/my/projects/${project.id}/verification-request`, { sid: b.sid, body: { note: "Built for COSC-3506 in Fall 2026." } });
  check("R4.04 only the maintainer can request verification", byContributor.status === 403, `status ${byContributor.status}`);
  const vreq = await api("POST", `/api/my/projects/${project.id}/verification-request`, { sid: a.sid, body: { note: "Built for COSC-3506 in Fall 2026." } });
  check("R4.04 maintainer requests verification", [200, 201].includes(vreq.status), `status ${vreq.status}`);
  const vdup = await api("POST", `/api/my/projects/${project.id}/verification-request`, { sid: a.sid, body: { note: "Built for COSC-3506 in Fall 2026." } });
  check("R4.04 a second pending request is refused", vdup.status === 409, `status ${vdup.status}`);
  let pubProject = await api("GET", `/api/projects/${project.id}`);
  check("R4.06 a request alone does not verify", pubProject.body.verified === false);

  const queue = await api("GET", "/api/staff/queue", { sid: staff });
  const v = queue.body.project_verifications.find((x) => x.project_title === "T4 Partner Project");
  check("R4.03 the request appears in the staff queue", Boolean(v));
  const rejectNoNote = await api("POST", `/api/staff/verifications/${v.id}/decision`, { sid: staff, body: { decision: "reject" } });
  check("R4.05 rejecting needs a note", rejectNoNote.status === 400, `status ${rejectNoNote.status}`);
  const approve = await api("POST", `/api/staff/verifications/${v.id}/decision`, { sid: staff, body: { decision: "approve", note: "Checked with the course." } });
  check("R4.05 staff approve verification", approve.status === 200, `status ${approve.status}`);
  pubProject = await api("GET", `/api/projects/${project.id}`);
  check("R4.06 the public project now shows verified", pubProject.body.verified === true);
  const forContributor = await api("GET", `/api/my/projects/${project.id}/requests`, { sid: b.sid });
  check(
    "R4.04 contributors see the status but are not maintainers",
    forContributor.status === 200 && forContributor.body.verified === true && forContributor.body.is_maintainer === false,
    `status ${forContributor.status}`
  );

  // --- R4.19-R4.22 partner requests ---------------------------------------------------------
  const opts = await api("GET", "/api/companies/options", { sid: a.sid });
  check(
    "R4.19 students can only pick published partners",
    opts.status === 200 && opts.body.some((c) => c.id === company.id) && !opts.body.some((c) => c.id === injSaved.body.id)
  );
  const preq = await api("POST", `/api/my/projects/${project.id}/partner-requests`, { sid: a.sid, body: { company_id: company.id, explanation: "They supplied the training scenario." } });
  check("R4.19 maintainer requests a partner link", [200, 201].includes(preq.status), `status ${preq.status}`);
  const preqDup = await api("POST", `/api/my/projects/${project.id}/partner-requests`, { sid: a.sid, body: { company_id: company.id, explanation: "They supplied the training scenario." } });
  check("R4.19 a duplicate pending partner request is refused", preqDup.status === 409, `status ${preqDup.status}`);
  const byB = await api("POST", `/api/my/projects/${project.id}/partner-requests`, { sid: b.sid, body: { company_id: company.id, explanation: "They supplied the training scenario." } });
  check("R4.19 a non-maintainer cannot request a partner link", byB.status === 403, `status ${byB.status}`);
  const suggest = await api("POST", `/api/my/projects/${project.id}/partner-requests`, { sid: a.sid, body: { suggested_name: "T4 Suggested Co", suggested_website: "https://t4-suggested.example", explanation: "A local studio we demoed for." } });
  check("R4.20 maintainer can suggest a company not yet listed", [200, 201].includes(suggest.status), `status ${suggest.status}`);
  pubProject = await api("GET", `/api/projects/${project.id}`);
  check("R4.21 nothing is public before staff approve", (pubProject.body.partners || []).length === 0);

  const pending = (await api("GET", "/api/staff/queue", { sid: staff })).body.partner_requests.filter((r) => r.project_title === "T4 Partner Project");
  const existing = pending.find((r) => r.existing_company);
  const suggested = pending.find((r) => !r.existing_company);
  check("R4.21 both requests reach the staff queue", Boolean(existing && suggested));
  const ap = await api("POST", `/api/staff/partner-requests/${existing.id}/decision`, { sid: staff, body: { decision: "approve", company_id: company.id } });
  check("R4.21 staff approve the partner link", ap.status === 200, `status ${ap.status}`);
  const rj = await api("POST", `/api/staff/partner-requests/${suggested.id}/decision`, { sid: staff, body: { decision: "reject", note: "We could not confirm this company." } });
  check("R4.21 staff can reject with a note", rj.status === 200, `status ${rj.status}`);
  pubProject = await api("GET", `/api/projects/${project.id}`);
  check("R4.22 the approved partner shows on the project page", (pubProject.body.partners || []).some((c) => c.id === company.id));
  check("R4.22 the rejected suggestion does not", !(pubProject.body.partners || []).some((c) => c.name === "T4 Suggested Co"));
  const partnerPage = await api("GET", `/api/partners/${company.id}`);
  check("R4.22 the partner page lists the project", JSON.stringify(partnerPage.body).includes(project.id));

  // --- R4.24 inquiry from a partner page -------------------------------------------------------
  const inq = await api("POST", "/api/inquiries", {
    body: {
      source_type: "partner", source_id: company.id, source_name: company.name, source_url: "https://example.test/partner.html",
      company_name: "T4 Employer", contact_name: "T4 Contact", contact_email: "t4@example.test", description: "Interested in similar work.",
    },
  });
  check("R4.24 an inquiry can start from a partner page", [200, 201].includes(inq.status), `status ${inq.status}`);
  await pool.query("DELETE FROM inquiries WHERE company_name = 'T4 Employer'");

  await reset(); // leave the directory exactly as the R1 fixtures expect
  console.log(results.join("\n"));
  console.log(`\n${results.length - failures}/${results.length} passed`);
  await pool.end();
  process.exit(failures ? 1 : 0);
})().catch(async (err) => {
  console.error(results.join("\n"));
  console.error("CRASH", err);
  await pool.end().catch(() => {});
  process.exit(1);
});
