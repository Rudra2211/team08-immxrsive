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
  // R2.23 — the chosen preset is a data attribute, so the themes stay in CSS.
  document.documentElement.setAttribute("data-theme", s.theme || "classic");
  root.innerHTML = "";
  // The shared renderer in app.js draws every field, respects section_order,
  // and leaves out whatever the student kept private (R2.19, R2.28).
  root.appendChild(profileBody(s, { inquiry: true }));
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
