/*
 * Release 1 acceptance pass.
 *   npm i -D playwright && npx playwright install chromium
 *   BASE_URL=https://your-frontend.onrender.com node tests/e2e.js
 * Checks every R1 requirement that can be observed from a browser.
 */
const { chromium } = require("playwright");
const BASE = (process.env.BASE_URL || "http://127.0.0.1:4200").replace(/\/+$/, "");

(async () => {
  const browser = await chromium.launch();
  const results = [];
  const check = (name, ok, detail = "") => {
    results.push(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? " — " + detail : ""}`);
  };

  // ---- Desktop pass
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));

  await page.goto(`${BASE}/index.html`);
  await page.waitForFunction(() => document.querySelectorAll("#results > li").length > 0, { timeout: 15000 });
  let count = await page.locator("#results > li").count();
  check("R1.01 directory lists published students", count === 17, `${count} cards`);
  const names = await page.locator("#results h3 a").allTextContents();
  check("R1.20 unpublished Nora Evans absent", !names.includes("Nora Evans"));

  // search
  await page.fill("#q", "accessib");
  await page.click('#filters button[type="submit"]');
  await page.waitForTimeout(800);
  const searchNames = await page.locator("#results h3 a").allTextContents();
  check("R1.04 case-insensitive substring search", searchNames.includes("Isabella Moore") && searchNames.includes("Leila Ahmed"), searchNames.join(", "));

  // clear
  await page.click("#clear");
  await page.waitForTimeout(800);
  count = await page.locator("#results > li").count();
  check("R1.09 clear filters restores full set", count === 17, `${count} cards`);

  // skill AND
  await page.selectOption("#skill", ["Unity", "C#"]);
  await page.click('#filters button[type="submit"]');
  await page.waitForTimeout(800);
  const andNames = await page.locator("#results h3 a").allTextContents();
  check("R1.06 multiple skills use AND", andNames.length === 5 && andNames.includes("Avery Chen") && !andNames.includes("Maya Patel"), andNames.join(", "));
  const chips = await page.locator("#active-filters .chip").allTextContents();
  check("R1.09 active filters visible", chips.length === 2, chips.join(" | "));

  // filtered URL survives reload
  const filteredUrl = page.url();
  await page.reload();
  await page.waitForFunction(() => document.querySelectorAll("#results > li").length > 0, { timeout: 15000 });
  const afterReload = await page.locator("#results h3 a").allTextContents();
  check("R1.10 filtered URL deterministic after reload", JSON.stringify(afterReload) === JSON.stringify(andNames), afterReload.join(", "));

  // skill filter must not match project technology
  await page.goto(`${BASE}/index.html?skill=React`);
  await page.waitForFunction(() => document.querySelectorAll("#results > li").length > 0, { timeout: 15000 });
  const reactNames = await page.locator("#results h3 a").allTextContents();
  check("R1.15 project tech is not a contributor skill", !reactNames.includes("Noah Williams"), reactNames.join(", "));

  // student profile
  await page.goto(`${BASE}/student.html?id=S01`);
  await page.waitForSelector("h1");
  const h1 = await page.locator("h1").textContent();
  const bodyText = await page.locator("main").innerText();
  check("R1.12/R1.13 profile shell renders", h1 === "Avery Chen" && bodyText.includes("Computer Science") && bodyText.includes("Internship") && bodyText.includes("OpenXR"));
  check("R1.14 project evidence listed", bodyText.includes("Industrial Safety VR Trainer") && bodyText.includes("XR Anatomy Lab"));

  // shared project reachable from two profiles
  await page.goto(`${BASE}/project.html?id=P04`);
  await page.waitForSelector("h1");
  const projText = await page.locator("main").innerText();
  check("R1.16/R1.17 shared project page", projText.includes("Avery Chen") && projText.includes("Emma Wilson") && projText.includes("Daniel Kim") && projText.includes("Interaction Developer"));

  // unpublished contributor hidden on project page
  await page.goto(`${BASE}/project.html?id=P03`);
  await page.waitForSelector("h1");
  const p03 = await page.locator("main").innerText();
  check("R1.20 unpublished contributor hidden on project", !p03.includes("Nora Evans"), "");

  // dead external link degrades safely
  await page.goto(`${BASE}/project.html?id=P07`);
  await page.waitForSelector("h1");
  const p07 = await page.locator("main").innerText();
  check("R1.24 page with dead external link still renders", p07.includes("WebXR Campus Tour") && p07.includes("Lucas Tremblay"));

  // invalid routes
  await page.goto(`${BASE}/student.html?id=S999`);
  await page.waitForSelector("h1");
  check("R1.21 invalid student shows not-found", (await page.locator("h1").textContent()) === "Student not found");
  await page.goto(`${BASE}/project.html?id=P999`);
  await page.waitForSelector("h1");
  check("R1.21 invalid project shows not-found", (await page.locator("h1").textContent()) === "Project not found");
  await page.goto(`${BASE}/student.html?id=S16`);
  await page.waitForSelector("h1");
  check("R1.20 unpublished profile not reachable by URL", (await page.locator("h1").textContent()) === "Student not found");

  // inquiry from student carries context
  await page.goto(`${BASE}/student.html?id=S04`);
  await page.waitForSelector("h1");
  await page.click("a.btn");
  await page.waitForSelector("#context-summary strong");
  const ctx = await page.locator("#context-summary").innerText();
  check("R1.18 student inquiry carries identity", ctx.includes("Sofia Martin") && ctx.includes("S04"), ctx);
  await page.fill("#company_name", "Northern XR Studios");
  await page.fill("#contact_name", "Dana Okafor");
  await page.fill("#contact_email", "dana@northernxr.test");
  await page.fill("#description", "We have a summer internship for a full-stack developer.");
  await page.click("#submit-btn");
  await page.waitForSelector("#form-message .notice.success", { timeout: 10000 });
  check("R1.18 inquiry submits successfully", true);

  // inquiry from project identifies the project
  await page.goto(`${BASE}/project.html?id=P06`);
  await page.waitForSelector("h1");
  await page.click("a.btn");
  await page.waitForSelector("#context-summary strong");
  const pctx = await page.locator("#context-summary").innerText();
  check("R1.19 project inquiry identifies project", pctx.includes("Accessible Event Discovery") && pctx.includes("P06"), pctx);

  // keyboard reachability
  await page.goto(`${BASE}/index.html`);
  await page.waitForFunction(() => document.querySelectorAll("#results > li").length > 0, { timeout: 15000 });
  const seen = [];
  for (let i = 0; i < 12; i++) {
    await page.keyboard.press("Tab");
    seen.push(await page.evaluate(() => {
      const a = document.activeElement;
      return a ? `${a.tagName.toLowerCase()}${a.id ? "#" + a.id : ""}${a.name ? "[" + a.name + "]" : ""}` : "none";
    }));
  }
  check("R1.23 keyboard reaches search, skills and filters",
    seen.some(s => s.includes("#q")) && seen.some(s => s.includes("#skill")) &&
    seen.some(s => s.includes("availability")) && seen.some(s => s.includes("status")),
    seen.join(" > "));

  const labelled = await page.evaluate(() => {
    const ctrls = Array.from(document.querySelectorAll("input, select, textarea"));
    return ctrls.every(c => {
      if (c.type === "checkbox") return !!c.closest("label");
      return !!document.querySelector(`label[for="${c.id}"]`) || !!c.closest("label") || !!c.getAttribute("aria-label");
    });
  });
  check("R1.23 every form control has a label", labelled);

  // ---- Mobile pass at 390px
  const mobile = await browser.newPage({ viewport: { width: 390, height: 844 } });
  mobile.on("pageerror", (e) => errors.push("mobile: " + e.message));
  const noHScroll = async (url, name) => {
    await mobile.goto(url);
    await mobile.waitForTimeout(1500);
    const over = await mobile.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    check(`R1.22 no horizontal scroll at 390px — ${name}`, over <= 0, `overflow ${over}px`);
  };
  await noHScroll(`${BASE}/index.html`, "directory");
  await noHScroll(`${BASE}/student.html?id=S01`, "profile");
  await noHScroll(`${BASE}/project.html?id=P04`, "project");
  await noHScroll(`${BASE}/inquiry.html?source_type=student&source_id=S01&source_name=Avery%20Chen`, "inquiry");

  check("no uncaught JavaScript errors", errors.length === 0, errors.join(" | "));

  console.log(results.join("\n"));
  const failed = results.filter(r => r.startsWith("FAIL")).length;
  console.log(`\n${results.length - failed}/${results.length} checks passed`);
  await browser.close();
  process.exit(failed ? 1 : 0);
})();
