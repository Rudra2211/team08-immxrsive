/*
 * Simulated company intake (company_intake_simulation.md).
 * The product supplies source_type, source_id, source_name and source_url
 * automatically; the employer only fills in their own details (R1.18, R1.19).
 */
const form = document.getElementById("inquiry-form");
const summary = document.getElementById("context-summary");
const breadcrumb = document.getElementById("breadcrumb");
const messageEl = document.getElementById("form-message");
const submitBtn = document.getElementById("submit-btn");

const sourceType = qs("source_type");
const sourceId = qs("source_id");
let sourceName = qs("source_name") || "";

function sourceUrlFor(type, id) {
  const page = type === "project" ? projectUrl(id) : studentUrl(id);
  return new URL(page, window.location.href).toString();
}

function renderContextError(message) {
  summary.textContent = "";
  summary.appendChild(el("span", { class: "notice error", text: message }));
  form.hidden = true;
}

async function loadContext() {
  if (!sourceType || !sourceId || !["student", "project"].includes(sourceType)) {
    renderContextError("This inquiry link is missing its context. Please open an inquiry from a student profile or a project page.");
    return false;
  }

  try {
    if (sourceType === "student") {
      const s = await apiGet(`/api/students/${encodeURIComponent(sourceId)}`);
      sourceName = s.name;
      summary.textContent = "";
      summary.appendChild(el("strong", { text: s.name }));
      summary.appendChild(document.createTextNode(` — ${s.headline || "Student profile"} (${sourceId})`));
      breadcrumb.innerHTML = "";
      breadcrumb.appendChild(el("a", { href: studentUrl(sourceId), text: `← Back to ${s.name}'s profile` }));
    } else {
      const p = await apiGet(`/api/projects/${encodeURIComponent(sourceId)}`);
      sourceName = p.title;
      summary.textContent = "";
      summary.appendChild(el("strong", { text: p.title }));
      summary.appendChild(document.createTextNode(` — project (${sourceId})`));
      summary.appendChild(el("p", {
        class: "help",
        text: "This inquiry is about the project as a whole, not a single contributor.",
      }));
      breadcrumb.innerHTML = "";
      breadcrumb.appendChild(el("a", { href: projectUrl(sourceId), text: `← Back to ${p.title}` }));
    }
    document.title = `Inquiry about ${sourceName} — ImmXrsive Talent Directory`;
    return true;
  } catch (err) {
    if (err.notFound) {
      renderContextError(`We could not find ${sourceType} “${sourceId}”. Please start the inquiry from a current profile or project page.`);
    } else {
      renderContextError("Could not load the inquiry context right now. Please retry in a moment.");
    }
    return false;
  }
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  messageEl.innerHTML = "";

  const payload = {
    source_type: sourceType,
    source_id: sourceId,
    source_name: sourceName,
    source_url: sourceUrlFor(sourceType, sourceId),
    company_name: document.getElementById("company_name").value.trim(),
    contact_name: document.getElementById("contact_name").value.trim(),
    contact_email: document.getElementById("contact_email").value.trim(),
    description: document.getElementById("description").value.trim(),
  };

  const missing = ["company_name", "contact_name", "contact_email", "description"].filter((k) => !payload[k]);
  if (missing.length) {
    showNotice(messageEl, "Please complete every field before sending.");
    document.getElementById(missing[0]).focus();
    return;
  }

  submitBtn.disabled = true;
  try {
    const res = await fetch(`${API}/api/inquiries`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      showNotice(messageEl, data.error || "Could not send the inquiry. Please try again.");
      return;
    }
    form.reset();
    showNotice(
      messageEl,
      `Thank you. Your inquiry about ${sourceName} has been sent to ImmXrsive, who will reply by email.`,
      "success"
    );
    messageEl.firstChild.setAttribute("tabindex", "-1");
    messageEl.firstChild.focus();
  } catch (err) {
    console.error(err);
    showNotice(messageEl, "Could not reach the service. Please check your connection and try again.");
  } finally {
    submitBtn.disabled = false;
  }
});

(async function start() {
  const ok = await loadContext();
  if (!ok) submitBtn.disabled = true;
})();
