/*
 * Staff partner editor (R4.07 - R4.18, R4.25).
 *   ?new=1   add a partner: import from a website or type it in, then Save draft
 *   ?id=X    review/edit, publish, check the website again, collaborations
 * Imported values only ever fill this form. They are saved when staff press
 * Save, and the partner is public only after Publish (R4.09). A failed import
 * leaves whatever is already in the form untouched (R4.11).
 */
(async function partnerEditor() {
  const notice = document.getElementById("notice");
  const $ = (x) => document.getElementById(x);
  const FIELDS = ["name", "website", "description", "sector", "location", "keywords"];

  function say(message, type = "error") {
    showNotice(notice, message, type);
    notice.scrollIntoView({ block: "nearest" });
  }
  function when(iso) {
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? "" : d.toLocaleString(undefined, { year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  }

  let me;
  try {
    me = await apiCall("/api/me");
  } catch {
    return say("The staff workspace could not be reached. Check your connection and reload.");
  }
  if (!me.signed_in || me.role !== "staff") {
    say("This area is only for ImmXrsive staff. Sign in with your staff account.");
    notice.appendChild(el("p", {}, [el("a", { class: "btn", href: "staff-login.html", text: "Go to staff sign-in" })]));
    return;
  }
  $("who").textContent = `Signed in as ${me.github_login} (staff)`;

  const companyId = qs("id");
  let company = null; // the saved record, when editing
  let pendingImportId = null; // the reviewed import the form currently reflects
  let options = null;

  // ---- form helpers --------------------------------------------------------

  function readForm() {
    return {
      name: $("f-name").value.trim(),
      website: $("f-website").value.trim(),
      description: $("f-description").value.trim(),
      sector: $("f-sector").value.trim(),
      location: $("f-location").value.trim(),
      keywords: $("f-keywords").value.split(",").map((s) => s.trim()).filter(Boolean),
    };
  }
  function fillForm(v, onlyEmpty = false) {
    for (const f of FIELDS) {
      const input = $(`f-${f}`);
      const value = f === "keywords" ? (v.keywords || []).join(", ") : v[f] || "";
      if (onlyEmpty && input.value.trim()) continue;
      input.value = value;
    }
  }
  function showSources(sources) {
    document.querySelectorAll(".source").forEach((p) => {
      const s = (sources || {})[p.dataset.for];
      p.textContent = "";
      if (!s) return;
      if (s.source === "import") p.textContent = `From the company website (${s.url}), imported ${when(s.at)}.`;
      else if (s.source === "staff") p.textContent = `Entered or edited by staff (${s.by || "staff"}), ${when(s.at)}.`;
      else p.textContent = `From a ${s.source}, ${when(s.at)}.`;
    });
  }

  // ---- add mode ------------------------------------------------------------

  function importNotes(result, container) {
    container.innerHTML = "";
    if (result.flagged_text.length) {
      // R4.10 — shown as a warning, used for nothing.
      const box = el("div", { class: "notice" });
      box.appendChild(el("strong", { text: "This page contains text that looks like instructions to a computer system. It was ignored and changed nothing: " }));
      const ul = el("ul");
      result.flagged_text.forEach((t) => ul.appendChild(el("li", { text: `“${t}”` })));
      box.appendChild(ul);
      box.appendChild(el("p", { text: "Imported partners are always drafts. Only staff can publish or verify a partner." }));
      container.appendChild(box);
    }
    const labels = { name: "name", description: "description", location: "location", sector: "sector", keywords: "keywords" };
    if (result.missing.length) {
      container.appendChild(el("div", {
        class: "notice info",
        text: `The website did not say: ${result.missing.map((m) => labels[m] || m).join(", ")}. Please fill these in yourself before publishing.`,
      }));
    }
    if (result.duplicates.length) {
      const box = el("div", { class: "notice" });
      box.appendChild(el("strong", { text: "A partner with this website already exists: " }));
      result.duplicates.forEach((d, i) => {
        if (i) box.appendChild(document.createTextNode(", "));
        box.appendChild(el("a", { href: `admin-partner.html?id=${encodeURIComponent(d.id)}`, text: `${d.name} — open it` }));
      });
      box.appendChild(el("p", { text: "Use the existing partner rather than creating a second one, unless this really is a different organisation." }));
      container.appendChild(box);
    }
    container.appendChild(el("div", {
      class: "notice success",
      text: `Details read from ${result.final_url}. Review and correct them below, then press Save draft. Nothing has been saved yet.`,
    }));
  }

  async function runImport(url, forCompanyId) {
    return apiCall("/api/staff/companies/import", { method: "POST", body: { url, company_id: forCompanyId || undefined } });
  }

  if (!companyId) {
    $("page-title").textContent = "Add a partner";
    document.title = "Add a partner — ImmXrsive Staff";
    $("import-panel").hidden = false;
    $("details-form").hidden = false;

    $("manual-btn").addEventListener("click", () => {
      pendingImportId = null;
      $("import-result").innerHTML = "";
      $("f-name").focus();
    });

    $("import-form").addEventListener("submit", async (e) => {
      e.preventDefault();
      const btn = $("import-btn");
      btn.disabled = true;
      btn.textContent = "Reading the website…";
      try {
        const result = await runImport($("import-url").value.trim());
        pendingImportId = result.import_id;
        fillForm(result.candidate);
        importNotes(result, $("import-result"));
      } catch (err) {
        // R4.11 — the form keeps whatever was already typed.
        $("import-result").innerHTML = "";
        $("import-result").appendChild(el("div", { class: "notice error", text: `${err.message} Anything already in the form below has been kept.` }));
      } finally {
        btn.disabled = false;
        btn.textContent = "Get details";
      }
    });
  }

  // ---- edit mode -------------------------------------------------------------

  async function loadCompany() {
    try {
      company = await apiCall(`/api/staff/companies/${encodeURIComponent(companyId)}`);
    } catch (err) {
      return say(err.message);
    }
    $("page-title").textContent = company.name;
    document.title = `${company.name} — ImmXrsive Staff`;
    for (const panel of ["status-panel", "details-form", "refresh-panel", "collab-panel", "history-panel"]) $(panel).hidden = false;
    $("save-btn").textContent = "Save changes";
    fillForm(company);
    showSources(company.field_sources);
    pendingImportId = null;

    const published = company.status === "published";
    $("status-text").textContent = published
      ? "This partner is public. Visitors can see its page and its public collaborations."
      : "This partner is not public yet. Review the details, then publish it.";
    $("publish-btn").hidden = published;
    $("unpublish-btn").hidden = !published;
    $("public-link").innerHTML = "";
    if (published) $("public-link").appendChild(el("a", { href: partnerUrl(company.id), target: "_blank", rel: "noopener", text: "Open the public partner page" }));

    const lastOk = company.imports.find((i) => i.ok);
    if (!$("refresh-url").value) $("refresh-url").value = lastOk ? lastOk.source_url : company.website;

    renderCollaborations();
    renderHistory();
  }

  function renderHistory() {
    const list = $("history-list");
    list.innerHTML = "";
    if (!company.imports.length) {
      list.appendChild(el("li", {}, [el("span", { class: "meta", text: "Entered manually — not imported from a website." })]));
      return;
    }
    for (const i of company.imports) {
      list.appendChild(el("li", { class: "stack" }, [
        el("p", { text: i.ok ? `Read from ${i.source_url}` : `Could not read ${i.source_url}` }),
        el("p", { class: "meta", text: `${when(i.imported_at)}${i.ok ? "" : ` · ${i.error}`}` }),
        i.flagged_text && i.flagged_text.length
          ? el("p", { class: "meta", text: `Ignored ${i.flagged_text.length} sentence(s) that looked like instructions.` })
          : null,
      ]));
    }
  }

  async function saveDetails(confirmNew = false) {
    const body = { ...readForm(), import_id: pendingImportId || undefined, confirm_new: confirmNew || undefined };
    if (!body.name) return say("Add the company name before saving.");
    const btn = $("save-btn");
    btn.disabled = true;
    try {
      if (companyId) {
        await apiCall(`/api/staff/companies/${encodeURIComponent(companyId)}`, { method: "PUT", body });
        await loadCompany();
        say("Saved.", "success");
      } else {
        const created = await apiCall("/api/staff/companies", { method: "POST", body });
        window.location.assign(`admin-partner.html?id=${encodeURIComponent(created.id)}&saved=1`);
      }
    } catch (err) {
      if (err.status === 409 && err.data && err.data.duplicates) {
        say(err.message);
        const links = el("p");
        err.data.duplicates.forEach((d, i) => {
          if (i) links.appendChild(document.createTextNode(" · "));
          links.appendChild(el("a", { href: `admin-partner.html?id=${encodeURIComponent(d.id)}`, text: `Open ${d.name}` }));
        });
        const anyway = el("button", { type: "button", class: "secondary", text: "It is a different organisation — save anyway" });
        anyway.addEventListener("click", () => saveDetails(true));
        notice.appendChild(links);
        notice.appendChild(el("p", {}, [anyway]));
      } else {
        say(err.message);
      }
    } finally {
      btn.disabled = false;
    }
  }
  $("details-form").addEventListener("submit", (e) => {
    e.preventDefault();
    saveDetails();
  });

  for (const [btnId, publish] of [["publish-btn", true], ["unpublish-btn", false]]) {
    $(btnId).addEventListener("click", async () => {
      try {
        await apiCall(`/api/staff/companies/${encodeURIComponent(companyId)}/publish`, { method: "POST", body: { publish } });
        await loadCompany();
        say(publish ? "Published. The partner page is now public." : "Hidden from the public site. Nothing was deleted.", "success");
      } catch (err) {
        say(err.message);
      }
    });
  }

  // Check the website again: show differences, keep saved values by default.
  $("refresh-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const out = $("refresh-result");
    const btn = $("refresh-btn");
    btn.disabled = true;
    out.innerHTML = "";
    try {
      const result = await runImport($("refresh-url").value.trim(), companyId);
      const current = readForm();
      const diffs = FIELDS.filter((f) => {
        const a = f === "keywords" ? current.keywords.join(", ") : current[f];
        const b = f === "keywords" ? (result.candidate.keywords || []).join(", ") : result.candidate[f] || "";
        return b && a !== b;
      });
      if (result.flagged_text.length) importNotes({ ...result, missing: [], duplicates: [] }, out);
      if (!diffs.length) {
        out.appendChild(el("div", { class: "notice success", text: "The website matches what is saved. Nothing to change." }));
        await loadCompany();
        return;
      }
      out.appendChild(el("p", { text: "The website now says something different for these fields. Tick the ones you want to use; the rest keep your saved value." }));
      const list = el("ul", { class: "row-list" });
      for (const f of diffs) {
        const a = f === "keywords" ? current.keywords.join(", ") : current[f];
        const b = f === "keywords" ? result.candidate.keywords.join(", ") : result.candidate[f];
        const box = el("input", { type: "checkbox", id: `use-${f}`, "data-field": f });
        list.appendChild(el("li", { class: "stack" }, [
          el("p", { text: f[0].toUpperCase() + f.slice(1) }),
          el("p", { class: "meta", text: `Saved now: ${a || "(empty)"}` }),
          el("p", { class: "meta", text: `Website says: ${b}` }),
          el("label", { for: `use-${f}` }, [box, document.createTextNode(" Use the website's version")]),
        ]));
      }
      out.appendChild(list);
      const apply = el("button", { type: "button", text: "Apply the ticked changes" });
      apply.addEventListener("click", async () => {
        const next = readForm();
        list.querySelectorAll("input:checked").forEach((i) => {
          next[i.dataset.field] = result.candidate[i.dataset.field];
        });
        try {
          await apiCall(`/api/staff/companies/${encodeURIComponent(companyId)}`, {
            method: "PUT",
            body: { ...next, import_id: result.import_id },
          });
          out.innerHTML = "";
          await loadCompany();
          say("Saved. Fields you did not tick kept their existing values.", "success");
        } catch (err) {
          say(err.message);
        }
      });
      out.appendChild(el("p", {}, [apply]));
    } catch (err) {
      out.appendChild(el("div", { class: "notice error", text: `${err.message} The saved details have not changed.` }));
      await loadCompany();
    } finally {
      btn.disabled = false;
    }
  });

  // ---- collaborations (R4.15 - R4.18) --------------------------------------

  const VIS_LABEL = { public: "Public", limited: "Limited — summary only", private: "Private — staff only" };
  let editingCollab = null;

  function renderCollaborations() {
    const list = $("collab-list");
    list.innerHTML = "";
    if (!company.collaborations.length) {
      list.appendChild(el("li", {}, [el("span", { class: "meta", text: "No collaborations yet." })]));
    }
    for (const c of company.collaborations) {
      const edit = el("button", { type: "button", class: "secondary", text: "Edit" });
      edit.addEventListener("click", () => openCollabForm(c));
      list.appendChild(el("li", { class: "stack" }, [
        el("p", { text: c.title }),
        el("p", {
          class: "meta",
          text: `${yearRange(c.start_year, c.end_year, c.status)} · ${c.status === "current" ? "Current" : "Past"} · ${VIS_LABEL[c.visibility]}`,
        }),
        c.projects.length ? el("p", { class: "meta", text: `Projects: ${c.projects.map((p) => p.title).join(", ")}` }) : null,
        c.students.length ? el("p", { class: "meta", text: `Students: ${c.students.map((s) => s.name).join(", ")}` }) : null,
        el("p", {}, [edit]),
      ]));
    }
  }

  async function ensureOptions() {
    if (!options) options = await apiCall("/api/staff/options");
    return options;
  }

  function checkboxList(container, items, label, chosenIds) {
    container.innerHTML = "";
    if (!items.length) {
      container.appendChild(el("span", { class: "meta", text: "None available." }));
      return;
    }
    for (const item of items) {
      const box = el("input", { type: "checkbox", value: item.id });
      if (chosenIds.includes(item.id)) box.checked = true;
      container.appendChild(el("label", {}, [box, document.createTextNode(` ${label(item)}`)]));
    }
  }

  function syncSummaryRow() {
    $("c-summary-row").hidden = $("c-visibility").value !== "limited";
  }
  $("c-visibility").addEventListener("change", syncSummaryRow);

  async function openCollabForm(c) {
    try {
      await ensureOptions();
    } catch (err) {
      return say(err.message);
    }
    editingCollab = c || null;
    $("collab-form-title").textContent = c ? `Edit "${c.title}"` : "Add a collaboration";
    $("c-title").value = c ? c.title : "";
    $("c-start").value = c && c.start_year ? c.start_year : "";
    $("c-end").value = c && c.end_year ? c.end_year : "";
    document.querySelector(`input[name="c-status"][value="${c ? c.status : "current"}"]`).checked = true;
    $("c-visibility").value = c ? c.visibility : "public";
    $("c-summary").value = c ? c.public_summary : "";
    $("c-description").value = c ? c.description : "";
    $("c-outcome").value = c ? c.outcome : "";
    checkboxList($("c-projects"), options.projects, (p) => `${p.title}${p.project_status === "published" ? "" : " (not public)"}`, c ? c.projects.map((p) => p.id) : []);
    checkboxList($("c-students"), options.students, (s) => s.name, c ? c.students.map((s) => s.id) : []);
    syncSummaryRow();
    $("collab-form").hidden = false;
    $("add-collab-btn").hidden = true;
    $("c-title").focus();
  }
  function closeCollabForm() {
    $("collab-form").hidden = true;
    $("add-collab-btn").hidden = false;
    editingCollab = null;
  }
  $("add-collab-btn").addEventListener("click", () => openCollabForm(null));
  $("collab-cancel-btn").addEventListener("click", closeCollabForm);

  $("collab-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const body = {
      title: $("c-title").value.trim(),
      start_year: $("c-start").value,
      end_year: $("c-end").value,
      status: document.querySelector('input[name="c-status"]:checked').value,
      visibility: $("c-visibility").value,
      public_summary: $("c-summary").value.trim(),
      description: $("c-description").value.trim(),
      outcome: $("c-outcome").value.trim(),
      project_ids: [...$("c-projects").querySelectorAll("input:checked")].map((i) => i.value),
      student_ids: [...$("c-students").querySelectorAll("input:checked")].map((i) => i.value),
    };
    const btn = $("collab-save-btn");
    btn.disabled = true;
    try {
      if (editingCollab) {
        company = await apiCall(`/api/staff/collaborations/${encodeURIComponent(editingCollab.id)}`, { method: "PUT", body });
      } else {
        company = await apiCall(`/api/staff/companies/${encodeURIComponent(companyId)}/collaborations`, { method: "POST", body });
      }
      closeCollabForm();
      renderCollaborations();
      say("Collaboration saved.", "success");
    } catch (err) {
      say(err.message);
    } finally {
      btn.disabled = false;
    }
  });

  if (companyId) {
    await loadCompany();
    if (qs("saved")) say("Draft saved. It is not public yet — check the details, then publish.", "success");
  }
})();
