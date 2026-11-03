/*
 * Release 3 API acceptance pass.
 *   DATABASE_URL=... node tests/r3-api.js
 *
 * Exercises the R3 behaviour that a browser pass cannot reach cheaply:
 * authorization boundaries, the lost-update conflict, invitation visibility,
 * and the duplicate-warning cases from project_duplicate_cases.json.
 *
 * It seeds two synthetic verified students with real database-backed sessions,
 * then drives the deployed route surface over HTTP exactly as the frontend
 * does. Everything it creates is prefixed t3_ so a run is easy to identify.
 */
const { pool } = require("../backend/db");

const BASE = (process.env.BASE_URL || "http://127.0.0.1:3000").replace(/\/+$/, "");
const results = [];
let failures = 0;

function check(name, ok, detail = "") {
  if (!ok) failures += 1;
  results.push(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? " — " + detail : ""}`);
}

/** Creates a verified user, a student row and a live session. Returns the sid. */
async function seedStudent(key, name) {
  const userId = `t3_user_${key}`;
  const studentId = `t3_stu_${key}`;
  const sid = `t3_sid_${key}`;
  await pool.query(
    `INSERT INTO users (id, github_user_id, github_login, algoma_email, verified_at)
     VALUES ($1,$2,$3,$4,NOW())
     ON CONFLICT (id) DO UPDATE SET verified_at = NOW()`,
    [userId, 900000 + key.charCodeAt(0), `t3-${key}`, `t3-${key}@algomau.ca`]
  );
  await pool.query(
    `INSERT INTO students (id, name, status, profile_status, user_id)
     VALUES ($1,$2,'current','published',$3)
     ON CONFLICT (id) DO UPDATE SET user_id = EXCLUDED.user_id, profile_status = 'published'`,
    [studentId, name, userId]
  );
  await pool.query(
    `INSERT INTO sessions (id, user_id, expires_at)
     VALUES ($1,$2,NOW() + INTERVAL '1 day')
     ON CONFLICT (id) DO UPDATE SET expires_at = NOW() + INTERVAL '1 day'`,
    [sid, userId]
  );
  return { sid, studentId, userId, name };
}

async function api(method, path, { sid, body } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(sid ? { Cookie: `sid=${sid}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let json = null;
  try {
    json = await res.json();
  } catch {
    /* some responses are empty */
  }
  return { status: res.status, body: json };
}

/**
 * Removes only what a previous run of THIS file created, so the run is
 * repeatable and the row counts it asserts on are deterministic. Projects are
 * matched by maintainer, not by id prefix, because real student projects share
 * the same id prefix. R1 fixture ids (P01.., S01..) match nothing here.
 */
async function resetOwnFixtures() {
  await pool.query("DELETE FROM projects WHERE maintainer_student_id LIKE 't3\\_%'");
  await pool.query("DELETE FROM sessions WHERE id LIKE 't3\\_%'");
  await pool.query("DELETE FROM students WHERE id LIKE 't3\\_%'");
  await pool.query("DELETE FROM users WHERE id LIKE 't3\\_%'");
}

