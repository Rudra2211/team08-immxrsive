/* Student profile: professional shell, project evidence, contextual inquiry. */
const root = document.getElementById("profile");
const id = qs("id");

function notFound(message) {
  root.innerHTML = "";
  root.appendChild(el("h1", { text: "Student not found" }));
  root.appendChild(el("div", { class: "notice error", text: message }));
  root.appendChild(el("p", {}, [el("a", { class: "btn", href: "index.html", text: "Browse the talent directory" })]));
  document.title = "Student not found — ImmXrsive Talent Directory";
}

function render(s) {
  document.title = `${s.name} — ImmXrsive Talent Directory`;
  root.innerHTML = "";

  root.appendChild(el("h1", { text: s.name }));
  root.appendChild(el("p", { class: "lede", text: s.headline || "" }));

  const panel = el("div", { class: "panel" });
  const facts = el("dl", { class: "facts" });
  const addFact = (term, value) => {
    facts.appendChild(el("dt", { text: term }));
    facts.appendChild(el("dd", { text: value }));
  };
  addFact("Status", titleCase(s.status));
  addFact("Program", s.program || "Not stated");
  addFact("Availability", (s.availability || []).map(titleCase).join(", ") || "Not stated");
  panel.appendChild(facts);

  panel.appendChild(el("h2", { text: "Skills" }));
  panel.appendChild(tagList(s.skills));

  const links = Object.entries(s.links || {});
  panel.appendChild(el("h2", { text: "Professional links" }));
  if (links.length === 0) {
    panel.appendChild(el("p", { class: "meta", text: "No public links provided." }));
  } else {
    const ul = el("ul", { class: "tags" });
    for (const [label, url] of links) {
      ul.appendChild(el("li", {}, [externalLink(titleCase(label), url)]));
    }
    panel.appendChild(ul);
  }

  panel.appendChild(el("p", {}, [
    el("a", {
      class: "btn",
      href: inquiryUrl("student", s.id, s.name),
      text: `Interested in working with ${s.name.split(" ")[0]}?`,
    }),
  ]));
  root.appendChild(panel);

  root.appendChild(el("h2", { text: "Project evidence" }));
  if (!s.projects || s.projects.length === 0) {
    root.appendChild(el("p", { class: "meta", text: "No public projects recorded for this student yet." }));
    return;
  }

  const list = el("ul", { class: "cards" });
  for (const p of s.projects) {
    const li = el("li", { class: "card" });
    const h3 = el("h3");
    h3.appendChild(el("a", { href: projectUrl(p.id), text: p.title }));
    li.appendChild(h3);
    li.appendChild(el("p", { class: "meta", text: `Role on this project: ${p.role || "Contributor"}` }));
    li.appendChild(el("p", { class: "headline", text: p.description || "" }));
    li.appendChild(tagList(p.technologies));
    list.appendChild(li);
  }
  root.appendChild(list);
}

(async function start() {
  if (!id) {
    notFound("No student was specified in the address.");
    return;
  }
  try {
    render(await apiGet(`/api/students/${encodeURIComponent(id)}`));
  } catch (err) {
    if (err.notFound) {
      notFound(`We could not find a published profile with the id “${id}”. It may have been removed or the link may be mistyped.`);
    } else {
      console.error(err);
      root.innerHTML = "";
      showNotice(root, "Could not load this profile right now. The service may still be starting up — please retry in a moment.");
    }
  }
})();
