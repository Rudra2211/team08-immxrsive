/* Talent directory: search, filters, active-filter chips, result cards. */
const form = document.getElementById("filters");
const qInput = document.getElementById("q");
const skillSelect = document.getElementById("skill");
const clearBtn = document.getElementById("clear");
const resultsEl = document.getElementById("results");
const countEl = document.getElementById("result-count");
const errorEl = document.getElementById("results-error");
const activeEl = document.getElementById("active-filters");
const termsEl = document.getElementById("q-terms");
const skillChipsEl = document.getElementById("skill-chips");

// Search terms are kept as removable chips. The API matches students who
// have every term (in name, headline or skills), so more terms narrow results.
let terms = [];

function addTerms(text) {
  for (const t of String(text).split(/[\s,]+/).filter(Boolean)) {
    if (!terms.some((x) => x.toLowerCase() === t.toLowerCase())) terms.push(t);
  }
}

function removableChip(label, ariaLabel, onRemove) {
  const btn = el("button", { type: "button", "aria-label": ariaLabel, text: "\u00d7" });
  btn.addEventListener("click", onRemove);
  return el("li", { class: "term-chip" }, [el("span", { text: label }), btn]);
}

function renderTermChips() {
  termsEl.innerHTML = "";
  for (const t of terms) {
    termsEl.appendChild(removableChip(t, `Remove search term ${t}`, () => {
      terms = terms.filter((x) => x !== t);
      renderTermChips();
      apply();
      qInput.focus();
    }));
  }
}

function renderSkillChips() {
  skillChipsEl.innerHTML = "";
  for (const o of Array.from(skillSelect.selectedOptions)) {
    skillChipsEl.appendChild(removableChip(o.value, `Remove skill ${o.value}`, () => {
      o.selected = false;
      renderSkillChips();
      apply();
      skillSelect.focus();
    }));
  }
}

function currentFilters() {
  return {
    q: terms.join(" "),
    skill: Array.from(skillSelect.selectedOptions).map((o) => o.value),
    availability: Array.from(form.querySelectorAll('input[name="availability"]:checked')).map((i) => i.value),
    status: Array.from(form.querySelectorAll('input[name="status"]:checked')).map((i) => i.value),
    talent: form.querySelector('input[name="talent"]:checked') ? "active" : "",
  };
}

/** Filters live in the page URL, so a filtered view is shareable and survives reload. */
function filtersToQuery(f) {
  const p = new URLSearchParams();
  if (f.q) p.set("q", f.q);
  for (const s of f.skill) p.append("skill", s);
  for (const a of f.availability) p.append("availability", a);
  for (const s of f.status) p.append("status", s);
  if (f.talent) p.set("talent", f.talent);
  return p;
}

function applyQueryToForm() {
  const p = new URLSearchParams(window.location.search);
  terms = [];
  addTerms(p.get("q") || "");
  qInput.value = "";
  renderTermChips();
  const skills = p.getAll("skill");
  for (const opt of skillSelect.options) opt.selected = skills.includes(opt.value);
  renderSkillChips();
  const avail = p.getAll("availability");
  const status = p.getAll("status");
  form.querySelectorAll('input[name="availability"]').forEach((i) => { i.checked = avail.includes(i.value); });
  form.querySelectorAll('input[name="status"]').forEach((i) => { i.checked = status.includes(i.value); });
  form.querySelector('input[name="talent"]').checked = p.get("talent") === "active";
}

function renderActiveFilters(f) {
  activeEl.innerHTML = "";
  const chips = [];
  for (const t of f.q.split(" ").filter(Boolean)) chips.push(`Search: “${t}”`);
  for (const s of f.skill) chips.push(`Skill: ${s}`);
  for (const a of f.availability) chips.push(`Availability: ${titleCase(a)}`);
  for (const s of f.status) chips.push(`Status: ${titleCase(s)}`);
  if (f.talent) chips.push("Active Talent only");

  if (chips.length === 0) {
    activeEl.appendChild(el("span", { class: "meta", text: "No filters applied." }));
    return;
  }
  activeEl.appendChild(el("span", { class: "meta", text: "Active filters:" }));
  for (const c of chips) activeEl.appendChild(el("span", { class: "chip", text: c }));
}