(async () => {
  await resetOwnFixtures();
  const a = await seedStudent("a", "T3 Maintainer");
  const b = await seedStudent("b", "T3 Teammate");
  const c = await seedStudent("c", "T3 Outsider");

  // --- R3.01, R3.02, R3.06 ------------------------------------------------
  const created = await api("POST", "/api/my/projects", {
    sid: a.sid,
    body: {
      title: "T3 XR Anatomy Lab",
      description: "Synthetic project for the R3 acceptance pass.",
      domain: "XR / Immersive",
      date_text: "Fall 2026",
      technologies: ["Unity", "C#"],
      role: "XR Developer",
      repositories: ["https://github.com/example-org/xr-anatomy"],
    },
  });
  check("R3.01 add project returns 201", created.status === 201, `status ${created.status}`);
  const project = created.body || {};
  check("R3.02 manual fields stored", project.title === "T3 XR Anatomy Lab" && project.technologies.length === 2);
  check("R3.06 creator is maintainer", project.maintainer_student_id === a.studentId);
  check("R3.01 new project starts as a draft", project.project_status === "draft");

  // --- R3.01 drafts are not public ----------------------------------------
  let pub = await api("GET", `/api/projects/${project.id}`);
  check("draft project is not publicly readable", pub.status === 404, `status ${pub.status}`);

  await api("POST", `/api/my/projects/${project.id}/publish`, { sid: a.sid });
  pub = await api("GET", `/api/projects/${project.id}`);
  check("R3.26 published project is public at a stable URL", pub.status === 200);

  // --- R3.16 duplicate cases, straight from the fixture -------------------
  const dupExact = await api(
    "GET",
    `/api/projects/duplicate-check?repository=${encodeURIComponent("https://github.com/example-org/xr-anatomy")}&title=XR%20Anatomy%20Lab`,
    { sid: b.sid }
  );
  check(
    "R3.16 exact_repository_duplicate warns about the existing project",
    dupExact.body && dupExact.body.advice === "warn_existing_project" && dupExact.body.repository_matches.length === 1,
    JSON.stringify(dupExact.body && dupExact.body.advice)
  );

  // Case 2 of the fixture, verbatim. Neither title contains the other, so this
  // is the case that requires token overlap rather than substring matching.
  const dupSimilar = await api(
    "GET",
    "/api/projects/duplicate-check?" +
      new URLSearchParams({
        repository: "https://github.com/example-org/anatomy-learning",
        title: "XR Anatomy Learning Lab",
      }),
    { sid: b.sid }
  );
  check(
    "R3.16 similar_title_different_repository warns but does not merge",
    dupSimilar.body &&
      dupSimilar.body.advice === "warn_if_useful_but_do_not_auto_merge" &&
      dupSimilar.body.repository_matches.length === 0,
    JSON.stringify(dupSimilar.body && dupSimilar.body.advice)
  );

  // Case 3 of the fixture, verbatim: the SAME title as the existing project but
  // a different repository and a different domain. The fixture expects creation
  // to be allowed, so the declared domain has to override title similarity.
  const dupDomain = await api(
    "GET",
    "/api/projects/duplicate-check?" +
      new URLSearchParams({
        repository: "https://github.com/other-org/xr-anatomy-art",
        title: "T3 XR Anatomy Lab",
        domain: "Art / Visualization",
      }),
    { sid: b.sid }
  );
  check(
    "R3.16 same_title_different_domain is allowed as a distinct project",
    dupDomain.body && dupDomain.body.advice === "allow_distinct_project_do_not_auto_merge",
    JSON.stringify(dupDomain.body && dupDomain.body.advice)
  );

  // Same title, same domain, different repository: the warning must stand.
  const dupSameDomain = await api(
    "GET",
    "/api/projects/duplicate-check?" +
      new URLSearchParams({
        repository: "https://github.com/other-org/xr-anatomy-art",
        title: "T3 XR Anatomy Lab",
        domain: "XR / Immersive",
      }),
    { sid: b.sid }
  );
  check(
    "R3.16 same title in the same domain still warns",
    dupSameDomain.body && dupSameDomain.body.advice === "warn_if_useful_but_do_not_auto_merge",
    JSON.stringify(dupSameDomain.body && dupSameDomain.body.advice)
  );

  const dupDistinct = await api(
    "GET",
    "/api/projects/duplicate-check?" +
      new URLSearchParams({
        repository: "https://github.com/other-org/unrelated-thing",
        title: "Quietly Unrelated Rowing Tracker",
      }),
    { sid: b.sid }
  );
  check(
    "R3.16 unrelated project is allowed",
    dupDistinct.body && dupDistinct.body.advice === "allow_distinct_project_do_not_auto_merge",
    JSON.stringify(dupDistinct.body && dupDistinct.body.advice)
  );

  // Same repo written three ways must collapse to one warning.
  const dupVariants = await Promise.all(
    [
      "https://www.github.com/Example-Org/XR-Anatomy/",
      "https://github.com/example-org/xr-anatomy.git",
      "http://github.com/EXAMPLE-ORG/xr-anatomy",
    ].map((u) =>
      api("GET", `/api/projects/duplicate-check?repository=${encodeURIComponent(u)}`, { sid: b.sid })
    )
  );
  check(
    "R3.16 repository URL variants normalise to the same project",
    dupVariants.every((d) => d.body && d.body.repository_matches.length === 1)
  );

  // --- R3.08, R3.09 -------------------------------------------------------
  const badRole = await api("POST", `/api/my/projects/${project.id}/invite`, {
    sid: a.sid,
    body: { student_id: b.studentId, role: "Chief Vibes Officer" },
  });
  check("R3.10 a non-standard role is refused", badRole.status === 400, `status ${badRole.status}`);

  const invited = await api("POST", `/api/my/projects/${project.id}/invite`, {
    sid: a.sid,
    body: { student_id: b.studentId, role: "3D Artist" },
  });
  check("R3.08 maintainer can invite with a standard role", invited.status === 200, `status ${invited.status}`);

  pub = await api("GET", `/api/projects/${project.id}`);
  check(
    "R3.09 an invited student is NOT publicly shown as a contributor",
    !pub.body.contributors.some((x) => x.student_id === b.studentId),
    JSON.stringify(pub.body.contributors.map((x) => x.name))
  );

  const inbox = await api("GET", "/api/my/projects", { sid: b.sid });
  check("R3.09 the invitation reaches the invited student", inbox.body.invitations.length === 1);

  // A non-contributor cannot answer someone else's invitation.
  const stolen = await api("POST", `/api/my/projects/${project.id}/respond`, {
    sid: c.sid,
    body: { accept: true },
  });
  check("R3.24 a non-contributor cannot answer an invitation", stolen.status === 403, `status ${stolen.status}`);

  await api("POST", `/api/my/projects/${project.id}/respond`, { sid: b.sid, body: { accept: true } });
  pub = await api("GET", `/api/projects/${project.id}`);
  check(
    "R3.09 after acceptance the contributor appears publicly with a role",
    pub.body.contributors.some((x) => x.student_id === b.studentId && x.role === "3D Artist")
  );
  check("R3.15 maintainer is identified among contributors", pub.body.contributors[0].is_maintainer === true);

  // --- R3.11 --------------------------------------------------------------
  await api("PUT", `/api/my/projects/${project.id}/contribution`, {
    sid: b.sid,
    body: { contribution_statement: "Modelled and textured the heart assets.", featured: true },
  });
  pub = await api("GET", `/api/projects/${project.id}`);
  check(
    "R3.11 contributor's own statement is published",
    pub.body.contributors.find((x) => x.student_id === b.studentId).contribution_statement ===
      "Modelled and textured the heart assets."
  );

  // The maintainer has no route that writes someone else's statement. The role
  // route exists and must leave the statement untouched.
  await api("PUT", `/api/my/projects/${project.id}/contributors/${b.studentId}`, {
    sid: a.sid,
    body: { role: "Technical Artist", contribution_statement: "Maintainer rewrote this." },
  });
  pub = await api("GET", `/api/projects/${project.id}`);
  const bRow = pub.body.contributors.find((x) => x.student_id === b.studentId);
  check("R3.10 maintainer can change the standardized role", bRow.role === "Technical Artist");
  check(
    "R3.11 maintainer CANNOT rewrite the contributor's statement",
    bRow.contribution_statement === "Modelled and textured the heart assets.",
    bRow.contribution_statement
  );

  // --- R3.12 --------------------------------------------------------------
  let bProfile = await api("GET", `/api/students/${b.studentId}`);
  check(
    "R3.12 featured project appears on the contributor's profile",
    bProfile.body.projects.some((p) => p.id === project.id)
  );
  await api("PUT", `/api/my/projects/${project.id}/contribution`, {
    sid: b.sid,
    body: { contribution_statement: "Modelled and textured the heart assets.", featured: false },
  });
  bProfile = await api("GET", `/api/students/${b.studentId}`);
  pub = await api("GET", `/api/projects/${project.id}`);
  check(
    "R3.12 un-featuring hides it from the profile",
    !bProfile.body.projects.some((p) => p.id === project.id)
  );
  check(
    "R3.12/R3.13 un-featuring does NOT remove the canonical relationship",
    pub.body.contributors.some((x) => x.student_id === b.studentId)
  );

  // --- R3.13 --------------------------------------------------------------
  await api("POST", `/api/my/projects/${project.id}/contributors/${b.studentId}/remove`, { sid: a.sid });
  pub = await api("GET", `/api/projects/${project.id}`);
  check(
    "R3.13 removed contributor is hidden publicly",
    !pub.body.contributors.some((x) => x.student_id === b.studentId)
  );
  const stillThere = await pool.query(
    "SELECT contribution_statement, removed_at FROM project_contributors WHERE project_id = $1 AND student_id = $2",
    [project.id, b.studentId]
  );
  check(
    "R3.13 removal is a soft delete — the row and the statement survive",
    stillThere.rowCount === 1 && stillThere.rows[0].removed_at !== null &&
      stillThere.rows[0].contribution_statement === "Modelled and textured the heart assets."
  );
  const restored = await api(
    "POST",
    `/api/my/projects/${project.id}/contributors/${b.studentId}/restore`,
    { sid: a.sid }
  );
  check("R3.13 removal is reversible", restored.status === 200);
  pub = await api("GET", `/api/projects/${project.id}`);
  check(
    "R3.13 restored contributor is public again",
    pub.body.contributors.some((x) => x.student_id === b.studentId)
  );

  // --- R3.24 --------------------------------------------------------------
  const current = await api("GET", `/api/my/projects/${project.id}`, { sid: a.sid });
  const hijack = await api("PUT", `/api/my/projects/${project.id}`, {
    sid: c.sid,
    body: { title: "Hijacked", version: current.body.version },
  });
  check(
    "R3.24 another student cannot update shared fields by naming the project id",
    hijack.status === 403,
    `status ${hijack.status}`
  );
  const contributorEdit = await api("PUT", `/api/my/projects/${project.id}`, {
    sid: b.sid,
    body: { title: "Contributor edit", version: current.body.version },
  });
  check(
    "R3.06 a non-maintainer contributor cannot edit shared fields",
    contributorEdit.status === 403,
    `status ${contributorEdit.status}`
  );

  // --- R3.17 --------------------------------------------------------------
  const v = current.body.version;
  const first = await api("PUT", `/api/my/projects/${project.id}`, {
    sid: a.sid,
    body: { title: "First writer wins", description: "one", version: v },
  });
  check("R3.17 first save from a fresh version succeeds", first.status === 200, `status ${first.status}`);
  const second = await api("PUT", `/api/my/projects/${project.id}`, {
    sid: a.sid,
    body: { title: "Second writer overwrites", description: "two", version: v },
  });
  check(
    "R3.17 a stale save is refused with a conflict, not applied silently",
    second.status === 409 && second.body.conflict === true,
    `status ${second.status}`
  );
  const after = await api("GET", `/api/my/projects/${project.id}`, { sid: a.sid });
  check(
    "R3.17 the first writer's change survived the stale save",
    after.body.title === "First writer wins",
    after.body.title
  );
  check("R3.17 the conflict response carries the current record", !!(second.body && second.body.current));

  // --- R3.04 --------------------------------------------------------------
  const addRepo = await api("POST", `/api/my/projects/${project.id}/repositories`, {
    sid: a.sid,
    body: { repository: "https://github.com/example-org/second-repo" },
  });
  check("R3.04 a project can hold multiple repositories", addRepo.body.repositories.length === 2);
  let dropRepo = await api("DELETE", `/api/my/projects/${project.id}/repositories`, {
    sid: a.sid,
    body: { repository: "https://github.com/example-org/second-repo" },
  });
  dropRepo = await api("DELETE", `/api/my/projects/${project.id}/repositories`, {
    sid: a.sid,
    body: { repository: "https://github.com/example-org/xr-anatomy" },
  });
  check("R3.04 removing every repository is allowed", dropRepo.body.repositories.length === 0);
  pub = await api("GET", `/api/projects/${project.id}`);
  check("R3.04 the project is still valid with zero repositories", pub.status === 200 && !!pub.body.title);

  // --- R3.19 --------------------------------------------------------------
  const hostile = await api("PUT", `/api/my/projects/${project.id}`, {
    sid: a.sid,
    body: {
      title: "Demo link validation",
      version: (await api("GET", `/api/my/projects/${project.id}`, { sid: a.sid })).body.version,
      playable_url: "javascript:alert(1)",
      video_url: "<iframe src=//evil.test></iframe>",
      fallback_image_url: "data:text/html;base64,PHNjcmlwdD4=",
      fallback_note: "<script>alert(1)</script>Use the screenshots.",
    },
  });
  check(
    "R3.19 javascript:, raw iframe HTML and data: URLs are all rejected, not stored",
    hostile.status === 200 &&
      hostile.body.playable_url === "" &&
      hostile.body.video_url === "" &&
      hostile.body.fallback_image_url === "",
    JSON.stringify({
      p: hostile.body.playable_url,
      v: hostile.body.video_url,
      f: hostile.body.fallback_image_url,
    })
  );
  check(
    "R3.19 markup in the fallback note is stripped to inert text",
    hostile.body.fallback_note === "alert(1)Use the screenshots.",
    hostile.body.fallback_note
  );

  // --- R3.18, R3.20, R3.21 ------------------------------------------------
  const withDemo = await api("PUT", `/api/my/projects/${project.id}`, {
    sid: a.sid,
    body: {
      title: "T3 XR Anatomy Lab",
      version: hostile.body.version,
      playable_url: "https://example.test/working_demo.html",
      video_url: "https://example.test/walkthrough.mp4",
      fallback_image_url: "https://example.test/fallback.svg",
      fallback_note: "Screenshots and a recorded walkthrough if the demo will not run.",
    },
  });
  check(
    "R3.18 the three presentation links are stored in separate slots",
    withDemo.body.playable_url.endsWith("working_demo.html") &&
      withDemo.body.video_url.endsWith("walkthrough.mp4") &&
      withDemo.body.fallback_image_url.endsWith("fallback.svg")
  );
  pub = await api("GET", `/api/projects/${project.id}`);
  check(
    "R3.20/R3.21 the public page receives the playable URL and a fallback",
    !!pub.body.playable_url && !!pub.body.fallback_image_url
  );

  // --- R3.07, R3.26 -------------------------------------------------------
  const urlBefore = project.id;
  const badTransfer = await api("POST", `/api/my/projects/${project.id}/transfer`, {
    sid: a.sid,
    body: { student_id: c.studentId },
  });
  check(
    "R3.07 maintenance cannot be transferred to a non-contributor",
    badTransfer.status === 400,
    `status ${badTransfer.status}`
  );
  const transfer = await api("POST", `/api/my/projects/${project.id}/transfer`, {
    sid: a.sid,
    body: { student_id: b.studentId },
  });
  check("R3.07 maintenance transfers to an accepted contributor", transfer.status === 200);
  check("R3.26 the project id/URL is unchanged by the transfer", transfer.body.id === urlBefore);
  const oldMaintainer = await api("PUT", `/api/my/projects/${project.id}`, {
    sid: a.sid,
    body: { title: "Former maintainer edit", version: transfer.body.version },
  });
  check(
    "R3.07 the former maintainer loses shared-field rights",
    oldMaintainer.status === 403,
    `status ${oldMaintainer.status}`
  );

  // --- R3.14 --------------------------------------------------------------
  const bSkills = await pool.query("SELECT COUNT(*)::int n FROM student_skills WHERE student_id = $1", [
    b.studentId,
  ]);
  check(
    "R3.14 project technologies did not become personal skills for contributors",
    bSkills.rows[0].n === 0,
    `${bSkills.rows[0].n} skills`
  );

  // --- R3.25 --------------------------------------------------------------
  const directory = await api("GET", "/api/students");
  check(
    "R3.25 R1 directory still returns the published fixture students",
    directory.status === 200 && directory.body.length >= 17,
    `${directory.body && directory.body.length} students`
  );
  const r1Project = await api("GET", "/api/projects/P01");
  check("R3.25 an R1 fixture project is still publicly readable", r1Project.status === 200);
  check(
    "R3.25 R1 fixture contributors are still credited",
    r1Project.body.contributors && r1Project.body.contributors.length > 0,
    `${r1Project.body.contributors && r1Project.body.contributors.length} contributors`
  );

  console.log(results.join("\n"));
  console.log(`\n${results.length - failures}/${results.length} checks passed.`);
  // The synthetic students are published, and tests/e2e.js asserts an exact
  // directory count, so this run must not leave them in the database.
  await resetOwnFixtures();
  await pool.end();
  process.exit(failures ? 1 : 0);
})().catch(async (err) => {
  console.error("Test run crashed:", err);
  try {
    await pool.end();
  } catch {}
  process.exit(1);
});
