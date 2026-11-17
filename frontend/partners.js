/* Public list of published industry partners (R4.22, R4.23). */
(async function partnersPage() {
  const root = document.getElementById("partners");
  let partners;
  try {
    partners = await apiGet("/api/partners");
  } catch {
    root.innerHTML = "";
    root.appendChild(el("div", { class: "notice error", text: "Industry partners could not be loaded right now. Please try again in a moment." }));
    return;
  }

  root.innerHTML = "";
  if (!partners.length) {
    root.appendChild(el("p", { class: "meta", text: "No industry partners have been published yet." }));
    return;
  }

  root.appendChild(el("p", {
    class: "result-count",
    role: "status",
    text: `${partners.length} ${partners.length === 1 ? "partner" : "partners"}`,
  }));
  const list = el("ul", { class: "cards" });
  for (const p of partners) {
    const card = el("li", { class: "card" });
    card.appendChild(el("h2", { class: "card-title" }, [el("a", { href: partnerUrl(p.id), text: p.name })]));
    // R4.23 — current and past relationships read differently at a glance.
    if (p.relationship === "current") card.appendChild(el("span", { class: "badge", text: "Working with us now" }));
    else if (p.relationship === "past") card.appendChild(el("span", { class: "badge past", text: "Past collaborator" }));
    const facts = [p.sector, p.location].filter(Boolean).join(" · ");
    if (facts) card.appendChild(el("p", { class: "meta", text: facts }));
    if (p.description) card.appendChild(el("p", { class: "headline", text: p.description }));
    if (p.collaboration_count) {
      card.appendChild(el("p", {
        class: "meta",
        text: `${p.collaboration_count} ${p.collaboration_count === 1 ? "collaboration" : "collaborations"} with ImmXrsive students`,
      }));
    }
    list.appendChild(card);
  }
  root.appendChild(list);
})();
