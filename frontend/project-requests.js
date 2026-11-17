/*
 * Project editor: verification and industry-partner requests (R4.04, R4.19, R4.20).
 * The maintainer can ask; every contributor sees the status. Staff decide.
 */
(async function projectRequests() {
  const $ = (x) => document.getElementById(x);
  const projectId = qs("id");
  if (!projectId) return;
  const STATUS = { pending: "Waiting for staff review", approved: "Approved", rejected: "Not approved" };

  function when(iso) {
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
  }
  function say(message, type = "error") {
    const n = $("notice");
    showNotice(n, message, type);
    n.scrollIntoView({ block: "nearest" });
  }
  function historyRow(title, r) {
    return el("li", { class: "stack" }, [
      el("p", { text: title }),
      el("p", { class: "meta", text: `${STATUS[r.status] || r.status} · asked ${when(r.created_at)}${r.decided_at ? ` · decided ${when(r.decided_at)}` : ""}` }),
      r.decision_note ? el("p", { class: "prose", text: `Staff note: ${r.decision_note}` }) : null,
    ]);
  }

  let companies = [];
  async function load() {
    let d;
    try {
      d = await apiCall(`/api/my/projects/${encodeURIComponent(projectId)}/requests`);
    } catch {
      return; // not signed in or not on the project: the main editor already explains
    }
    $("official-panel").hidden = false;
    $("official-help").textContent = d.is_maintainer
      ? "As maintainer you can ask ImmXrsive staff to verify this project or confirm a company it worked with. Nothing appears publicly until staff approve it."
      : "Only the project maintainer can send these requests. You can see their status here.";

    const pending = d.verification_requests.some((r) => r.status === "pending");
    $("verify-status").textContent = d.verified
      ? `Verified by ImmXrsive on ${when(d.verified_at)}. The badge shows on the public project page.`
      : pending ? "A verification request is waiting for staff review." : "This project is not officially verified.";
    const vh = $("verify-history");
    vh.innerHTML = "";
    d.verification_requests.forEach((r) => vh.appendChild(historyRow("Verification request", r)));
    $("verify-form").hidden = !d.is_maintainer || d.verified || pending;

    const ph = $("partner-history");
    ph.innerHTML = "";
    if (!d.partner_requests.length) ph.appendChild(el("li", {}, [el("span", { class: "meta", text: "No industry partners added yet." })]));
    d.partner_requests.forEach((r) => ph.appendChild(historyRow(r.company_name, r)));
    $("partner-form").hidden = !d.is_maintainer;

    if (d.is_maintainer && !companies.length) {
      try {
        companies = await apiCall("/api/companies/options");
      } catch {
        companies = [];
      }
      const sel = $("partner-company");
      sel.innerHTML = "";
      sel.appendChild(el("option", { value: "", text: "Choose a company" }));
      companies.forEach((c) => sel.appendChild(el("option", { value: c.id, text: c.name })));
      sel.appendChild(el("option", { value: "__new", text: "It is not listed — suggest a company" }));
    }
  }

  $("partner-company").addEventListener("change", () => {
    $("partner-suggest").hidden = $("partner-company").value !== "__new";
  });

  $("verify-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    $("verify-btn").disabled = true;
    try {
      await apiCall(`/api/my/projects/${encodeURIComponent(projectId)}/verification-request`, {
        method: "POST",
        body: { note: $("verify-note").value.trim(), evidence_url: $("verify-evidence").value.trim() },
      });
      $("verify-note").value = "";
      $("verify-evidence").value = "";
      say("Verification requested. Staff will review it; the badge appears only if they approve.", "success");
      await load();
    } catch (err) {
      say(err.message);
    } finally {
      $("verify-btn").disabled = false;
    }
  });

  $("partner-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const choice = $("partner-company").value;
    if (!choice) return say("Choose the company, or pick “suggest a company”.");
    const body = { explanation: $("partner-explanation").value.trim() };
    if (choice === "__new") {
      body.suggested_name = $("partner-name").value.trim();
      body.suggested_website = $("partner-website").value.trim();
    } else {
      body.company_id = choice;
    }
    $("partner-btn").disabled = true;
    try {
      await apiCall(`/api/my/projects/${encodeURIComponent(projectId)}/partner-requests`, { method: "POST", body });
      $("partner-explanation").value = "";
      $("partner-name").value = "";
      $("partner-website").value = "";
      $("partner-company").value = "";
      $("partner-suggest").hidden = true;
      say("Sent to staff for review. The company appears on your project page once they approve it.", "success");
      await load();
    } catch (err) {
      say(err.message);
    } finally {
      $("partner-btn").disabled = false;
    }
  });

  await load();
})();
