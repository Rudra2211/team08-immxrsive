/* Profile editor — R2.11 to R2.27.
   Cookies are cross-origin here, so every call sends credentials, exactly as
   on account.html. */
(function () {
  const $ = (id) => document.getElementById(id);
  const notice = $("notice");

  const LINK_KEYS = ["github", "linkedin", "portfolio"];
  const LINK_LABELS = { github: "GitHub", linkedin: "LinkedIn", portfolio: "portfolio" };
  const TEXT_FIELDS = [
    "name", "headline", "program", "bio", "location_text",
    "contact_email", "education", "experience",
  ];
  const AVAILABILITY_LABELS = {
    internship: "Internship",
    "full-time": "Full-time",
    contract: "Contract",
  };
  const SECTION_LABELS = {
    about: "About",
    skills: "Skills",
    projects: "Project evidence",
    experience: "Experience",
  };
  // R2.18 — plain words, not field names.
  const VISIBILITY_LABELS = {
    availability: "Show the work I am available for",
    links: "Show my links",
    location: "Show my location",
    contact_email: "Show my contact email",
    education: "Show my education",
    experience: "Show my experience",
  };
  const STATUS_TEXT = {
    draft: "Your profile is a private draft. Nobody else can see it yet.",
    unpublished: "Your profile is unpublished. It is saved, but not in the public directory.",
    published: "Your profile is published and visible in the public directory.",
  };

  let opts = null; // /api/profile/options
  let profile = null; // the owner's own record
  let order = []; // working section order (R2.23)
  let pendingImport = null; // the import awaiting Apply or Discard (R2.15)

  /** Same shape as apiGet in app.js, but credentialed and able to POST/PUT. */
  async function api(path, init = {}) {
    const res = await fetch(`${API}${path}`, {
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      ...init,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || "Something went wrong. Please try again.");
    return data;
  }

  /** R2.27 — one alert region, one message per thing the student should know. */
  function report(items) {
    notice.innerHTML = "";
    for (const item of [].concat(items)) {
      if (!item) continue;
      const { text, type } = typeof item === "string" ? { text: item, type: "error" } : item;
      notice.appendChild(el("div", { class: `notice ${type || "error"}`, text }));
    }
  }

  const label = (map, value) => map[value] || titleCase(String(value).replace(/_/g, " "));

  /** A labelled checkbox per value. Every input gets an id and a <label for>. */
  function checkGroup(container, values, prefix, labelFor, isChecked) {
    container.innerHTML = "";
    values.forEach((value, i) => {
      const inputId = `${prefix}-${i}`;
      const input = el("input", { type: "checkbox", id: inputId, value });
      input.checked = Boolean(isChecked(value));
      const lab = el("label", { for: inputId }, [input]);
      lab.appendChild(document.createTextNode(` ${labelFor(value)}`));
      container.appendChild(lab);
    });
  }

  const checkedValues = (container) =>
    Array.from(container.querySelectorAll("input:checked")).map((input) => input.value);

  /**
   * Mirrors publicView on the server: contact_email is private unless it is
   * explicitly turned on, everything else is public unless turned off.
   */
  function visChecked(field) {
    const value = (profile.visibility || {})[field];
    return field === "contact_email" ? value === true : value !== false;
  }

  function gate(title, text) {
    $("gate-title").textContent = title;
    $("gate-text").textContent = text;
    $("gate").hidden = false;
    $("create").hidden = true;
    $("editor").hidden = true;
  }

  function renderStatus() {
    $("status-text").textContent = STATUS_TEXT[profile.profile_status] || "Your profile is saved.";
    $("publish-btn").hidden = profile.profile_status === "published";
    $("unpublish-btn").hidden = profile.profile_status !== "published";
  }

  /* ---- section order (R2.23) ---------------------------------------- */

  function renderOrder() {
    const list = $("order-list");
    list.innerHTML = "";
    order.forEach((key, i) => {
      const up = el("button", { type: "button", class: "secondary", text: "Move up" });
      const down = el("button", { type: "button", class: "secondary", text: "Move down" });
      up.disabled = i === 0;
      down.disabled = i === order.length - 1;
      up.addEventListener("click", () => move(i, -1));
      down.addEventListener("click", () => move(i, 1));
      const li = el("li", {}, [
        el("span", { text: `${i + 1}. ${label(SECTION_LABELS, key)}` }),
        el("span", {}, [up, down]),
      ]);
      list.appendChild(li);
    });
    $("order-state").textContent = `Order: ${order.map((k) => label(SECTION_LABELS, k)).join(", ")}.`;
  }

  /**
   * R2.27 — two buttons rather than drag and drop, so reordering works from
   * the keyboard. Focus follows the row that moved.
   */
  function move(index, delta) {
    const target = index + delta;
    if (target < 0 || target >= order.length) return;
    const moved = order[index];
    order[index] = order[target];
    order[target] = moved;
    renderOrder();
    const buttons = $("order-list").children[target].querySelectorAll("button");
    const preferred = buttons[delta < 0 ? 0 : 1];
    const focusable = preferred && !preferred.disabled
      ? preferred
      : Array.from(buttons).find((b) => !b.disabled);
    if (focusable) focusable.focus();
  }

  /* ---- loading ------------------------------------------------------- */

  function fillForm() {
    for (const field of TEXT_FIELDS) $(field).value = profile[field] || "";
    $("status").value = profile.status === "alumni" ? "alumni" : "current";
    for (const key of LINK_KEYS) $(key).value = (profile.links || {})[key] || "";

    checkGroup($("availability-checks"), opts.availability, "avail",
      (v) => label(AVAILABILITY_LABELS, v),
      (v) => (profile.availability || []).includes(v));

    checkGroup($("skill-checks"), opts.skills, "skill",
      (v) => v,
      (v) => (profile.skills || []).includes(v));

    checkGroup($("visibility-checks"), opts.visibility_fields, "vis",
      (v) => label(VISIBILITY_LABELS, v), visChecked);

    const theme = $("theme");
    theme.innerHTML = "";
    for (const t of opts.themes) theme.appendChild(el("option", { value: t, text: titleCase(t) }));
    theme.value = opts.themes.includes(profile.theme) ? profile.theme : opts.themes[0];

    order = (Array.isArray(profile.section_order) ? profile.section_order : [])
      .filter((s, i, a) => opts.sections.includes(s) && a.indexOf(s) === i);
    for (const s of opts.sections) if (!order.includes(s)) order.push(s);

    renderOrder();
    renderStatus();
  }

  async function loadEditor() {
    const [options, record] = await Promise.all([
      api("/api/profile/options"),
      api("/api/profile"),
    ]);
    opts = options;
    profile = record;
    fillForm();
    $("gate").hidden = true;
    $("create").hidden = true;
    $("editor").hidden = false;
  }

  async function start() {
    try {
      const me = await api("/api/me");
      if (!me.signed_in) {
        return gate("Sign in first", "Sign in with GitHub on your account page, then come back here to build your profile.");
      }
      if (!me.verified) {
        return gate("Confirm your Algoma email", "A profile needs a verified @algomau.ca address. You can confirm yours on your account page.");
      }
      if (!me.profile) {
        $("gate").hidden = true;
        $("editor").hidden = true;
        $("create").hidden = false;
        return;
      }
      await loadEditor();
    } catch (err) {
      report(err.message);
      gate("We could not load your profile", "The service may still be starting up. Try again in a moment, or go back to your account page.");
    }
  }

  /* ---- create (R2.10) ------------------------------------------------ */

  $("create-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = $("create-btn");
    btn.disabled = true;
    try {
      await api("/api/profile", {
        method: "POST",
        body: JSON.stringify({ name: $("create-name").value.trim() }),
      });
      await loadEditor();
      report({ text: "Your private draft is ready. Fill it in and publish when you are happy with it.", type: "success" });
      $("name").focus();
    } catch (err) {
      report(err.message);
    } finally {
      btn.disabled = false;
    }
  });

  /* ---- save (R2.11, R2.12, R2.18, R2.23) ----------------------------- */

  $("profile-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = $("save-btn");
    const suggestion = $("skill-suggestion").value.trim();
    const links = {};
    for (const key of LINK_KEYS) links[key] = $(key).value.trim();

    const visible = checkedValues($("visibility-checks"));
    const body = {
      status: $("status").value,
      theme: $("theme").value,
      section_order: order,
      links,
      availability: checkedValues($("availability-checks")),
      // R2.12 — a suggestion rides along in skills; the server files anything
      // outside the vocabulary as a suggestion instead of a skill.
      skills: checkedValues($("skill-checks")).concat(suggestion ? [suggestion] : []),
      visibility: Object.fromEntries(opts.visibility_fields.map((f) => [f, visible.includes(f)])),
    };
    for (const field of TEXT_FIELDS) body[field] = $(field).value.trim();

    btn.disabled = true;
    try {
      profile = await api("/api/profile", { method: "PUT", body: JSON.stringify(body) });
      fillForm(); // redraw from what the server actually stored, not from the form
      $("skill-suggestion").value = "";

      const messages = [{ text: "Your profile is saved.", type: "success" }];
      // Anything the server declined to store is said out loud, so a dropped
      // value never looks like data loss (R2.12).
      if (suggestion && !(profile.skills || []).includes(suggestion)) {
        messages.push({
          type: "info",
          text: `“${suggestion}” is not in the standardized list, so it was sent to us for review rather than added. It is not on your profile and it is not a search filter yet.`,
        });
      }
      for (const key of LINK_KEYS) {
        if (links[key] && !(profile.links || {})[key]) {
          messages.push({
            type: "info",
            text: `Your ${LINK_LABELS[key]} link was not saved, because a link has to start with http:// or https://.`,
          });
        }
      }
      report(messages);
    } catch (err) {
      report(err.message);
    } finally {
      btn.disabled = false;
    }
  });

  /* ---- publish and unpublish (R2.21) -------------------------------- */

  async function setPublication(path, btn) {
    btn.disabled = true;
    try {
      const data = await api(path, { method: "POST" });
      profile.profile_status = data.profile_status;
      renderStatus();
      report({ text: STATUS_TEXT[data.profile_status] || "Saved.", type: "success" });
    } catch (err) {
      report(err.message);
      $("headline").focus(); // publishing fails when the headline is missing
    } finally {
      btn.disabled = false;
    }
  }

  $("publish-btn").addEventListener("click", (e) => setPublication("/api/profile/publish", e.currentTarget));
  $("unpublish-btn").addEventListener("click", (e) => setPublication("/api/profile/unpublish", e.currentTarget));

  /* ---- resume import (R2.13 - R2.17) -------------------------------- */

  $("import-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const file = $("resume-file").files[0];
    if (!file) {
      report("Choose a PDF file before uploading.");
      $("resume-file").focus();
      return;
    }
    const btn = $("import-btn");
    btn.disabled = true;
    try {
      const form = new FormData();
      form.append("resume", file);
      // No Content-Type header: the browser has to set the multipart boundary.
      const res = await fetch(`${API}/api/resume/import`, {
        method: "POST",
        credentials: "include",
        body: form,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Could not import that resume.");
      pendingImport = data;
      renderReview(data.candidates || {});
      report({
        text: data.message || "Review these suggestions and choose which ones to keep. Nothing has changed yet.",
        type: "success",
      });
    } catch (err) {
      $("review").innerHTML = "";
      pendingImport = null;
      report(err.message);
    } finally {
      btn.disabled = false;
    }
  });

  /** R2.15 — the candidates, for review. Nothing is written until Apply. */
  function renderReview(c) {
    const box = $("review");
    box.innerHTML = "";

    const groups = [];
    if ((c.skills || []).length) {
      groups.push({
        key: "skills",
        label: `Skills from the standardized list (${c.skills.length})`,
        body: () => tagList(c.skills),
      });
    }
    if (c.education) {
      groups.push({
        key: "education",
        label: "Education",
        note: "Accepting this replaces whatever is in your education field.",
        body: () => el("p", { class: "prose", text: c.education }),
      });
    }
    if (c.experience) {
      groups.push({
        key: "experience",
        label: "Experience",
        note: "Accepting this replaces whatever is in your experience field.",
        body: () => el("p", { class: "prose", text: c.experience }),
      });
    }
    const linkEntries = Object.entries(c.links || {});
    if (linkEntries.length) {
      groups.push({
        key: "links",
        label: `Links (${linkEntries.length})`,
        note: "These are added to the links you already have, not swapped for them.",
        body: () => {
          const ul = el("ul", { class: "tags" });
          for (const [name, url] of linkEntries) {
            ul.appendChild(el("li", { class: "tag", text: `${label(LINK_LABELS, name)}: ${url}` }));
          }
          return ul;
        },
      });
    }
    if ((c.suggested_skills || []).length) {
      groups.push({
        key: "suggested_skills",
        label: `Terms we did not recognise (${c.suggested_skills.length})`,
        // R2.12 — these can only ever be suggestions.
        note: "These are not in the standardized list. Accepting them sends them to us for review; they do not appear on your profile and they do not become search filters.",
        body: () => tagList(c.suggested_skills),
      });
    }

    box.appendChild(el("h3", { text: "Suggestions from your resume" }));
    box.appendChild(el("div", {
      class: "notice info",
      text: "None of this is on your profile yet. Tick what you want to keep, then choose Apply.",
    }));

    if (groups.length === 0) {
      box.appendChild(el("p", { class: "meta", text: "There was nothing in that PDF we could suggest." }));
      return;
    }

    const form = el("form", { novalidate: "novalidate" });
    for (const group of groups) {
      const inputId = `accept-${group.key}`;
      const input = el("input", { type: "checkbox", id: inputId, value: group.key });
      const lab = el("label", { for: inputId }, [input]);
      lab.appendChild(document.createTextNode(` ${group.label}`));
      const fieldset = el("fieldset", {}, [el("div", { class: "checks" }, [lab])]);
      if (group.note) fieldset.appendChild(el("p", { class: "help", text: group.note }));
      fieldset.appendChild(group.body());
      form.appendChild(fieldset);
    }

    const discard = el("button", { type: "button", class: "secondary", text: "Discard all of these" });
    discard.addEventListener("click", discardImport);
    form.appendChild(el("p", {}, [
      el("button", { type: "submit", text: "Apply what I ticked" }),
      discard,
    ]));
    form.addEventListener("submit", applyImport);
    box.appendChild(form);

    const first = box.querySelector("input[type=\"checkbox\"]");
    if (first) first.focus();
  }

  /** R2.16 — only the ticked groups are written. */
  async function applyImport(e) {
    e.preventDefault();
    if (!pendingImport) return;
    const accept = {};
    for (const input of $("review").querySelectorAll("input[type=\"checkbox\"]")) {
      accept[input.value] = input.checked;
    }
    try {
      const data = await api(`/api/resume/${pendingImport.import_id}/apply`, {
        method: "POST",
        body: JSON.stringify({ accept }),
      });
      pendingImport = null;
      $("review").innerHTML = "";
      $("resume-file").value = "";
      await loadEditor(); // the form has to show what the server now holds

      const messages = [{ text: data.message || "Applied.", type: "success" }];
      if ((data.kept_your_edits || []).length) {
        messages.push({
          type: "info",
          text: `We kept what you had already written for: ${data.kept_your_edits.join(", ")}.`,
        });
      }
      // An imported resume can carry links this editor has no field for
      // (GitLab, Behance and so on). They are live on your public profile, but
      // the next save of this form would drop them, so say so now.
      const extras = Object.keys(profile.links || {}).filter((k) => !LINK_KEYS.includes(k));
      if (extras.length) {
        messages.push({
          type: "info",
          text: `Your resume also had ${extras.join(" and ")} links. This editor only keeps GitHub, LinkedIn and a portfolio, so saving the form above will remove the others. Paste one into the portfolio field if you want to keep it.`,
        });
      }
      report(messages);
    } catch (err) {
      report(err.message);
    }
  }

  async function discardImport() {
    if (!pendingImport) return;
    try {
      const data = await api(`/api/resume/${pendingImport.import_id}/reject`, { method: "POST" });
      pendingImport = null;
      $("review").innerHTML = "";
      $("resume-file").value = "";
      report({ text: data.message || "Those suggestions were discarded.", type: "success" });
      $("resume-file").focus();
    } catch (err) {
      report(err.message);
    }
  }

  /* ---- preview (R2.20) ---------------------------------------------- */

  // Which key each visibility control controls in the public object.
  const PUBLIC_KEY = {
    availability: "availability",
    links: "links",
    location: "location_text",
    contact_email: "contact_email",
    education: "education",
    experience: "experience",
  };

  $("preview-btn").addEventListener("click", async (e) => {
    const btn = e.currentTarget;
    const box = $("preview");
    btn.disabled = true;
    try {
      const data = await api("/api/profile/preview");
      const pub = data.public || {};
      box.innerHTML = "";

      // Same renderer the public page uses, so the preview cannot drift from
      // what a visitor receives. data-theme on the wrapper previews the theme
      // without restyling the editor around it (R2.23).
      const card = el("div", { class: "panel", "data-theme": pub.theme || "classic" });
      card.appendChild(profileBody(pub, { nameTag: "h3", sectionTag: "h4", projects: false }));
      box.appendChild(card);

      // A field is hidden when the student turned it off, and equally when it
      // is simply empty — either way a visitor does not see it, so both are
      // listed rather than only the first.
      const missing = (opts.visibility_fields || []).filter((f) => !(PUBLIC_KEY[f] in pub));
      const hidden = Array.from(new Set([].concat(data.hidden || [], missing)));
      box.appendChild(el("p", {
        class: "help",
        text: hidden.length
          ? `Not shown publicly: ${hidden.map((f) => label(VISIBILITY_LABELS, f).replace(/^Show (the|my) /, "")).join(", ")}.`
          : "Not shown publicly: nothing. Every field you filled in is public.",
      }));
      box.appendChild(el("p", {
        class: "meta",
        text: "Your projects are not in this preview. They come from the project records, which you do not edit here.",
      }));
    } catch (err) {
      showNotice(box, err.message);
    } finally {
      btn.disabled = false;
    }
  });

  start();
})();
