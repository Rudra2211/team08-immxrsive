/* Talent directory: search, filters, active-filter chips, result cards. */
const form = document.getElementById("filters");
const qInput = document.getElementById("q");
const skillSelect = document.getElementById("skill");
const clearBtn = document.getElementById("clear");
const resultsEl = document.getElementById("results");
const countEl = document.getElementById("result-count");
const errorEl = document.getElementById("results-error");
const activeEl = document.getElementById("active-filters");

function currentFilters() {
  return {
    q: qInput.value.trim(),
    skill: Array.from(skillSelect.selectedOptions).map((o) => o.value),
    availability: Array.from(form.querySelectorAll('input[name="availability"]:checked')).map((i) => i.value),
    status: Array.from(form.querySelectorAll('input[name="status"]:checked')).map((i) => i.value),
  };
}

/** Filters live in the page URL, so a filtered view is shareable and survives reload. */
function filtersToQuery(f) {
  const p = new URLSearchParams();
  if (f.q) p.set("q", f.q);
  for (const s of f.skill) p.append("skill", s);
  for (const a of f.availability) p.append("availability", a);
  for (const s of f.status) p.append("status", s);
  return p;
}

function applyQueryToForm() {
  const p = new URLSearchParams(window.location.search);
  qInput.value = p.get("q") || "";
  const skills = p.getAll("skill");
  for (const opt of skillSelect.options) opt.selected = skills.includes(opt.value);
  const avail = p.getAll("availability");
  const status = p.getAll("status");
  form.querySelectorAll('input[name="availability"]').forEach((i) => { i.checked = avail.includes(i.value); });
  form.querySelectorAll('input[name="status"]').forEach((i) => { i.checked = status.includes(i.value); });
}

function renderActiveFilters(f) {
  activeEl.innerHTML = "";
  const chips = [];
  if (f.q) chips.push(`Search: “${f.q}”`);
  for (const s of f.skill) chips.push(`Skill: ${s}`);
  for (const a of f.availability) chips.push(`Availability: ${titleCase(a)}`);
  for (const s of f.status) chips.push(`Status: ${titleCase(s)}`);

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

  const availability = (s.availability || []).map(titleCase).join(", ") || "Not stated";
  li.appendChild(el("p", { class: "meta", text: `${titleCase(s.status)} · Available for: ${availability}` }));

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

async function loadStudents() {
  const f = currentFilters();
  renderActiveFilters(f);
  errorEl.innerHTML = "";
  countEl.textContent = "Loading students…";

  try {
    const query = filtersToQuery(f).toString();
    const data = await apiGet(`/api/students${query ? `?${query}` : ""}`);
    resultsEl.innerHTML = "";

    if (data.length === 0) {
      countEl.textContent = "No students match these filters.";
      errorEl.appendChild(el("div", {
        class: "notice info",
        text: "Try removing a skill, widening availability, or clearing the search box.",
      }));
      return;
    }

    countEl.textContent = `${data.length} student${data.length === 1 ? "" : "s"} found.`;
    for (const s of data) resultsEl.appendChild(studentCard(s));
  } catch (err) {
    console.error(err);
    resultsEl.innerHTML = "";
    countEl.textContent = "";
    showNotice(errorEl, "Could not load the directory right now. The service may still be starting up — please retry in a moment.");
  }
}

form.addEventListener("submit", (e) => {
  e.preventDefault();
  const query = filtersToQuery(currentFilters()).toString();
  const url = query ? `?${query}` : window.location.pathname;
  window.history.replaceState({}, "", url);
  loadStudents();
});

clearBtn.addEventListener("click", () => {
  qInput.value = "";
  for (const opt of skillSelect.options) opt.selected = false;
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
