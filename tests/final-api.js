/**
 * Final Release API checks (F.01 - F.32), against a LOCAL backend and database.
 *
 *   DATABASE_URL=... BASE_URL=http://127.0.0.1:3001 \
 *   STAFF_USERNAME=... STAFF_PASSWORD=... node tests/final-api.js
 *
 * Use a fresh database: this file imports the legacy fixture and a generated
 * 220-student scale dataset, merges records and archives the scale batch.
 */
const fs = require("fs");
const path = require("path");
const { pool } = require("../backend/db");

const BASE = (process.env.BASE_URL || "http://127.0.0.1:3001").replace(/\/+$/, "");
const STAFF_USER = process.env.STAFF_USERNAME || "staff.tester";
const STAFF_PASS = process.env.STAFF_PASSWORD || "local-test-pass-123";
const FIX = path.join(__dirname, "fixtures", "final");
const legacy = JSON.parse(fs.readFileSync(path.join(FIX, "legacy_export.json"), "utf8"));
const expected = JSON.parse(fs.readFileSync(path.join(FIX, "legacy_expected_results.json"), "utf8"));

let failures = 0;
let total = 0;
function check(name, ok, detail = "") {
  total += 1;
  if (!ok) failures += 1;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? " — " + detail : ""}`);
}

async function api(method, p, { sid, body } = {}) {
  const res = await fetch(`${BASE}${p}`, {
    method,
    headers: { "Content-Type": "application/json", ...(sid ? { Cookie: `sid=${sid}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* not JSON */
  }
  return { status: res.status, body: json, text, headers: res.headers };
}

/** A verified student account with a session, optionally with a profile. */
async function seedUser(key, { email, login, profile } = {}) {
  const userId = `tf_user_${key}`;
  const sid = `tf_sid_${key}`;
  await pool.query(
    `INSERT INTO users (id, github_user_id, github_login, algoma_email, verified_at)
     VALUES ($1,$2,$3,$4,NOW() - INTERVAL '400 days') ON CONFLICT (id) DO NOTHING`,
    [userId, 970000 + Math.floor(Math.random() * 20000), login || `tf-${key}`, email || `tf-${key}@algomau.ca`]
  );
  await pool.query(
    "INSERT INTO sessions (id, user_id, expires_at) VALUES ($1,$2,NOW() + INTERVAL '1 day') ON CONFLICT (id) DO NOTHING",
    [sid, userId]
  );
  if (profile) {
    await pool.query(
      `INSERT INTO students (id, name, headline, status, profile_status, user_id)
       VALUES ($1,$2,'Test headline','current','published',$3) ON CONFLICT (id) DO NOTHING`,
      [`tf_stu_${key}`, profile, userId]
    );
  }
  return { sid, userId, studentId: profile ? `tf_stu_${key}` : null };
}

/** The supplied scale fixture (F.27), checked in unchanged. */
function scaleDataset() {
  return JSON.parse(fs.readFileSync(path.join(FIX, "scale_fixture.json"), "utf8"));
}

async function legacyId(kind, lid) {
  const r = await pool.query("SELECT internal_id FROM legacy_ids WHERE kind = $1 AND legacy_id = $2", [kind, lid]);
  return r.rows[0] && r.rows[0].internal_id;
}

