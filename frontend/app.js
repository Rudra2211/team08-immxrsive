/* Shared helpers for every page. */
const API = window.APP_CONFIG.API_BASE_URL.replace(/\/+$/, "");

function qs(name) {
  return new URLSearchParams(window.location.search).get(name);
}

async function apiGet(path) {
  const res = await fetch(`${API}${path}`);
  if (res.status === 404) {
    const err = new Error("not-found");
    err.notFound = true;
    throw err;
  }
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === "class") node.className = v;
    else if (k === "text") node.textContent = v;
    else if (k === "html") node.innerHTML = v;
    else node.setAttribute(k, v);
  }
  for (const child of [].concat(children)) {
    if (child) node.appendChild(child);
  }
  return node;
}

function tagList(items, extraClass = "") {
  const ul = el("ul", { class: `tags ${extraClass}`.trim() });
  for (const item of items || []) ul.appendChild(el("li", { class: "tag", text: item }));
  return ul;
}

function studentUrl(id) { return `student.html?id=${encodeURIComponent(id)}`; }
function projectUrl(id) { return `project.html?id=${encodeURIComponent(id)}`; }
function inquiryUrl(type, id, name) {
  return `inquiry.html?source_type=${encodeURIComponent(type)}&source_id=${encodeURIComponent(id)}&source_name=${encodeURIComponent(name)}`;
}

function titleCase(s) {
  return String(s).replace(/(^|[\s-])\w/g, (m) => m.toUpperCase());
}

/**
 * Renders an external link so that a dead or missing URL degrades to plain
 * text instead of breaking the page (R1.24).
 */
function externalLink(label, url) {
  const safe = typeof url === "string" ? url.trim() : "";
  if (!/^https?:\/\//i.test(safe)) {
    return el("span", { class: "meta", text: `${label} (link unavailable)` });
  }
  return el("a", { href: safe, rel: "noopener noreferrer nofollow", target: "_blank", text: label });
}

/** The four sections a student can reorder (R2.23). */
const PROFILE_SECTIONS = ["about", "skills", "projects", "experience"];

/**
 * R2.19, R2.20, R2.24 — one renderer for the public shape of a profile, used
 * by the public page and by the owner's preview, so a preview cannot drift
 * from what a visitor actually receives.
 *
 * A field the student keeps private is ABSENT from the API response. Absent
 * means the row or the whole section is not rendered: no heading, no
 * "undefined", no placeholder. Every value is written as text (R2.25).
 *
 * options.inquiry   — add the "interested in working with" call to action
 * options.projects  — false to leave the project evidence section out
 * options.nameTag / options.sectionTag — heading levels, so the preview can
 *   sit under an existing h2 without breaking the heading outline (R2.27)
 */
function profileBody(s, options = {}) {
  const sectionTag = options.sectionTag || "h2";
  const subTag = sectionTag === "h2" ? "h3" : "h4";
  const frag = document.createDocumentFragment();

  frag.appendChild(el(options.nameTag || "h1", { text: s.name || "Unnamed student" }));
  if (s.headline) frag.appendChild(el("p", { class: "lede", text: s.headline }));

  const panel = el("div", { class: "panel" });
  const facts = el("dl", { class: "facts" });
  const fact = (term, node) => {
    facts.appendChild(el("dt", { text: term }));
    facts.appendChild(el("dd", {}, [node]));
  };
  const asText = (value) => document.createTextNode(String(value));

  fact("Status", asText(titleCase(s.status || "Not stated")));
  fact("Program", asText(s.program || "Not stated"));
  if (s.availability) {
    fact("Availability", asText(s.availability.map(titleCase).join(", ") || "Not stated"));
  }
  if (s.location_text) fact("Location", asText(s.location_text));
  if (s.contact_email) {
    fact("Contact", el("a", { href: `mailto:${s.contact_email}`, text: s.contact_email }));
  }
  panel.appendChild(facts);

  if (s.links) {
    panel.appendChild(el(sectionTag, { text: "Professional links" }));
    const entries = Object.entries(s.links);
    if (entries.length === 0) {
      panel.appendChild(el("p", { class: "meta", text: "No public links provided." }));
    } else {
      const ul = el("ul", { class: "tags" });
      for (const [label, url] of entries) {
        ul.appendChild(el("li", {}, [externalLink(titleCase(label), url)]));
      }
      panel.appendChild(ul);
    }
  }

  if (options.inquiry) {
    panel.appendChild(el("p", {}, [
      el("a", {
        class: "btn",
        href: inquiryUrl("student", s.id, s.name),
        text: `Interested in working with ${String(s.name || "this student").split(" ")[0]}?`,
      }),
    ]));
  }
  frag.appendChild(panel);

  // R2.23 — the student's own order. Unknown values are dropped and missing
  // ones appended, so a stale stored order can neither lose a section nor
  // render one twice.
  const order = (Array.isArray(s.section_order) ? s.section_order : []).filter(
    (k, i, a) => PROFILE_SECTIONS.includes(k) && a.indexOf(k) === i
  );
  for (const k of PROFILE_SECTIONS) if (!order.includes(k)) order.push(k);

  for (const key of order) {
    const node = profileSection(key, s, { sectionTag, subTag, projects: options.projects !== false });
    if (node) frag.appendChild(node);
  }
  return frag;
}

/** One public section, or null when the student has nothing public to show. */
function profileSection(key, s, o) {
  const section = el("section");

  if (key === "about") {
    if (!s.bio && !s.education) return null;
    section.appendChild(el(o.sectionTag, { text: "About" }));
    if (s.bio) section.appendChild(el("p", { class: "prose", text: s.bio }));
    if (s.education) {
      section.appendChild(el(o.subTag, { text: "Education" }));
      section.appendChild(el("p", { class: "prose", text: s.education }));
    }
    return section;
  }

  if (key === "skills") {
    section.appendChild(el(o.sectionTag, { text: "Skills" }));
    const skills = s.skills || [];
    section.appendChild(
      skills.length ? tagList(skills) : el("p", { class: "meta", text: "No skills listed yet." })
    );
    return section;
  }

  if (key === "experience") {
    if (!s.experience) return null;
    section.appendChild(el(o.sectionTag, { text: "Experience" }));
    section.appendChild(el("p", { class: "prose", text: s.experience }));
    return section;
  }

  if (key === "projects") {
    if (!o.projects) return null;
    section.appendChild(el(o.sectionTag, { text: "Project evidence" }));
    const projects = s.projects || [];
    if (projects.length === 0) {
      section.appendChild(
        el("p", { class: "meta", text: "No public projects recorded for this student yet." })
      );
      return section;
    }
    const list = el("ul", { class: "cards" });
    for (const p of projects) {
      const li = el("li", { class: "card" });
      li.appendChild(el(o.subTag, {}, [el("a", { href: projectUrl(p.id), text: p.title })]));
      li.appendChild(el("p", { class: "meta", text: `Role on this project: ${p.role || "Contributor"}` }));
      li.appendChild(el("p", { class: "headline", text: p.description || "" }));
      li.appendChild(tagList(p.technologies));
      list.appendChild(li);
    }
    section.appendChild(list);
    return section;
  }

  return null;
}

function showNotice(container, message, type = "error") {
  container.innerHTML = "";
  container.appendChild(el("div", { class: `notice ${type}`, role: "status", text: message }));
}
