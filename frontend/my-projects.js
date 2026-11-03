/* Your projects — R3.01 to R3.03, R3.08, R3.09, R3.16.
   Cookies are cross-origin here, so every call sends credentials, exactly as
   on account.html and profile-edit.html. */
(function () {
  const $ = (id) => document.getElementById(id);
  const notice = $("notice");

  let options = { roles: [], domains: [] };

  async function api(path, opts = {}) {
    const res = await fetch(`${API}${path}`, {
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      ...opts,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(data.error || "Something went wrong. Please try again.");
      err.status = res.status;
      err.data = data;
      throw err;
    }
    return data;
  }

  function say(message, type = "error") {
    showNotice(notice, message, type);
    notice.scrollIntoView({ block: "nearest" });
  }

  function gate(title, text) {
    $("gate-title").textContent = title;
    $("gate-text").textContent = text;
    $("gate").hidden = false;
    $("main-content").hidden = true;
  }

  function fillSelect(select, values, placeholder) {
    select.innerHTML = "";
    if (placeholder) select.appendChild(el("option", { value: "", text: placeholder }));
    for (const v of values) select.appendChild(el("option", { value: v, text: v }));
  }

  // -------------------------------------------------------------------------
  // Lists
  // -------------------------------------------------------------------------

  function projectRow(p) {
    const li = el("li", { class: "stack" });
    li.appendChild(
      el("p", {}, [el("a", { href: `project-edit.html?id=${encodeURIComponent(p.id)}`, text: p.title })])
    );

    const bits = [];
    if (p.domain) bits.push(p.domain);
    bits.push(p.project_status === "published" ? "published" : "private draft");
    if (p.my_role) bits.push(`your role: ${p.my_role}`);
    bits.push(`${p.accepted_contributors} contributor${p.accepted_contributors === 1 ? "" : "s"}`);
    // R3.12 — say plainly when the student has hidden it from their own profile.
    if (p.featured === false) bits.push("hidden from your profile");
    li.appendChild(el("p", { class: "meta", text: bits.join(" · ") }));

    if (p.project_status === "published") {
      li.appendChild(el("p", {}, [el("a", { href: projectUrl(p.id), text: "View the public page" })]));
    }
    return li;
  }

  function renderInvitations(rows) {
    const list = $("invitations");
    list.innerHTML = "";
    $("invitations-panel").hidden = rows.length === 0;

    for (const p of rows) {
      const li = el("li", { class: "stack" });
      li.appendChild(el("p", { text: p.title }));
      li.appendChild(
        el("p", {
          class: "meta",
          text: `Proposed role: ${p.my_role || "Contributor"}${p.domain ? " · " + p.domain : ""}`,
        })
      );

      const accept = el("button", { type: "button", text: "Accept" });
      const decline = el("button", { type: "button", class: "secondary", text: "Decline" });
      // R3.09 — the invited student answers. Nobody answers on their behalf.
      accept.onclick = () => respond(p.id, true, accept, decline);
      decline.onclick = () => respond(p.id, false, accept, decline);
      li.appendChild(el("p", {}, [accept, decline]));
      list.appendChild(li);
    }
  }

  async function respond(projectId, accept, ...buttons) {
    for (const b of buttons) b.disabled = true;
    try {
      await api(`/api/my/projects/${encodeURIComponent(projectId)}/respond`, {
        method: "POST",
        body: JSON.stringify({ accept }),
      });
      say(
        accept
          ? "Invitation accepted. You are now shown as a contributor, and you can write your own contribution statement from the project's page."
          : "Invitation declined. You are not shown as a contributor.",
        "success"
      );
      await load();
    } catch (err) {
      say(err.message);
      for (const b of buttons) b.disabled = false;
    }
  }

  async function load() {
    const data = await api("/api/my/projects");
    renderInvitations(data.invitations || []);

    const maintaining = $("maintaining");
    maintaining.innerHTML = "";
    if ((data.maintaining || []).length === 0) {
      maintaining.appendChild(
        el("li", { class: "meta", text: "You do not maintain any projects yet. Add one above." })
      );
    } else {
      for (const p of data.maintaining) maintaining.appendChild(projectRow(p));
    }

    const contributing = $("contributing");
    contributing.innerHTML = "";
    if ((data.contributing || []).length === 0) {
      contributing.appendChild(
        el("li", { class: "meta", text: "You are not a contributor on anyone else's project yet." })
      );
    } else {
      for (const p of data.contributing) contributing.appendChild(projectRow(p));
    }
  }

  // -------------------------------------------------------------------------
  // R3.16 — duplicate warning
  // -------------------------------------------------------------------------

  /**
   * Advisory only. It reports what already exists and offers a route to the
   * existing project; it never blocks saving and never merges records.
   */
  async function checkDuplicates() {
    const box = $("duplicate");
    box.innerHTML = "";
    const repository = $("repository").value.trim();
    const title = $("title").value.trim();
    if (!repository && !title) return;

    let data;
    try {
      const params = new URLSearchParams();
      if (repository) params.set("repository", repository);
      if (title) params.set("title", title);
      if ($("domain").value) params.set("domain", $("domain").value);
      data = await api(`/api/projects/duplicate-check?${params}`);
    } catch {
      return; // a failed advisory check must never get in the way of saving
    }

    const repoMatches = data.repository_matches || [];
    const titleMatches = data.title_matches || [];
    if (repoMatches.length === 0 && titleMatches.length === 0) return;

    const panel = el("div", { class: repoMatches.length ? "notice error" : "notice" });
    panel.appendChild(
      el("p", {
        text: repoMatches.length
          ? "That repository is already connected to a project here. Join the existing project rather than creating a second copy of it:"
          : "A project with a similar name already exists. It may be the same work, or unrelated — this is only a heads-up:",
      })
    );

    const ul = el("ul", { class: "row-list" });
    for (const m of repoMatches.concat(titleMatches)) {
      const li = el("li", { class: "stack" });
      li.appendChild(el("p", {}, [el("a", { href: projectUrl(m.id), text: m.title })]));
      if (m.domain) li.appendChild(el("p", { class: "meta", text: m.domain }));
      ul.appendChild(li);
    }
    panel.appendChild(ul);
    panel.appendChild(
      el("p", {
        class: "help",
        text: "Nothing has been merged or changed. If yours really is separate work, carry on and save it.",
      })
    );
    box.appendChild(panel);
  }

  // -------------------------------------------------------------------------
  // R3.03 — GitHub import
  // -------------------------------------------------------------------------

  $("import-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = $("import-btn");
    const repository = $("import-url").value.trim();
    if (!repository) return say("Paste a public GitHub repository URL first.");

    btn.disabled = true;
    btn.textContent = "Fetching…";
    try {
      const { suggestions } = await api("/api/projects/import-github", {
        method: "POST",
        body: JSON.stringify({ repository }),
      });
      // Suggestions only — they land in the form as editable values (R3.03).
      if (suggestions.title) $("title").value = suggestions.title;
      if (suggestions.description) $("description").value = suggestions.description;
      if (suggestions.technologies && suggestions.technologies.length) {
        $("technologies").value = suggestions.technologies.join(", ");
      }
      if (suggestions.repository) $("repository").value = suggestions.repository;
      say("Suggestions filled in from GitHub. Change anything you like, then choose Save project.", "success");
      await checkDuplicates();
    } catch (err) {
      say(err.message);
    } finally {
      btn.disabled = false;
      btn.textContent = "Fetch suggestions";
    }
  });

  // -------------------------------------------------------------------------
  // R3.01, R3.02 — one Add Project workflow
  // -------------------------------------------------------------------------

  $("create-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = $("create-btn");
    const title = $("title").value.trim();
    if (!title) return say("Give the project a title before saving.");

    btn.disabled = true;
    btn.textContent = "Saving…";
    try {
      const repository = $("repository").value.trim();
      const created = await api("/api/my/projects", {
        method: "POST",
        body: JSON.stringify({
          title,
          description: $("description").value,
          domain: $("domain").value,
          date_text: $("date_text").value,
          technologies: $("technologies").value,
          role: $("role").value,
          repositories: repository ? [repository] : [],
        }),
      });
      window.location.href = `project-edit.html?id=${encodeURIComponent(created.id)}&created=1`;
    } catch (err) {
      say(err.message);
      btn.disabled = false;
      btn.textContent = "Save project";
    }
  });

  // The advisory check runs when the student leaves either field, so the
  // warning is on screen before they press Save rather than after.
  $("repository").addEventListener("blur", checkDuplicates);
  $("title").addEventListener("blur", checkDuplicates);

  // -------------------------------------------------------------------------
  // Start
  // -------------------------------------------------------------------------

  (async function start() {
    try {
      options = await api("/api/projects/options");
    } catch {
      options = { roles: [], domains: [] };
    }
    fillSelect($("role"), options.roles || [], "Choose your role");
    fillSelect($("domain"), options.domains || [], "Choose a domain");

    let me = null;
    try {
      me = await api("/api/me");
    } catch {
      me = null;
    }
    if (!me || !me.signed_in) {
      return gate(
        "Sign in first",
        "Projects belong to a student profile, so you need to sign in before you can add one."
      );
    }
    if (!me.verified) {
      return gate(
        "Confirm your Algoma affiliation",
        "We ask you to confirm your Algoma email before you add projects, so the work shown here belongs to real Algoma students."
      );
    }

    try {
      await load();
      $("gate").hidden = true;
      $("main-content").hidden = false;
    } catch (err) {
      if (err.status === 409) {
        return gate(
          "Create your profile first",
          "A project is attached to your student profile, so please create your profile before adding projects."
        );
      }
      $("main-content").hidden = false;
      say("Could not load your projects right now. The service may still be starting up — please retry in a moment.");
    }
  })();
})();