(async () => {
  try {
    const login = await fetch(`${BASE}/auth/staff/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: STAFF_USER, password: STAFF_PASS }),
    });
    const staff = (login.headers.get("set-cookie") || "").match(/sid=([^;]+)/)[1];
    const student = await seedUser("plain", { profile: "Plain Student" });

    // ---- F.21 authorization on the new staff routes -----------------------
    for (const [m, p] of [
      ["POST", "/api/staff/migrations"],
      ["GET", "/api/staff/claims"],
      ["POST", "/api/staff/students/merge"],
      ["POST", "/api/staff/projects/x/maintainer"],
      ["GET", "/api/staff/diagnostics"],
      ["POST", "/api/staff/students/x/status"],
    ]) {
      const body = m === "GET" ? undefined : {};
      const anon = await api(m, p, { body });
      const stu = await api(m, p, { sid: student.sid, body });
      check(`F.21 ${m} ${p} refuses anonymous (401) and students (403)`, anon.status === 401 && stu.status === 403, `${anon.status}/${stu.status}`);
    }

    // Directory payload size before any bulk import (F.28 baseline).
    const before = await api("GET", "/api/students");
    const sizeBefore = before.text.length;

    // ---- F.01 - F.03 legacy import ------------------------------------------
    const run1 = await api("POST", "/api/staff/migrations", { sid: staff, body: { data: legacy, source_name: "legacy_export.json" } });
    const r1 = run1.body || {};
    check("F.01 staff can import the legacy export", run1.status === 201, `status ${run1.status}`);
    check("F.03 source counts match expected", JSON.stringify(r1.source_counts) === JSON.stringify(expected.source_counts), JSON.stringify(r1.source_counts));
    check("F.03 duplicate LS04 -> LS01 (same email) is reported",
      JSON.stringify(r1.duplicate_student_candidates) === JSON.stringify(expected.duplicate_student_candidates));
    check("F.03 broken reference LP02/LS99 is reported", JSON.stringify(r1.broken_references) === JSON.stringify(expected.broken_references));
    check("F.07 unclaimed profiles are LS02, LS05, LS06", JSON.stringify(r1.unclaimed_profiles) === JSON.stringify(expected.unclaimed_profiles));
    check("F.01 first run creates 6/3/3/4",
      r1.students.created === 6 && r1.projects.created === 3 && r1.companies.created === 3 && r1.collaborations.created === 4);

    const run2 = await api("POST", "/api/staff/migrations", { sid: staff, body: { data: legacy, source_name: "legacy_export.json" } });
    const r2 = run2.body || {};
    check("F.02 re-import creates nothing and skips everything",
      ["students", "projects", "companies", "collaborations"].every((k) => r2[k].created === 0 && r2[k].skipped === legacy[k].length),
      JSON.stringify({ s: r2.students, p: r2.projects }));
    const counts = await pool.query(
      "SELECT COUNT(*)::int AS n FROM students WHERE name IN ('Avery Chen','Daniel Kim','Maya Patel','Avery C.','Unclaimed Alum','Retired Contributor') AND import_run_id IS NOT NULL"
    );
    check("F.02 still exactly six imported students after two runs", counts.rows[0].n === 6, `${counts.rows[0].n}`);
    const history = await api("GET", "/api/staff/migrations", { sid: staff });
    check("F.02 both runs are kept in the migration history", Array.isArray(history.body) && history.body.length >= 2);

    // ---- F.04 shared project, F.06 stable ids -------------------------------
    const lp01 = await legacyId("project", "LP01");
    const proj = await api("GET", `/api/projects/${lp01}`);
    const names = (proj.body.contributors || []).map((c) => c.name).sort();
    check("F.04 XR Anatomy Lab is one project with both contributors", names.join(",") === "Avery Chen,Daniel Kim", names.join(","));
    check("F.04 legacy roles survive", (proj.body.contributors || []).some((c) => c.role === "Interaction Developer"));
    const lp01Count = await pool.query("SELECT COUNT(*)::int AS n FROM projects WHERE title = 'XR Anatomy Lab' AND import_run_id IS NOT NULL");
    check("F.04 the shared project was imported once", lp01Count.rows[0].n === 1);
    check("F.03 a same-titled Release 1 project is reported, not merged silently",
      (r1.possible_existing_matches || []).some((x) => x.kind === "project" && x.legacy_id === "LP01"));
    check("F.06 internal ids are not the legacy ids or names", /^proj_[0-9a-f]{24}$/.test(lp01));

    // ---- F.05, F.20 partner history and private collaboration ---------------
    const lc01 = await legacyId("company", "LC01");
    const lc02 = await legacyId("company", "LC02");
    const lc03 = await legacyId("company", "LC03");
    const p1 = await api("GET", `/api/partners/${lc01}`);
    check("F.05 LC01 keeps a past and a current collaboration", /Industrial Safety Training/.test(p1.text) && /XR Maintenance Study/.test(p1.text));
    const p3 = await api("GET", `/api/partners/${lc03}`);
    check("F.20 the private collaboration is absent from the public partner response", p3.status === 200 && !/Confidential Prototype/.test(p3.text));
    const pub = await api("GET", `/api/projects/${await legacyId("project", "LP02")}`);
    check("F.20 the project of a private collaboration does not list that partner", !(pub.body.partners || []).some((x) => x.id === lc03));

    // ---- F.07, F.13, F.14, F.15, F.16 ---------------------------------------
    const ls05 = await legacyId("student", "LS05");
    const unclaimed = await api("GET", `/api/students/${ls05}`);
    check("F.07 an unclaimed imported profile is publicly visible", unclaimed.status === 200 && unclaimed.body.name === "Unclaimed Alum");
    const ls01 = await legacyId("student", "LS01");
    const avery = await api("GET", `/api/students/${ls01}`);
    check("F.20 the legacy email is never in a public response", !/algoma\.example/.test(avery.text) && !("legacy_email" in avery.body));
    const ls02 = await legacyId("student", "LS02");
    const daniel = await api("GET", `/api/students/${ls02}`);
    check("F.14 availability confirmed in 2024 is shown as needing reconfirmation",
      daniel.body.talent_state === "needs_reconfirmation" && daniel.body.availability.length === 0, daniel.body.talent_state);
    const ft = await api("GET", "/api/students?availability=full-time&limit=100");
    check("F.14 stale availability is not matched by the availability filter", !ft.body.some((s) => s.id === ls02));
    const intern = await api("GET", "/api/students?availability=internship&limit=100");
    check("F.13 fresh Active Talent still matches the availability filter", intern.body.some((s) => s.id === ls01));
    check("F.13 Showcase Only profiles never match an availability filter", intern.body.every((s) => s.availability_mode === "active"));
    const ls06 = await legacyId("student", "LS06");
    const retired = await api("GET", `/api/students/${ls06}`);
    check("F.15 a retired profile's URL explains it is archived (410)", retired.status === 410 && retired.body.retired === true);
    const lp03 = await api("GET", `/api/projects/${await legacyId("project", "LP03")}`);
    const rc = (lp03.body.contributors || []).find((c) => c.name === "Retired Contributor");
    check("F.16 the shared project still credits the retired contributor, without a profile link", rc && rc.profile_public === false);

    // ---- F.08 - F.10 claims ---------------------------------------------------
    const alice = await seedUser("alice", { email: "alice@algomau.ca" });
    const maya = await seedUser("maya", { email: "maya.patel@algoma.example" });
    const lookalike = await seedUser("look", { email: "someone@algomau.ca", login: "avery-chen" });
    const ls03 = await legacyId("student", "LS03");

    const cand = await api("GET", "/api/claims/candidates?q=Avery", { sid: alice.sid });
    check("F.08 verified users can find unclaimed profiles (no email in results)",
      cand.status === 200 && cand.body.length >= 1 && !/algoma\.example/.test(cand.text));
    const auto = await api("POST", "/api/claims", { sid: maya.sid, body: { student_id: ls03, note: "This is me" } });
    check("F.08 matching verified email is approved automatically", auto.status === 201 && auto.body.claim_status === "approved", JSON.stringify(auto.body));
    const mayaProfile = await api("GET", "/api/profile", { sid: maya.sid });
    check("F.08 the claimant now owns the profile", mayaProfile.status === 200 && mayaProfile.body.id === ls03);
    const look = await api("POST", "/api/claims", { sid: lookalike.sid, body: { student_id: ls01, note: "my GitHub is avery-chen" } });
    check("F.09 a matching GitHub name only creates a pending claim", look.status === 201 && look.body.claim_status === "pending");
    const lookProfile = await api("GET", "/api/profile", { sid: lookalike.sid });
    check("F.09 the pending claim grants no ownership", lookProfile.status === 404);
    const ali = await api("POST", "/api/claims", { sid: alice.sid, body: { student_id: ls02, note: "I am Daniel's new account" } });
    check("F.09 holding an Algoma address is not enough (pending)", ali.body.claim_status === "pending");
    const again = await api("POST", "/api/claims", { sid: alice.sid, body: { student_id: ls02 } });
    check("F.08 a second pending claim on the same profile is refused", again.status === 409);
    const taken = await api("POST", "/api/claims", { sid: alice.sid, body: { student_id: ls03 } });
    check("F.09 an owned profile cannot be claimed", taken.status === 409);

    const queue = await api("GET", "/api/staff/claims", { sid: staff });
    const lookClaim = queue.body.find((c) => c.user_id === lookalike.userId);
    const aliClaim = queue.body.find((c) => c.user_id === alice.userId);
    check("F.10 staff see pending claims with the legacy email", lookClaim && lookClaim.legacy_email === "avery.chen@algoma.example");
    const noNote = await api("POST", `/api/staff/claims/${lookClaim.id}/decision`, { sid: staff, body: { decision: "reject" } });
    check("F.10 a rejection needs a note", noNote.status === 400);
    const rej = await api("POST", `/api/staff/claims/${lookClaim.id}/decision`, { sid: staff, body: { decision: "reject", note: "Email does not match" } });
    check("F.10 staff can reject an ambiguous claim", rej.status === 200 && rej.body.claim_status === "rejected");
    const appr = await api("POST", `/api/staff/claims/${aliClaim.id}/decision`, { sid: staff, body: { decision: "approve", note: "Confirmed by phone" } });
    check("F.10 staff can approve a claim", appr.status === 200);
    const aliProfile = await api("GET", "/api/profile", { sid: alice.sid });
    check("F.10 the approved claimant owns the profile", aliProfile.body && aliProfile.body.id === ls02);
    const mine = await api("GET", "/api/claims/mine", { sid: lookalike.sid });
    check("F.10 the claimant sees the decision and note", mine.body[0].status === "rejected" && mine.body[0].decision_note === "Email does not match");

    // Owner recovery (F.10): move LS05 to the look-alike user, then clear it.
    const rec = await api("POST", `/api/staff/students/${ls05}/owner`, { sid: staff, body: { user: "avery-chen", note: "Recovered after ID check" } });
    check("F.10 staff can assign an owner", rec.status === 200);
    const clr = await api("POST", `/api/staff/students/${ls05}/owner`, { sid: staff, body: { clear: true, note: "Assigned in error" } });
    check("F.10 staff can clear an owner", clr.status === 200);

    // ---- F.11, F.12 alumni ------------------------------------------------------
    const st = await api("POST", `/api/staff/students/${ls03}/status`, { sid: staff, body: { status: "alumni" } });
    check("F.11 staff change status to alumni without unpublishing", st.status === 200 && st.body.status === "alumni" && st.body.profile_status === "published");
    const mayaPub = await api("GET", `/api/students/${ls03}`);
    check("F.11 the alumni portfolio is still public", mayaPub.status === 200 && mayaPub.body.status === "alumni");
    const mayaSave = await api("PUT", "/api/profile", { sid: maya.sid, body: { ...mayaProfile.body, status: "alumni", headline: "Alumna 3D artist" } });
    check("F.12 a 400-day-old verification still allows alumni edits", mayaSave.status === 200);

    // ---- F.13 Active vs Showcase, reconfirm -------------------------------------
    const show = await api("PUT", "/api/profile", { sid: alice.sid, body: { ...aliProfile.body, headline: "Alumni developer", availability_mode: "showcase" } });
    check("F.13 owner can switch to Showcase Only", show.body.availability_mode === "showcase" && show.body.talent_state === "showcase");
    const act = await api("PUT", "/api/profile", { sid: alice.sid, body: { ...show.body, availability_mode: "active", confirm_availability: true } });
    check("F.14 reconfirming makes the profile current Active Talent", act.body.talent_state === "active", act.body.talent_state);

    // ---- F.17, F.18 merges ------------------------------------------------------
    const ls04 = await legacyId("student", "LS04");
    const bad = await api("POST", "/api/staff/students/merge", { sid: staff, body: { from_id: ls02, into_id: ls03 } });
    check("F.17 merging two profiles with different owners is refused", bad.status === 409);
    const m = await api("POST", "/api/staff/students/merge", { sid: staff, body: { from_id: ls04, into_id: ls01, note: "Same email" } });
    check("F.17 staff merge the duplicate LS04 into LS01", m.status === 200, JSON.stringify(m.body));
    const old = await api("GET", `/api/students/${ls04}`);
    check("F.18 the merged profile's old URL names the surviving record", old.status === 410 && old.body.merged_into === ls01);
    const re = await api("POST", "/api/staff/migrations", { sid: staff, body: { data: legacy, source_name: "legacy_export.json" } });
    check("F.02 re-import after a merge does not resurrect the duplicate", re.body.students.created === 0);
    const cm = await api("POST", "/api/staff/companies/merge", { sid: staff, body: { from_id: lc02, into_id: lc01, note: "Same domain" } });
    check("F.17 staff merge the duplicate company", cm.status === 200 && cm.body.collaborations_moved === 1, JSON.stringify(cm.body));
    const oldCo = await api("GET", `/api/partners/${lc02}`);
    check("F.18 the merged partner's old URL points to the survivor", oldCo.status === 410 && oldCo.body.merged_into === lc01);
    const lc01After = await api("GET", `/api/partners/${lc01}`);
    check("F.17 the moved collaboration now appears on the survivor", /Legacy Brand Event/.test(lc01After.text));
    const dangling = await pool.query("SELECT COUNT(*)::int AS n FROM collaborations WHERE company_id = $1", [lc02]);
    check("F.17 no collaboration is left on the merged company", dangling.rows[0].n === 0);

    // ---- F.19 maintainer recovery ---------------------------------------------
    const noMember = await api("POST", `/api/staff/projects/${lp01}/maintainer`, { sid: staff, body: { student_id: ls03, note: "x" } });
    check("F.19 a non-contributor cannot become maintainer", noMember.status === 400);
    const mt = await api("POST", `/api/staff/projects/${lp01}/maintainer`, { sid: staff, body: { student_id: ls02, note: "Original maintainer unavailable" } });
    check("F.19 staff assign a new maintainer", mt.status === 200);
    const after = await api("GET", `/api/projects/${lp01}`);
    check("F.19 same project URL, contributors unchanged, new maintainer flagged",
      after.status === 200 && after.body.contributors.length === 2 && after.body.contributors.find((c) => c.is_maintainer).student_id === ls02);

    // ---- F.37 demo state (new maintainer) ----------------------------------------
    const ed = await api("GET", `/api/my/projects/${lp01}`, { sid: alice.sid });
    const demo = await api("PUT", `/api/my/projects/${lp01}`, {
      sid: alice.sid,
      body: { ...ed.body, version: ed.body.version, demo_status: "unavailable", demo_status_note: "Build is being rebuilt" },
    });
    check("F.37 the maintainer marks the demo unavailable", demo.status === 200 && demo.body.demo_status === "unavailable", `${demo.status}`);
    const pubDemo = await api("GET", `/api/projects/${lp01}`);
    check("F.37 the public project shows the demo state and keeps its history",
      pubDemo.body.demo_status === "unavailable" && pubDemo.body.contributors.length === 2);

    // ---- F.15, F.16 owner retires and restores ---------------------------------
    const ret = await api("POST", "/api/profile/retire", { sid: alice.sid });
    check("F.15 the owner can retire their profile", ret.status === 200 && ret.body.profile_status === "retired");
    const shared = await api("GET", `/api/projects/${lp01}`);
    check("F.16 the shared project still lists the retired contributor", shared.body.contributors.some((c) => c.student_id === ls02 && !c.profile_public));
    const restore = await api("POST", "/api/profile/publish", { sid: alice.sid });
    check("F.15 restoring publishes the profile again", restore.status === 200 && (await api("GET", `/api/students/${ls02}`)).status === 200);

    // ---- F.27, F.28 scale ---------------------------------------------------------
    const scale = await api("POST", "/api/staff/migrations", { sid: staff, body: { data: scaleDataset(), source_name: "scale_fixture.json" } });
    check("F.27 the scale dataset goes through the same import route",
      scale.status === 201 && scale.body.students.created === 220 && scale.body.projects.created === 110, JSON.stringify(scale.body && scale.body.students));
    const dir = await api("GET", "/api/students");
    const totalCount = Number(dir.headers.get("x-total-count"));
    check("F.28 the first directory page has at most 24 students", dir.body.length === 24, `${dir.body.length}`);
    check("F.28 the total is reported separately", totalCount >= 200, `${totalCount}`);
    check("F.28 the first load is about the same size as with 20 students", dir.text.length < sizeBefore * 2, `${sizeBefore} -> ${dir.text.length} bytes`);
    check("F.28 the directory response carries no resume or media URLs", !/\.pdf|playable_url|video_url/.test(dir.text));
    const page2 = await api("GET", "/api/students?offset=24");
    check("F.28 the next page continues without overlap", page2.body.length === 24 && !page2.body.some((s) => dir.body.some((d) => d.id === s.id)));
    const filtered = await api("GET", "/api/students?skill=Blender&availability=contract&limit=100");
    check("F.27 filters use the imported structured skills", filtered.body.length > 0 && filtered.body.every((s) => s.skills.includes("Blender")));
    const scale2 = await api("POST", "/api/staff/migrations", { sid: staff, body: { data: scaleDataset(), source_name: "scale_fixture.json" } });
    check("F.02 re-importing the scale dataset creates nothing", scale2.body.students.created === 0 && scale2.body.projects.created === 0);

    // ---- F.32 diagnostics --------------------------------------------------------
    await api("POST", "/api/staff/companies/import", { sid: staff, body: { url: "https://nonexistent.invalid/" } });
    await new Promise((r) => setTimeout(r, 300));
    const diag = await api("GET", "/api/staff/diagnostics", { sid: staff });
    check("F.32 staff see timestamped ownership/audit events", diag.status === 200 && diag.body.audit.some((e) => e.kind === "student_merge"));
    check("F.32 diagnostics carry no session ids or passwords", !/tf_sid_|local-test-pass/.test(diag.text));

    // ---- batch archive ---------------------------------------------------------
    const arch = await api("POST", `/api/staff/migrations/${scale.body.run_id}/archive`, { sid: staff });
    check("Staff can archive the scale batch without deleting it", arch.status === 200 && arch.body.students_retired === 220);
    const dirAfter = await api("GET", "/api/students");
    check("Archived scale profiles leave the directory", Number(dirAfter.headers.get("x-total-count")) < 50, dirAfter.headers.get("x-total-count"));
    const kept = await pool.query("SELECT COUNT(*)::int AS n FROM students WHERE import_run_id = $1", [scale.body.run_id]);
    check("Archived records still exist", kept.rows[0].n === 220);
  } catch (err) {
    failures += 1;
    console.log("CRASH", err.stack);
  } finally {
    console.log(`\n${total - failures}/${total} passed`);
    await pool.end();
    process.exit(failures ? 1 : 0);
  }
})();