function studentCard(s) {
  const li = el("li", { class: "card" });

  const h3 = el("h3");
  h3.appendChild(el("a", { href: studentUrl(s.id), text: s.name }));
  li.appendChild(h3);

  li.appendChild(el("p", { class: "headline", text: s.headline || "" }));

  const label = s.talent_state === "active" ? "Active Talent · Available for: " : "";
  li.appendChild(el("p", { class: "meta", text: `${titleCase(s.status)} · ${label}${availabilityText(s)}` }));

  li.appendChild(tagList((s.skills || []).slice(0, 6)));

  const n = Number(s.project_count || 0);
  li.appendChild(el("p", { class: "meta" }, [
    el("span", { class: "badge", text: `${n} project${n === 1 ? "" : "s"} of evidence` }),
  ]));

  return li;
}

async function loadSkills() {
  try {
    const skills = await apiGet("/api/skills");
    for (const name of skills) {
      skillSelect.appendChild(el("option", { value: name, text: name }));
    }
  } catch (err) {
    console.error("Could not load skills:", err);
    skillSelect.appendChild(el("option", { value: "", text: "Skill list unavailable" }));
  }
}

// F.28 — one page at a time, so the first load stays the same size however
// many students the platform holds.
const PAGE = 24;
const moreBtn = document.getElementById("load-more");
let shown = 0;
let latest = 0; // only the newest request may draw results

async function loadStudents(append = false) {
  const ticket = ++latest;
  const f = currentFilters();
  if (!append) {
    renderActiveFilters(f);
    shown = 0;
  }
  errorEl.innerHTML = "";
  if (!append) countEl.textContent = "Loading students…";
  moreBtn.hidden = true;

  try {
    const query = filtersToQuery(f);
    query.set("limit", String(PAGE));
    if (shown) query.set("offset", String(shown));
    const data = await apiGet(`/api/students?${query.toString()}`);
    if (ticket !== latest) return;
    const total = Number.isFinite(data.total) ? data.total : data.length;
    if (!append) resultsEl.innerHTML = "";

    if (data.length === 0 && !append) {
      countEl.textContent = "No students match these filters.";
      errorEl.appendChild(el("div", {
        class: "notice info",
        text: "Try removing a skill, widening availability, or clearing the search box.",
      }));
      return;
    }

    for (const s of data) resultsEl.appendChild(studentCard(s));
    if (!append && window.ImmOrbit) window.ImmOrbit.show(data);
    shown += data.length;
    countEl.textContent = `${total} student${total === 1 ? "" : "s"} found${shown < total ? ` — showing ${shown}` : ""}.`;
    moreBtn.hidden = shown >= total;
    if (append && data[0]) {
      // Keyboard users continue from the first new result.
      const first = resultsEl.children[shown - data.length].querySelector("a");
      if (first) first.focus();
    }
  } catch (err) {
    if (ticket !== latest) return;
    console.error(err);
    resultsEl.innerHTML = "";
    countEl.textContent = "";
    showNotice(errorEl, "Could not load the directory right now. The service may still be starting up — please retry in a moment.");
  }
}

moreBtn.addEventListener("click", () => loadStudents(true));

function apply() {
  const query = filtersToQuery(currentFilters()).toString();
  const url = query ? `?${query}` : window.location.pathname;
  window.history.replaceState({}, "", url);
  loadStudents();
}

// Enter in the search box submits: whatever was typed becomes chips.
form.addEventListener("submit", (e) => {
  e.preventDefault();
  addTerms(qInput.value);
  qInput.value = "";
  renderTermChips();
  apply();
});

// One click picks or un-picks a skill (no Ctrl needed); Ctrl/Shift-click keep
// the browser's own range selection.
skillSelect.addEventListener("mousedown", (e) => {
  const o = e.target;
  if (!(o instanceof HTMLOptionElement) || e.ctrlKey || e.metaKey || e.shiftKey) return;
  e.preventDefault();
  const top = skillSelect.scrollTop;
  o.selected = !o.selected;
  skillSelect.focus();
  skillSelect.scrollTop = top;
  skillSelect.dispatchEvent(new Event("change", { bubbles: true }));
});
skillSelect.addEventListener("change", () => { renderSkillChips(); apply(); });

clearBtn.addEventListener("click", () => {
  qInput.value = "";
  terms = [];
  renderTermChips();
  for (const opt of skillSelect.options) opt.selected = false;
  renderSkillChips();
  form.querySelectorAll('input[type="checkbox"]').forEach((i) => { i.checked = false; });
  window.history.replaceState({}, "", window.location.pathname);
  loadStudents();
  qInput.focus();
});

(async function start() {
  await loadSkills();
  applyQueryToForm();
  await loadStudents();
})();
