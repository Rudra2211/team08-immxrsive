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

function showNotice(container, message, type = "error") {
  container.innerHTML = "";
  container.appendChild(el("div", { class: `notice ${type}`, role: "status", text: message }));
}
