/*
 * Staff records page (Final Release): legacy import and report (F.01-F.03),
 * profile claims and owner recovery (F.08-F.10), alumni status (F.11),
 * duplicate merge (F.17), maintainer recovery (F.19) and diagnostics (F.32).
 * Every action is checked again on the server; this page only asks.
 */
(async function records() {
  const $ = (id) => document.getElementById(id);
  const notice = $("notice");
  const say = (message, type = "error") => {
    showNotice(notice, message, type);
    notice.scrollIntoView({ block: "nearest" });
  };
  const when = (iso) => (iso ? new Date(iso).toLocaleString() : "");
  const text = (t) => document.createTextNode(t);

  let me;
  try {
    me = await apiCall("/api/me");
  } catch {
    return say("The staff workspace could not be reached. Check your connection and reload.");
  }
  if (!me.signed_in || me.role !== "staff") {
    say(me.signed_in ? "This area is only for ImmXrsive staff." : "Sign in with your staff account first.");
    notice.appendChild(el("p", {}, [el("a", { class: "btn", href: "staff-login.html", text: "Go to staff sign-in" })]));
    return;
  }
  $("who").textContent = `Signed in as ${me.github_login} (staff)`;
  $("workspace").hidden = false;

  /** Runs one staff action with its button disabled, then reports the result. */
  async function act(btn, fn, success) {
    btn.disabled = true;
    try {
      const out = await fn();
      say(typeof success === "function" ? success(out) : success, "success");
      return out;
    } catch (err) {
      say(err.message);
      return null;
    } finally {
      btn.disabled = false;
    }
  }

  // ---- claims --------------------------------------------------------------
  async function loadClaims() {
    const list = $("claims-list");
    list.innerHTML = "";
    let claims = [];
    try {
      claims = await apiCall("/api/staff/claims");
    } catch (err) {
      return say(err.message);
    }
    const pending = claims.filter((c) => c.status === "pending");
    $("claims-count").textContent = pending.length ? `(${pending.length} waiting)` : "";
    if (!claims.length) list.appendChild(el("li", {}, [el("span", { class: "meta", text: "No claims yet." })]));
    for (const c of claims) {
      const li = el("li", { class: "stack" });
      li.appendChild(el("p", { text: `${c.github_login || c.user_id} wants to own “${c.student_name}”` }));
      li.appendChild(el("p", { class: "meta", text:
        `Verified email: ${c.algoma_email || "none"} · Email on the old record: ${c.legacy_email || "none"} · ` +
        `${c.claimant_has_profile ? "Claimant already has a profile (merge first)" : "Claimant has no profile"} · ${when(c.created_at)}` }));
      if (c.note) li.appendChild(el("p", { class: "prose", text: `Claimant's note: ${c.note}` }));
      if (c.status !== "pending") {
        li.appendChild(el("p", { class: "meta", text: `${titleCase(c.status)} by ${c.decided_by || "—"} (${c.method === "verified_email" ? "verified email matched" : "staff review"})${c.decision_note ? ` · ${c.decision_note}` : ""}` }));
      } else {
        const noteId = `claim-note-${c.id}`;
        const note = el("input", { type: "text", id: noteId, maxlength: "1000" });
        const approve = el("button", { type: "button", text: "Approve claim" });
        const reject = el("button", { type: "button", class: "secondary", text: "Reject claim" });
        const decide = (btn, decision) =>
          act(btn, () => apiCall(`/api/staff/claims/${c.id}/decision`, { method: "POST", body: { decision, note: note.value.trim() } }),
            decision === "approve" ? "Claim approved. The student now owns the profile." : "Claim rejected. The student sees your note.")
            .then((ok) => ok && loadClaims());
        approve.addEventListener("click", () => decide(approve, "approve"));
        reject.addEventListener("click", () => decide(reject, "reject"));
        li.appendChild(el("label", { for: noteId, text: "Note (required to reject; the student sees it)" }));
        li.appendChild(note);
        li.appendChild(el("p", {}, [approve, text(" "), reject]));
      }
      list.appendChild(li);
    }
  }

  // ---- import -----------------------------------------------------------------
  function renderReport(r) {
    const box = $("import-report");
    box.innerHTML = "";
    box.appendChild(el("h3", { text: `Import report — run ${r.run_id} (${r.source_name || "upload"})` }));
    const grid = el("div", { class: "report-grid" });
    for (const k of ["students", "projects", "companies", "collaborations"]) {
      const c = r[k] || {};
      grid.appendChild(el("div", { class: "panel" }, [
        el("strong", { text: titleCase(k) }),
        el("p", { class: "meta", text: `In file: ${(r.source_counts || {})[k] || 0}` }),
        el("p", { text: `Created ${c.created || 0} · Updated ${c.updated || 0} · Skipped ${c.skipped || 0} · Conflicts ${c.conflicts || 0}` }),
      ]));
    }
    box.appendChild(grid);
    const listOf = (title, items, fmt, empty) => {
      box.appendChild(el("h4", { text: title }));
      if (!items || !items.length) return box.appendChild(el("p", { class: "meta", text: empty }));
      const ul = el("ul");
      for (const i of items) ul.appendChild(el("li", { text: fmt(i) }));
      box.appendChild(ul);
    };
    listOf("Possible duplicate profiles (merge below if confirmed)", r.duplicate_student_candidates,
      (d) => `${d.legacy_id} may be ${d.possible_duplicate_of} — ${d.reason}`, "None found.");
    listOf("Possible duplicate partners", r.duplicate_company_candidates,
      (d) => `${d.legacy_id} may be ${d.possible_duplicate_of} — ${d.reason}`, "None found.");
    listOf("Possible matches with records already on the platform", r.possible_existing_matches,
      (d) => `${d.kind} ${d.legacy_id} → existing ${d.existing_id} — ${d.reason}`, "None found.");
    listOf("Broken references (reported, no relationship invented)", r.broken_references,
      (b) => Object.entries(b).map(([k, v]) => `${k}: ${v}`).join(", "), "None found.");
    listOf("Unclaimed profiles (public, waiting for their owner)", r.unclaimed_profiles, (x) => x, "None.");
    listOf("Marked as claimed on the old site (owner must claim again here)", r.awaiting_owner_account, (x) => x, "None.");
    listOf("Availability that needs reconfirmation (older than 365 days)", r.stale_availability, (x) => x, "None.");
    listOf("Other issues", r.issues, (i) => `${i.kind} ${i.legacy_id}: ${i.message}`, "None.");
  }

  $("import-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const file = $("import-file").files[0];
    if (!file) {
      say("Choose the JSON export file first.");
      return $("import-file").focus();
    }
    let data;
    try {
      data = JSON.parse(await file.text());
    } catch {
      say("That file is not valid JSON, so nothing was imported.");
      return $("import-file").focus();
    }
    const report = await act($("import-btn"),
      () => apiCall("/api/staff/migrations", { method: "POST", body: { data, source_name: file.name } }),
      (r) => `Import finished: ${["students", "projects", "companies", "collaborations"].map((k) => `${r[k].created} ${k} created`).join(", ")}.`);
    if (report) {
      renderReport(report);
      loadRuns();
    }
  });

  async function loadRuns() {
    const list = $("runs-list");
    list.innerHTML = "";
    let runs = [];
    try {
      runs = await apiCall("/api/staff/migrations");
    } catch (err) {
      return say(err.message);
    }
    if (!runs.length) list.appendChild(el("li", {}, [el("span", { class: "meta", text: "No imports yet." })]));
    for (const r of runs) {
      const c = r.counts || {};
      const summary = ["students", "projects", "companies", "collaborations"]
        .map((k) => `${k}: +${(c[k] || {}).created || 0} / ${(c[k] || {}).skipped || 0} skipped`).join(" · ");
      const view = el("button", { type: "button", class: "secondary", text: "View report" });
      view.addEventListener("click", async () => {
        const full = await act(view, () => apiCall(`/api/staff/migrations/${r.id}`), "Report loaded below the import form.");
        if (full) {
          renderReport({ ...full.report, run_id: full.id });
          $("import-report").scrollIntoView({ block: "start" });
        }
      });
      const li = el("li", { class: "stack" }, [
        el("p", { text: `Run ${r.id} · ${r.source_name} · ${when(r.created_at)}${r.archived_at ? " · archived" : ""}` }),
        el("p", { class: "meta", text: summary }),
      ]);
      const row = el("p", {}, [view]);
      if (!r.archived_at) {
        // Built-in confirmation, because archiving hides many profiles at once.
        const arch = el("button", { type: "button", class: "secondary", text: "Archive what this import created" });
        arch.addEventListener("click", () => {
          if (arch.dataset.armed !== "1") {
            arch.dataset.armed = "1";
            arch.textContent = "Confirm: retire this batch's unclaimed profiles and archive its projects";
            return;
          }
          act(arch, () => apiCall(`/api/staff/migrations/${r.id}/archive`, { method: "POST" }),
            (o) => `Archived: ${o.students_retired} profiles retired, ${o.projects_archived} projects archived. Nothing was deleted.`)
            .then((ok) => ok && loadRuns());
        });
        row.appendChild(text(" "));
        row.appendChild(arch);
      }
      li.appendChild(row);
      list.appendChild(li);
    }
  }

  // ---- profiles -----------------------------------------------------------------
  $("profile-search").addEventListener("submit", async (e) => {
    e.preventDefault();
    const list = $("profiles-list");
    list.innerHTML = "";
    let rows = [];
    try {
      rows = await apiCall(`/api/staff/students?q=${encodeURIComponent($("profile-q").value.trim())}`);
    } catch (err) {
      return say(err.message);
    }
    if (!rows.length) list.appendChild(el("li", {}, [el("span", { class: "meta", text: "No profiles match." })]));
    for (const s of rows) {
      const li = el("li", { class: "stack" });
      li.appendChild(el("p", { text: `${s.name} (${s.id})` }));
      li.appendChild(el("p", { class: "meta", text:
        `${titleCase(s.status)} · ${s.merged_into ? `merged into ${s.merged_into}` : titleCase(s.profile_status)} · ` +
        `${s.availability_mode === "showcase" ? "Showcase Only" : "Active Talent"} · ` +
        `owner: ${s.owner_login || s.owner_email || "unclaimed"} · legacy: ${s.legacy_ids || "—"}${s.legacy_email ? ` (${s.legacy_email})` : ""} · ${s.projects} projects` }));
      if (!s.merged_into) {
        const statusId = `st-${s.id}`;
        const sel = el("select", { id: statusId }, [
          el("option", { value: "current", text: "Current student" }),
          el("option", { value: "alumni", text: "Alumni" }),
        ]);
        sel.value = s.status;
        const saveSt = el("button", { type: "button", class: "secondary", text: "Save status" });
        saveSt.addEventListener("click", () =>
          act(saveSt, () => apiCall(`/api/staff/students/${encodeURIComponent(s.id)}/status`, { method: "POST", body: { status: sel.value } }),
            `${s.name} is now ${sel.value === "alumni" ? "alumni" : "a current student"}. The portfolio stays as it was.`));
        li.appendChild(el("p", {}, [el("label", { for: statusId, text: "Student status " }), sel, text(" "), saveSt]));

        const ownerId = `ow-${s.id}`;
        const ownerNoteId = `own-${s.id}`;
        const who = el("input", { type: "text", id: ownerId, autocomplete: "off" });
        const why = el("input", { type: "text", id: ownerNoteId, maxlength: "1000" });
        const setOwner = el("button", { type: "button", class: "secondary", text: "Make this account the owner" });
        const clearOwner = el("button", { type: "button", class: "secondary", text: "Remove the owner" });
        setOwner.addEventListener("click", () =>
          act(setOwner, () => apiCall(`/api/staff/students/${encodeURIComponent(s.id)}/owner`, { method: "POST", body: { user: who.value.trim(), note: why.value.trim() } }),
            (o) => `${s.name} is now owned by ${o.owner}.`));
        clearOwner.addEventListener("click", () =>
          act(clearOwner, () => apiCall(`/api/staff/students/${encodeURIComponent(s.id)}/owner`, { method: "POST", body: { clear: true, note: why.value.trim() } }),
            `${s.name} no longer has an owner and can be claimed again.`));
        li.appendChild(el("label", { for: ownerId, text: "New owner: GitHub login or verified Algoma email" }));
        li.appendChild(who);
        li.appendChild(el("label", { for: ownerNoteId, text: "Reason for the ownership change (required)" }));
        li.appendChild(why);
        li.appendChild(el("p", {}, [setOwner, text(" "), clearOwner]));

        const asDup = el("button", { type: "button", class: "secondary", text: "Use as duplicate" });
        const asKeep = el("button", { type: "button", class: "secondary", text: "Use as surviving profile" });
        asDup.addEventListener("click", () => { $("merge-from").value = s.id; $("merge-from").focus(); });
        asKeep.addEventListener("click", () => { $("merge-into").value = s.id; $("merge-into").focus(); });
        li.appendChild(el("p", {}, [asDup, text(" "), asKeep, text(" "), el("a", { href: studentUrl(s.id), text: "Public page" })]));
      }
      list.appendChild(li);
    }
  });

  $("merge-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const btn = e.target.querySelector("button");
    const from = $("merge-from").value.trim();
    const into = $("merge-into").value.trim();
    if (!from || !into) {
      say("Enter both profile ids. Use the search above and the “Use as …” buttons.");
      return $(from ? "merge-into" : "merge-from").focus();
    }
    act(btn, () => apiCall("/api/staff/students/merge", { method: "POST", body: { from_id: from, into_id: into, note: $("merge-note").value.trim() } }),
      (o) => `Merged. ${o.contributor_relationships_moved} project relationships moved; the old profile address now leads to ${into}.`);
  });

  // ---- partners -----------------------------------------------------------------
  async function loadCompanies() {
    let rows = [];
    try {
      rows = await apiCall("/api/staff/companies-all");
    } catch (err) {
      return say(err.message);
    }
    for (const id of ["co-from", "co-into"]) {
      const sel = $(id);
      sel.innerHTML = "";
      sel.appendChild(el("option", { value: "", text: "Choose a partner" }));
      for (const c of rows.filter((r) => !r.merged_into)) {
        sel.appendChild(el("option", { value: c.id, text: `${c.name} · ${c.domain || "no domain"} · ${c.status}${c.legacy_ids ? ` · legacy ${c.legacy_ids}` : ""}` }));
      }
    }
  }
  $("co-merge-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const btn = e.target.querySelector("button");
    if (!$("co-from").value || !$("co-into").value) {
      say("Choose both partners.");
      return $("co-from").focus();
    }
    act(btn, () => apiCall("/api/staff/companies/merge", { method: "POST", body: { from_id: $("co-from").value, into_id: $("co-into").value, note: $("co-note").value.trim() } }),
      (o) => `Partners merged: ${o.collaborations_moved} collaborations moved.`).then((ok) => ok && loadCompanies());
  });

  // ---- projects -----------------------------------------------------------------
  $("project-search").addEventListener("submit", async (e) => {
    e.preventDefault();
    const list = $("projects-list");
    list.innerHTML = "";
    let rows = [];
    try {
      rows = await apiCall(`/api/staff/projects?q=${encodeURIComponent($("project-q").value.trim())}`);
    } catch (err) {
      return say(err.message);
    }
    if (!rows.length) list.appendChild(el("li", {}, [el("span", { class: "meta", text: "No projects match." })]));
    for (const p of rows) {
      const li = el("li", { class: "stack" });
      li.appendChild(el("p", { text: p.title }));
      li.appendChild(el("p", { class: "meta", text: `${p.id} · ${p.project_status} · maintained by ${p.maintainer_name || "nobody"}` }));
      const selId = `mt-${p.id}`;
      const noteId = `mtn-${p.id}`;
      const sel = el("select", { id: selId });
      for (const c of p.contributors.filter((c) => c.status === "accepted")) {
        sel.appendChild(el("option", { value: c.student_id, text: `${c.name} (${c.role || "Contributor"})` }));
      }
      sel.value = p.maintainer_student_id || "";
      const note = el("input", { type: "text", id: noteId, maxlength: "1000" });
      const btn = el("button", { type: "button", text: "Make maintainer" });
      btn.addEventListener("click", () =>
        act(btn, () => apiCall(`/api/staff/projects/${encodeURIComponent(p.id)}/maintainer`, { method: "POST", body: { student_id: sel.value, note: note.value.trim() } }),
          "Maintainer changed. The project, its address and its contributors are unchanged."));
      li.appendChild(el("label", { for: selId, text: "New maintainer (accepted contributors only)" }));
      li.appendChild(sel);
      li.appendChild(el("label", { for: noteId, text: "Reason (required)" }));
      li.appendChild(note);
      li.appendChild(el("p", {}, [btn, text(" "), el("a", { href: projectUrl(p.id), text: "Public page" })]));
      list.appendChild(li);
    }
  });

  // ---- diagnostics ------------------------------------------------------------------
  async function loadDiagnostics() {
    let d;
    try {
      d = await apiCall("/api/staff/diagnostics");
    } catch (err) {
      return say(err.message);
    }
    const row = (cells) => el("tr", {}, cells.map((c) => el("td", { text: String(c == null ? "" : c) })));
    const ev = $("diag-events");
    ev.innerHTML = "";
    if (!d.events.length) ev.appendChild(row(["—", "No errors recorded", "", ""]));
    for (const x of d.events) ev.appendChild(row([when(x.created_at), x.kind, JSON.stringify(x.context), x.message]));
    const au = $("diag-audit");
    au.innerHTML = "";
    if (!d.audit.length) au.appendChild(row(["—", "No changes yet", "", "", "", ""]));
    for (const x of d.audit) au.appendChild(row([when(x.created_at), x.kind, x.subject_id, `${x.from_value || "—"} → ${x.to_value || "—"}`, x.actor, x.note]));
  }
  $("diag-btn").addEventListener("click", loadDiagnostics);

  await Promise.all([loadClaims(), loadRuns(), loadCompanies(), loadDiagnostics()]);
})();
