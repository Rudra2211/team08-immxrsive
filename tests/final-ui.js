/**
 * Final Release browser checks, against a LOCAL frontend + backend + database.
 *
 *   DATABASE_URL=... FRONTEND_URL=http://127.0.0.1:8090 BASE_URL=http://127.0.0.1:3002 \
 *   STAFF_USERNAME=... STAFF_PASSWORD=... node tests/final-ui.js
 *
 * Use a fresh database (it imports the legacy fixture and a 220-student
 * dataset through the staff page). The session for the student journeys is
 * injected from a seeded session, as in r3-ui.js.
 */
const fs = require("fs");
const os = require("os");
const path = require("path");
const { chromium } = require("playwright");
const { pool } = require("../backend/db");

const FRONTEND = (process.env.FRONTEND_URL || "http://127.0.0.1:8090").replace(/\/+$/, "");
const STAFF_USER = process.env.STAFF_USERNAME || "staff.tester";
const STAFF_PASS = process.env.STAFF_PASSWORD || "local-test-pass-123";
const FIX = path.join(__dirname, "fixtures", "final");

let failures = 0;
let total = 0;
function check(name, ok, detail = "") {
  total += 1;
  if (!ok) failures += 1;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? " — " + detail : ""}`);
}

function scaleFile() {
  const students = [];
  for (let i = 1; i <= 220; i += 1) {
    const n = String(i).padStart(3, "0");
    students.push({ id: `SC${n}`, name: `Synthetic Student ${n}`, status: "current", publication: "published", availability: ["internship"], skills: ["Unity"] });
  }
  const projects = [];
  for (let i = 1; i <= 110; i += 1) {
    const n = String(i).padStart(3, "0");
    projects.push({ id: `PC${n}`, title: `Synthetic Project ${n}`, technologies: ["Unity"],
      contributors: [{ student_id: `SC${String(i).padStart(3, "0")}`, role: "Contributor" }, { student_id: `SC${String(i + 110).padStart(3, "0")}`, role: "Contributor" }] });
  }
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "scale-")), "scale_fixture.json");
  fs.writeFileSync(file, JSON.stringify({ students, projects, companies: [] }));
  return file;
}

const lid = async (kind, id) =>
  (await pool.query("SELECT internal_id FROM legacy_ids WHERE kind = $1 AND legacy_id = $2", [kind, id])).rows[0].internal_id;

async function overflow(page) {
  return page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
}

(async () => {
  const browser = await chromium.launch();
  const errors = [];
  try {
    const staff = await browser.newContext();
    const sp = await staff.newPage();
    sp.on("pageerror", (e) => errors.push(e.message));

    // ---- staff: sign in and import through the page (F.01) ----------------
    await sp.goto(`${FRONTEND}/staff-login.html`);
    await sp.fill("#username", STAFF_USER);
    await sp.fill("#password", STAFF_PASS);
    await Promise.all([sp.waitForURL(/admin\.html/), sp.click("button[type=submit]")]);
    await sp.click("text=Open records and recovery");
    await sp.waitForSelector("#workspace:not([hidden])");
    await sp.setInputFiles("#import-file", path.join(FIX, "legacy_export.json"));
    await sp.click("#import-btn");
    await sp.waitForSelector("#import-report h3");
    const report = await sp.textContent("#import-report");
    check("F.03 the staff page shows the duplicate LS04 → LS01", /LS04 may be LS01 — same email/.test(report));
    check("F.03 the staff page shows the broken reference LP02/LS99", /LP02/.test(report) && /LS99/.test(report));
    check("F.07 the staff page lists unclaimed LS02, LS05, LS06", /LS02/.test(report) && /LS05/.test(report) && /LS06/.test(report));
    await sp.setInputFiles("#import-file", path.join(FIX, "legacy_export.json"));
    await sp.click("#import-btn");
    await sp.waitForFunction(() => /0 students created/.test(document.getElementById("notice").textContent));
    check("F.02 re-import from the page creates nothing", true);

    await sp.setInputFiles("#import-file", scaleFile());
    await sp.click("#import-btn");
    await sp.waitForFunction(() => /220 students created/.test(document.getElementById("notice").textContent), null, { timeout: 60000 });
    check("F.27 the scale file imports through the same staff page", true);

    // ---- F.17, F.18 merge through the page -------------------------------
    const ls04 = await lid("student", "LS04");
    const ls01 = await lid("student", "LS01");
    await sp.fill("#profile-q", "LS04");
    await sp.click("#profile-search button");
    await sp.click("#profiles-list >> text=Use as duplicate");
    await sp.fill("#profile-q", "LS01");
    await sp.click("#profile-search button");
    await sp.click("#profiles-list >> text=Use as surviving profile");
    await sp.fill("#merge-note", "Same email on the old site");
    await sp.click("#merge-form button");
    await sp.waitForFunction(() => /Merged\./.test(document.getElementById("notice").textContent));
    check("F.17 staff merge duplicates from the page", (await sp.inputValue("#merge-from")) === ls04);

    // ---- public: directory (F.28, F.29), merged URL (F.18), lifecycle ------
    const pub = await browser.newContext();
    const pp = await pub.newPage();
    pp.on("pageerror", (e) => errors.push(e.message));
    const heavy = [];
    pp.on("request", (r) => {
      if (/\.(mp4|webm|pdf|wasm|glb|unityweb)(\?|$)/i.test(r.url()) || /\/demo\//.test(r.url())) heavy.push(r.url());
    });
    let firstLoadBytes = 0;
    pp.on("response", async (r) => {
      if (/\/api\/students\?/.test(r.url()) && !firstLoadBytes) firstLoadBytes = (await r.body()).length;
    });
    await pp.goto(`${FRONTEND}/index.html`);
    await pp.waitForSelector("#results .card");
    const cards = await pp.$$eval("#results .card", (c) => c.length);
    check("F.28 the directory first shows one page of 24", cards === 24, `${cards}`);
    check("F.28 the first directory request stays small", firstLoadBytes > 0 && firstLoadBytes < 20000, `${firstLoadBytes} bytes`);
    check("F.28 the count reports the full total", /2\d\d students found — showing 24/.test(await pp.textContent("#result-count")), await pp.textContent("#result-count"));
    await pp.click("#load-more");
    await pp.waitForFunction(() => document.querySelectorAll("#results .card").length === 48);
    check("F.28 Show more students loads the next page", true);
    check("F.29 the directory loads no video, playable or resume asset", heavy.length === 0, heavy.join(", "));
    const staleId = await lid("student", "LS02");
    await pp.goto(`${FRONTEND}/index.html?talent=active&availability=full-time`);
    await pp.waitForFunction(() => !/Loading/.test(document.getElementById("result-count").textContent));
    check("F.14 the stale legacy Daniel Kim (LS02) is not listed as available",
      (await pp.$$(`#results a[href*="${staleId}"]`)).length === 0 && (await pp.$$("#results .card")).length > 0);

    await pp.goto(`${FRONTEND}/student.html?id=${encodeURIComponent(ls04)}`);
    await pp.waitForURL(new RegExp(`id=${ls01}`));
    await pp.waitForSelector("#profile h1");
    check("F.18 the merged profile's old URL redirects to the survivor with a notice",
      /combined with this one/.test(await pp.textContent("#profile")));

    const ls02 = staleId;
    await pp.goto(`${FRONTEND}/student.html?id=${encodeURIComponent(ls02)}`);
    await pp.waitForSelector("#profile h1");
    check("F.14 a stale profile says availability is not recently confirmed", /Not recently confirmed/.test(await pp.textContent("#profile")));

    const ls06 = await lid("student", "LS06");
    await pp.goto(`${FRONTEND}/student.html?id=${encodeURIComponent(ls06)}`);
    await pp.waitForSelector("#profile .notice");
    check("F.15 a retired profile's page says it is archived", /archived/.test(await pp.textContent("#profile")));

    const lp03 = await lid("project", "LP03");
    await pp.goto(`${FRONTEND}/project.html?id=${encodeURIComponent(lp03)}`);
    await pp.waitForSelector("#project h1");
    const lp03Text = await pp.textContent("#project");
    check("F.16 the project still credits the retired contributor", /Retired Contributor \(profile archived\)/.test(lp03Text));
    check("F.16 the retired contributor is not a dead link",
      (await pp.$$eval("#project a", (as) => as.filter((a) => a.textContent === "Retired Contributor").length)) === 0);

    // ---- student: claim (F.08), showcase (F.13), demo state (F.37) ---------
    await pool.query(
      `INSERT INTO users (id, github_user_id, github_login, algoma_email, verified_at)
       VALUES ('tfu_claimer', 991001, 'tfu-claimer', 'tfu-claimer@algomau.ca', NOW()) ON CONFLICT (id) DO NOTHING`
    );
    await pool.query("INSERT INTO sessions (id, user_id, expires_at) VALUES ('tfu_sid', 'tfu_claimer', NOW() + INTERVAL '1 day') ON CONFLICT (id) DO NOTHING");
    const stu = await browser.newContext({ viewport: { width: 390, height: 844 } });
    await stu.addCookies([{ name: "sid", value: "tfu_sid", domain: "127.0.0.1", path: "/" }]);
    const st = await stu.newPage();
    st.on("pageerror", (e) => errors.push(e.message));
    await st.goto(`${FRONTEND}/account.html`);
    await st.waitForSelector("#step-claim:not([hidden])");
    await st.fill("#claim-q", "Daniel");
    await st.click("#claim-search button");
    await st.click("#claim-results >> text=Claim Daniel Kim");
    await st.waitForFunction(() => /staff/.test(document.getElementById("notice").textContent));
    check("F.09 an ordinary claim waits for staff", /Waiting for staff review/.test(await st.textContent("#claim-mine")));
    check("F.25 the account page has no sideways scroll at 390px", (await overflow(st)) <= 0);

    await sp.reload();
    await sp.waitForSelector("#claims-list li");
    await sp.click("#claims-list >> text=Approve claim");
    await sp.waitForFunction(() => /Claim approved/.test(document.getElementById("notice").textContent));
    check("F.10 staff approve the claim from the page", true);

    await st.goto(`${FRONTEND}/profile-edit.html`);
    await st.waitForSelector("#editor:not([hidden])");
    check("F.14 the editor shows the stale confirmation date", /last confirmed/i.test(await st.textContent("#confirmed-text")));
    await st.fill("#headline", "Alumni interaction developer");
    await st.check('input[name="availability_mode"][value="showcase"]');
    await st.click("#profile-form button[type=submit]").catch(async () => st.click("text=Save my profile"));
    await st.waitForFunction(() => /saved/i.test(document.body.textContent));
    await pp.goto(`${FRONTEND}/student.html?id=${encodeURIComponent(ls02)}`);
    await pp.waitForSelector("#profile h1");
    check("F.13 a Showcase Only profile is not presented as seeking work", /Showcase Only/.test(await pp.textContent("#profile")));
    check("F.25 the profile editor has no sideways scroll at 390px", (await overflow(st)) <= 0);

    // Staff hand LP01 to the claimer (F.19), who marks the demo unavailable (F.37).
    const lp01 = await lid("project", "LP01");
    await sp.fill("#project-q", "XR Anatomy");
    await sp.click("#project-search button");
    const row = sp.locator("#projects-list li", { hasText: lp01 });
    await row.locator("select").selectOption(ls02);
    await row.locator("input").fill("Original maintainer has left");
    await row.locator("text=Make maintainer").click();
    await sp.waitForFunction(() => /Maintainer changed/.test(document.getElementById("notice").textContent));
    check("F.19 staff reassign the maintainer from the page", true);
    check("F.25 the staff records page has no sideways scroll at 390px", await (async () => {
      await sp.setViewportSize({ width: 390, height: 844 });
      return (await overflow(sp)) <= 0;
    })());

    await pool.query("UPDATE projects SET playable_url = 'https://example.test/demo/' WHERE id = $1", [lp01]);
    await st.goto(`${FRONTEND}/project-edit.html?id=${encodeURIComponent(lp01)}`);
    await st.waitForSelector("#demo_status:not([disabled])");
    await st.selectOption("#demo_status", "unavailable");
    await st.fill("#demo_status_note", "The WebGL build is being rebuilt.");
    await st.click("#shared-btn");
    await st.waitForFunction(() => /saved/i.test(document.body.textContent));
    await pp.goto(`${FRONTEND}/project.html?id=${encodeURIComponent(lp01)}`);
    await pp.waitForSelector("#project h1");
    const lp01Text = await pp.textContent("#project");
    check("F.37 an unavailable demo explains itself", /temporarily unavailable/.test(lp01Text) && /being rebuilt/.test(lp01Text));
    check("F.37 an unavailable demo offers no Play action", (await pp.$$("text=Play demo")).length === 0);
    check("F.37 project history survives (contributors still listed)", /Avery Chen/.test(lp01Text) && /Daniel Kim/.test(lp01Text));

    check("no uncaught JavaScript errors", errors.length === 0, errors.join(" | "));
  } catch (err) {
    failures += 1;
    console.log("CRASH", err.stack);
  } finally {
    console.log(`\n${total - failures}/${total} passed`);
    await browser.close();
    await pool.end();
    process.exit(failures ? 1 : 0);
  }
})();
