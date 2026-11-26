/*
 * Public partner page (R4.22 - R4.24).
 * Written for a visitor, not for staff: who the company is, how ImmXrsive
 * worked with them, what is happening now versus before, the student work
 * behind it, and a way to start a conversation. Every value is set as text.
 * The API never sends private collaborations, and a limited one arrives as a
 * summary only, so this page cannot show more than staff chose to publish.
 */
(async function partnerPage() {
  const root = document.getElementById("partner");
  const id = qs("id");

  function notFound(message) {
    root.innerHTML = "";
    root.appendChild(el("h1", { text: "Partner not found" }));
    root.appendChild(el("div", { class: "notice error", text: message }));
    root.appendChild(el("p", {}, [el("a", { class: "btn", href: "partners.html", text: "See all industry partners" })]));
    document.title = "Partner not found — ImmXrsive Talent Directory";
  }

  if (!id) return notFound("This link does not say which partner to show.");

  let p;
  try {
    p = await apiGet(`/api/partners/${encodeURIComponent(id)}`);
  } catch (err) {
    if (handleGone(root, err.gone, "partner.html", "Partner")) return;
    return notFound(err.notFound
      ? "This partner is not listed publicly. It may have been removed, or not published yet."
      : "This partner could not be loaded right now. Please try again in a moment.");
  }

  document.title = `${p.name} — Industry Partner — ImmXrsive Talent Directory`;
  root.innerHTML = "";
  root.appendChild(el("h1", { text: p.name }));
  mergedNotice(root);

  const current = p.collaborations.filter((c) => c.status === "current");
  const past = p.collaborations.filter((c) => c.status === "past");

  // R4.22 — the relationship in one plain sentence.
  let relationship = "";
  if (current.length) relationship = `ImmXrsive students are working with ${p.name} now.`;
  else if (past.length) relationship = `ImmXrsive students have worked with ${p.name} in the past.`;
  else if (p.projects.length) relationship = `${p.name} is an approved industry partner on student projects.`;
  if (relationship) root.appendChild(el("p", { class: "lede", text: relationship }));

  const about = el("section", { class: "panel" });
  about.appendChild(el("h2", { text: `About ${p.name}` }));
  if (p.description) about.appendChild(el("p", { class: "prose", text: p.description }));
  const facts = el("dl", { class: "facts" });
  const fact = (term, node) => {
    facts.appendChild(el("dt", { text: term }));
    facts.appendChild(el("dd", {}, [node]));
  };
  if (p.sector) fact("Sector", document.createTextNode(p.sector));
  if (p.location) fact("Location", document.createTextNode(p.location));
  if (p.website) fact("Website", externalLink(p.domain || p.website, p.website));
  if (facts.childNodes.length) about.appendChild(facts);
  if (p.keywords && p.keywords.length) about.appendChild(tagList(p.keywords));
  // R4.24 — the inquiry starts with this partner as its context.
  about.appendChild(el("p", {}, [
    el("a", {
      class: "btn",
      href: `inquiry.html?source_type=partner&source_id=${encodeURIComponent(p.id)}&source_name=${encodeURIComponent(p.name)}`,
      text: `Start a collaboration inquiry about ${p.name}`,
    }),
  ]));
  root.appendChild(about);

  function collaborationCard(c) {
    const li = el("li", { class: "card" });
    const years = yearRange(c.start_year, c.end_year, c.status);
    if (c.visibility === "limited") {
      // Only what staff chose to say publicly.
      li.appendChild(el("h3", { text: c.summary }));
      li.appendChild(el("p", { class: "meta", text: [years, "Details are kept confidential at the partner's request."].filter(Boolean).join(" · ") }));
      return li;
    }
    li.appendChild(el("h3", { text: c.title }));
    if (years) li.appendChild(el("p", { class: "meta", text: years }));
    if (c.description) li.appendChild(el("p", { class: "prose", text: c.description }));
    if (c.outcome) {
      li.appendChild(el("p", {}, [el("strong", { text: "Outcome: " }), document.createTextNode(c.outcome)]));
    }
    if (c.projects.length) {
      const pl = el("p", { class: "meta" }, [document.createTextNode("Student project: ")]);
      c.projects.forEach((proj, i) => {
        if (i) pl.appendChild(document.createTextNode(", "));
        pl.appendChild(el("a", { href: projectUrl(proj.id), text: proj.title }));
      });
      li.appendChild(pl);
    }
    if (c.students.length) {
      const sl = el("p", { class: "meta" }, [document.createTextNode("Students: ")]);
      c.students.forEach((s, i) => {
        if (i) sl.appendChild(document.createTextNode(", "));
        sl.appendChild(el("a", { href: studentUrl(s.id), text: s.name }));
      });
      li.appendChild(sl);
    }
    li.appendChild(el("p", {}, [
      el("a", {
        href: `inquiry.html?source_type=collaboration&source_id=${encodeURIComponent(c.id)}&partner_id=${encodeURIComponent(p.id)}&source_name=${encodeURIComponent(`${c.title} with ${p.name}`)}`,
        text: "Ask about work like this",
      }),
    ]));
    return li;
  }

  // R4.23 — current and past are separate sections; past work is kept, not deleted.
  for (const [heading, items, empty] of [
    ["Working together now", current, null],
    ["Past collaborations", past, null],
  ]) {
    if (!items.length) continue;
    const section = el("section");
    section.appendChild(el("h2", { text: heading }));
    const list = el("ul", { class: "cards" });
    items.forEach((c) => list.appendChild(collaborationCard(c)));
    section.appendChild(list);
    root.appendChild(section);
    void empty;
  }
  if (!current.length && !past.length) {
    root.appendChild(el("p", { class: "meta", text: "No collaboration details have been published for this partner yet." }));
  }

  if (p.projects.length) {
    const section = el("section");
    section.appendChild(el("h2", { text: "Student projects with this partner" }));
    const list = el("ul", { class: "cards" });
    for (const proj of p.projects) {
      const li = el("li", { class: "card" });
      li.appendChild(el("h3", {}, [el("a", { href: projectUrl(proj.id), text: proj.title })]));
      if (proj.description) li.appendChild(el("p", { class: "headline", text: proj.description }));
      list.appendChild(li);
    }
    section.appendChild(list);
    root.appendChild(section);
  }
})();
