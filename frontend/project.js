/* Project page: description, contributors with roles, technologies, links. */
const root = document.getElementById("project");
const id = qs("id");

function notFound(message) {
  root.innerHTML = "";
  root.appendChild(el("h1", { text: "Project not found" }));
  root.appendChild(el("div", { class: "notice error", text: message }));
  root.appendChild(el("p", {}, [el("a", { class: "btn", href: "index.html", text: "Browse the talent directory" })]));
  document.title = "Project not found — ImmXrsive Talent Directory";
}

function render(p) {
  document.title = `${p.title} — ImmXrsive Talent Directory`;
  root.innerHTML = "";

  root.appendChild(el("h1", { text: p.title }));
  if (p.domain) root.appendChild(el("p", { class: "lede", text: p.domain }));

  const panel = el("div", { class: "panel" });
  panel.appendChild(el("p", { text: p.description || "No description provided." }));

  panel.appendChild(el("h2", { text: "Technologies used" }));
  panel.appendChild(tagList(p.technologies));
  panel.appendChild(el("p", {
    class: "help",
    text: "Technologies describe the project. They are not automatically claimed as any contributor's personal skill.",
  }));

  const links = Object.entries(p.links || {});
  panel.appendChild(el("h2", { text: "Links and media" }));
  if (links.length === 0) {
    panel.appendChild(el("p", { class: "meta", text: "No public links provided." }));
  } else {
    const ul = el("ul", { class: "tags" });
    for (const [label, url] of links) {
      ul.appendChild(el("li", {}, [externalLink(titleCase(label), url)]));
    }
    panel.appendChild(ul);
    panel.appendChild(el("p", { class: "help", text: "External links open in a new tab and are maintained by their owners." }));
  }

  // Inquiry from a project identifies the PROJECT, not one arbitrary contributor (R1.19).
  panel.appendChild(el("p", {}, [
    el("a", { class: "btn", href: inquiryUrl("project", p.id, p.title), text: "Enquire about this project" }),
  ]));
  root.appendChild(panel);

  root.appendChild(el("h2", { text: "Contributors" }));
  if (!p.contributors || p.contributors.length === 0) {
    root.appendChild(el("p", { class: "meta", text: "No published contributors are listed for this project." }));
    return;
  }

  const list = el("ul", { class: "cards" });
  for (const c of p.contributors) {
    const li = el("li", { class: "card" });
    const h3 = el("h3");
    h3.appendChild(el("a", { href: studentUrl(c.student_id), text: c.name }));
    li.appendChild(h3);
    li.appendChild(el("p", { class: "meta", text: `Role: ${c.role || "Contributor"}` }));
    li.appendChild(el("p", { class: "headline", text: c.headline || "" }));
    list.appendChild(li);
  }
  root.appendChild(list);
}

(async function start() {
  if (!id) {
    notFound("No project was specified in the address.");
    return;
  }
  try {
    render(await apiGet(`/api/projects/${encodeURIComponent(id)}`));
  } catch (err) {
    if (err.notFound) {
      notFound(`We could not find a project with the id “${id}”. It may have been removed or the link may be mistyped.`);
    } else {
      console.error(err);
      root.innerHTML = "";
      showNotice(root, "Could not load this project right now. The service may still be starting up — please retry in a moment.");
    }
  }
})();
