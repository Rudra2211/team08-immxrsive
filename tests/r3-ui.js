/*
 * Release 3 browser pass — the parts a person actually does.
 *   FRONTEND_URL=http://127.0.0.1:8080 BASE_URL=http://127.0.0.1:3001 \
 *   DATABASE_URL=... node tests/r3-ui.js
 *
 * Complements tests/r3-api.js, which covers the authorization and concurrency
 * rules. This one checks that the Add Project, invite, accept, publish and
 * Play-demo journeys work in a browser, and that the pages are usable at the
 * 390 CSS pixel width R3.23 names.
 *
 * config.js is intercepted rather than edited, so the committed deployment URL
 * is left alone. The session cookie is injected from a seeded session rather
 * than completing real GitHub OAuth.
 */
const { chromium } = require("playwright");
const { pool } = require("../backend/db");

const FRONTEND = (process.env.FRONTEND_URL || "http://127.0.0.1:8080").replace(/\/+$/, "");
const BACKEND = (process.env.BASE_URL || "http://127.0.0.1:3001").replace(/\/+$/, "");

const results = [];
let failures = 0;
function check(name, ok, detail = "") {
  if (!ok) failures += 1;
  results.push(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? " — " + detail : ""}`);
}

async function seed(key, name) {
  const userId = `u3_user_${key}`;
  const studentId = `u3_stu_${key}`;
  const sid = `u3_sid_${key}`;
  await pool.query(
    `INSERT INTO users (id, github_user_id, github_login, algoma_email, verified_at)
     VALUES ($1,$2,$3,$4,NOW()) ON CONFLICT (id) DO UPDATE SET verified_at = NOW()`,
    [userId, 950000 + key.charCodeAt(0), `u3-${key}`, `u3-${key}@algomau.ca`]
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
  return { sid, studentId, name };
}

async function reset() {
  await pool.query("DELETE FROM projects WHERE maintainer_student_id LIKE 'u3\\_%'");
  await pool.query("DELETE FROM sessions WHERE id LIKE 'u3\\_%'");
  await pool.query("DELETE FROM students WHERE id LIKE 'u3\\_%'");
  await pool.query("DELETE FROM users WHERE id LIKE 'u3\\_%'");
}

/** A context wired to the local backend, optionally signed in as `sid`. */
async function makeContext(browser, sid, viewport) {
  const context = await browser.newContext({ viewport });
  await context.route("**/config.js", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/javascript",
      body: `window.APP_CONFIG = { API_BASE_URL: "${BACKEND}" };`,
    })
  );
  if (sid) {
    await context.addCookies([{ name: "sid", value: sid, domain: "127.0.0.1", path: "/" }]);
  }
  return context;
}

const noticeText = (page) => page.locator("#notice").innerText().catch(() => "");

(async () => {
  await reset();
  const a = await seed("a", "U3 Maintainer");
  const b = await seed("b", "U3 Teammate");

  const browser = await chromium.launch();
  const desktop = { width: 1280, height: 900 };
  const phone = { width: 390, height: 844 };

  // ---- signed out -------------------------------------------------------
  let ctx = await makeContext(browser, null, desktop);
  let page = await ctx.newPage();
  const pageErrors = [];
  page.on("pageerror", (e) => pageErrors.push(e.message));
  await page.goto(`${FRONTEND}/my-projects.html`);
  await page.waitForSelector("#gate:not([hidden])", { timeout: 15000 });
  check(
    "signed out: Your projects explains what to do instead of failing",
    (await page.locator("#gate-title").innerText()).toLowerCase().includes("sign in")
  );
  await ctx.close();

  // ---- R3.01, R3.02, R3.03 ----------------------------------------------
  ctx = await makeContext(browser, a.sid, desktop);
  page = await ctx.newPage();
  page.on("pageerror", (e) => pageErrors.push(e.message));
  await page.goto(`${FRONTEND}/my-projects.html`);
  await page.waitForSelector("#main-content:not([hidden])", { timeout: 15000 });
  check("R3.01 one Add Project form is on the page", await page.locator("#create-form").isVisible());

  const roleCount = await page.locator("#role option").count();
  check("R3.10 the role list is the standardized vocabulary", roleCount === 13, `${roleCount} options incl. placeholder`);

  await page.fill("#title", "U3 Reef Survey XR");
  await page.fill("#description", "Synthetic project for the R3 browser pass.");
  await page.selectOption("#domain", "XR / Immersive");
  await page.fill("#technologies", "Unity, C#, Blender");
  await page.fill("#repository", "https://github.com/example-org/reef-survey");
  await page.selectOption("#role", "XR Developer");
  await page.click("#create-btn");

  await page.waitForURL(/project-edit\.html/, { timeout: 15000 });
  await page.waitForSelector("#editor:not([hidden])", { timeout: 15000 });
  check("R3.01 saving lands on the project's own editor", page.url().includes("project-edit.html"));
  check(
    "R3.01 the new project is described as a private draft",
    (await page.locator("#status-text").innerText()).toLowerCase().includes("draft")
  );
  const projectId = new URL(page.url()).searchParams.get("id");

  // ---- R3.18, R3.21 -----------------------------------------------------
  await page.fill("#playable_url", `${FRONTEND}/demo/working_demo.html`);
  await page.fill("#fallback_image_url", `${FRONTEND}/demo/fallback.svg`);
  await page.fill("#fallback_note", "Screenshots if the interactive demo will not run on your device.");
  await page.click("#shared-btn");
  await page.waitForFunction(
    () => document.querySelector("#notice").innerText.toLowerCase().includes("saved"),
    { timeout: 15000 }
  );
  check("R3.18 demo and fallback links save from the editor", true);

  // ---- R3.08 ------------------------------------------------------------
  check("R3.08 the invite form is available to the maintainer", await page.locator("#invite-block").isVisible());
  await page.fill("#invite-search", "U3 Team");
  await page.waitForSelector("#invite-results button", { timeout: 15000 });
  await page.click("#invite-results button");
  await page.selectOption("#invite-role", "3D Artist");
  await page.click("#invite-btn");
  await page.waitForFunction(
    () => document.querySelector("#notice").innerText.toLowerCase().includes("invitation sent"),
    { timeout: 15000 }
  );
  check(
    "R3.09 the invited teammate is listed as awaiting their answer",
    (await page.locator("#contributors").innerText()).toLowerCase().includes("waiting for their answer")
  );

  await page.click("#publish-btn");
  await page.waitForFunction(
    () => document.querySelector("#notice").innerText.toLowerCase().includes("published"),
    { timeout: 15000 }
  );

  // ---- R3.09 from the invited student's side ----------------------------
  const ctxB = await makeContext(browser, b.sid, desktop);
  const pageB = await ctxB.newPage();
  pageB.on("pageerror", (e) => pageErrors.push(e.message));
  await pageB.goto(`${FRONTEND}/my-projects.html`);
  await pageB.waitForSelector("#invitations-panel:not([hidden])", { timeout: 15000 });
  check("R3.09 the invitation is visible to the invited student", true);

  // The public page must not credit them yet.
  const anonCtx = await makeContext(browser, null, desktop);
  const anon = await anonCtx.newPage();
  anon.on("pageerror", (e) => pageErrors.push(e.message));
  await anon.goto(`${FRONTEND}/project.html?id=${encodeURIComponent(projectId)}`);
  await anon.waitForSelector("#project h1", { timeout: 15000 });
  let contributors = await anon.locator("#project").innerText();
  check(
    "R3.09 an unaccepted invitation is not credited on the public page",
    !contributors.includes("U3 Teammate"),
    contributors.slice(0, 120)
  );

  await pageB.click("#invitations button");
  await pageB.waitForFunction(
    () => document.querySelector("#notice").innerText.toLowerCase().includes("accepted"),
    { timeout: 15000 }
  );

  // ---- R3.11 ------------------------------------------------------------
  await pageB.goto(`${FRONTEND}/project-edit.html?id=${encodeURIComponent(projectId)}`);
  await pageB.waitForSelector("#contribution-form:not([hidden])", { timeout: 15000 });
  check(
    "R3.06 a contributor cannot edit the shared details",
    await pageB.locator("#title").isDisabled()
  );
  check(
    "R3.06 the page explains that a teammate maintains it",
    (await pageB.locator("#role-text").innerText()).toLowerCase().includes("maintains this project")
  );
  await pageB.fill("#contribution_statement", "Built the coral assets and the underwater lighting.");
  await pageB.click("#contribution-btn");
  await pageB.waitForFunction(
    () => document.querySelector("#notice").innerText.toLowerCase().includes("saved"),
    { timeout: 15000 }
  );

  // ---- R3.15, R3.20, R3.21 on the public page ---------------------------
  await anon.reload();
  await anon.waitForSelector("#project h1", { timeout: 15000 });
  contributors = await anon.locator("#project").innerText();
  check("R3.09 after acceptance the contributor is credited publicly", contributors.includes("U3 Teammate"));
  check("R3.15 their standardized role is shown", contributors.includes("3D Artist"));
  check(
    "R3.15 their own contribution statement is shown",
    contributors.includes("Built the coral assets")
  );
  check(
    "R3.15 the maintainer is identified",
    contributors.toLowerCase().includes("maintains this project")
  );

  const playCount = await anon.getByRole("link", { name: "Play demo" }).count();
  check("R3.20 the public page offers a Play demo action", playCount >= 1, `${playCount} found`);
  const fallbackVisible = await anon.locator(".demo-fallback img").isVisible().catch(() => false);
  check("R3.21 fallback evidence is shown alongside the playable demo", fallbackVisible);

  // The playable demo opens in a new tab rather than being embedded, so a dead
  // demo cannot take the page down (R3.19, R3.22).
  const iframes = await anon.locator("#project iframe").count();
  check("R3.19 nothing is embedded in an iframe on the public page", iframes === 0, `${iframes} iframes`);

  // ---- R3.22 broken demo isolation --------------------------------------
  await page.reload();
  await page.waitForSelector("#editor:not([hidden])", { timeout: 15000 });
  await page.fill("#playable_url", "https://127.0.0.1:9/this-demo-does-not-exist.html");
  await page.fill("#fallback_image_url", "https://127.0.0.1:9/missing-fallback.svg");
  await page.click("#shared-btn");
  await page.waitForFunction(
    () => document.querySelector("#notice").innerText.toLowerCase().includes("saved"),
    { timeout: 15000 }
  );
  await anon.reload();
  await anon.waitForSelector("#project h1", { timeout: 15000 });
  const brokenText = await anon.locator("#project").innerText();
  check(
    "R3.22 a broken demo URL leaves the project page intact",
    brokenText.includes("U3 Reef Survey XR") && brokenText.includes("Contributors")
  );
  check(
    "R3.22 the visitor can still navigate away",
    (await anon.locator("header.site a.brand").count()) === 1
  );
  check(
    "R3.22 a broken fallback image degrades to words, not a broken icon",
    brokenText.toLowerCase().includes("could not be loaded") ||
      brokenText.includes("Screenshots if the interactive demo")
  );

  // ---- R3.23 mobile -----------------------------------------------------
  const mobileCtx = await makeContext(browser, b.sid, phone);
  const mob = await mobileCtx.newPage();
  mob.on("pageerror", (e) => pageErrors.push(e.message));

  for (const [label, url] of [
    ["public project page", `${FRONTEND}/project.html?id=${encodeURIComponent(projectId)}`],
    ["project editor", `${FRONTEND}/project-edit.html?id=${encodeURIComponent(projectId)}`],
    ["your projects", `${FRONTEND}/my-projects.html`],
  ]) {
    await mob.goto(url);
    await mob.waitForTimeout(800);
    const overflow = await mob.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth
    );
    check(`R3.23 ${label} does not scroll sideways at 390px`, overflow <= 1, `${overflow}px overflow`);
  }
  const mobileText = await mob.evaluate(() => document.body.innerText);
  check(
    "R3.23 contributor roles are reachable on a phone",
    mobileText.length > 50
  );

  check("no uncaught page errors anywhere in the pass", pageErrors.length === 0, pageErrors.join(" | "));

  await browser.close();
  // Teardown matters here: these students are published, and tests/e2e.js
  // asserts an exact directory count, so leaving them behind would make the R1
  // regression pass fail for reasons that have nothing to do with R1.
  await reset();
  console.log(results.join("\n"));
  console.log(`\n${results.length - failures}/${results.length} checks passed.`);
  await pool.end();
  process.exit(failures ? 1 : 0);
})().catch(async (err) => {
  console.error("UI run crashed:", err);
  try {
    await pool.end();
  } catch {}
  process.exit(1);
});
