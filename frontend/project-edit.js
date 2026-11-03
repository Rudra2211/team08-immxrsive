/* Project editor — R3.02, R3.04, R3.06 to R3.13, R3.17, R3.18, R3.21.
   Cookies are cross-origin here, so every call sends credentials. */
(function () {
  const $ = (id) => document.getElementById(id);
  const notice = $("notice");
  const projectId = qs("id");

  let options = { roles: [], domains: [] };
  let p = null; // the current editableProject view, including its version

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
    $("editor").hidden = true;
  }

  function fillSelect(select, values, placeholder) {
    select.innerHTML = "";
    if (placeholder) select.appendChild(el("option", { value: "", text: placeholder }));
    for (const v of values) {
      select.appendChild(
        el("option", { value: v.value !== undefined ? v.value : v, text: v.label || v })
      );
    }
  }

  const accepted = () =>
    (p.contributors || []).filter((c) => c.status === "accepted" && !c.removed_at);

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  function render() {
    document.title = `${p.title} — ImmXrsive`;
    $("project-title").textContent = p.title;
    $("project-lede").textContent = p.domain || "";

    const published = p.project_status === "published";
    $("status-text").textContent = published
      ? "This project is published. Anyone can see it, and it appears on the profile of every contributor who features it."
      : "This project is a private draft. Only its contributors can see it.";

    // R3.06 — say who may change what, rather than leaving it to be inferred.
    $("role-text").textContent = p.is_maintainer
      ? "You maintain this project, so you can edit its shared details and manage its contributors."
      : "A teammate maintains this project. You control your own contribution, and they maintain the shared details.";

    $("publish-row").hidden = !p.is_maintainer;
    $("public-link").innerHTML = "";
    if (published) {
      $("public-link").appendChild(el("a", { href: projectUrl(p.id), text: "View the public page" }));
    }

    renderContributionForm();
    renderSharedForm();
    renderRepositories();
    renderContributors();
  }

  /** R3.11, R3.12 — only shown to someone who has actually accepted. */
  function renderContributionForm() {
    const mine = p.my_contribution;
    const show = mine && mine.status === "accepted" && !mine.removed_at;
    $("contribution-form").hidden = !show;
    if (!show) return;
    $("contribution_statement").value = mine.contribution_statement || "";
    $("featured").checked = mine.featured !== false;
  }

  function renderSharedForm() {
    fillSelect($("domain"), options.domains || [], "Choose a domain");
    $("title").value = p.title || "";
    $("description").value = p.description || "";
    $("domain").value = p.domain || "";
    $("date_text").value = p.date_text || "";
    $("technologies").value = (p.technologies || []).join(", ");
    $("homepage").value = (p.links && p.links.homepage) || "";
    $("playable_url").value = p.playable_url || "";
    $("video_url").value = p.video_url || "";
    $("fallback_image_url").value = p.fallback_image_url || "";
    $("fallback_note").value = p.fallback_note || "";

    // A contributor who is not the maintainer sees the real values, read-only,
    // instead of an empty or hidden panel (R3.05 — one shared record).
    const readOnly = !p.is_maintainer;
    for (const id of [
      "title", "description", "domain", "date_text", "technologies", "homepage",
      "playable_url", "video_url", "fallback_image_url", "fallback_note",
    ]) {
      $(id).disabled = readOnly;
    }
    $("shared-btn").hidden = readOnly;
    $("shared-help").textContent = readOnly
      ? "These are the shared details for everyone on this project. Only the maintainer can change them."
      : "These details are shared by everyone on this project.";
  }

  /** R3.04 */
  function renderRepositories() {
    const list = $("repositories");
    list.innerHTML = "";
    const repos = p.repositories || [];
    if (repos.length === 0) {
      list.appendChild(
        el("li", {
          class: "meta",
          text: "No repository is connected. The project is complete and valid without one.",
        })
      );
    }
    for (const r of repos) {
      const li = el("li", { class: "stack" });
      li.appendChild(el("p", {}, [externalLink(r.url, r.url)]));
      if (p.is_maintainer) {
        const btn = el("button", { type: "button", class: "secondary", text: "Disconnect" });
        btn.onclick = async () => {
          btn.disabled = true;
          try {
            p = await api(`/api/my/projects/${encodeURIComponent(p.id)}/repositories`, {
              method: "DELETE",
              body: JSON.stringify({ repository: r.url }),
            });
            say("Repository disconnected. The project itself is unchanged.", "success");
            render();
          } catch (err) {
            say(err.message);
            btn.disabled = false;
          }
        };
        li.appendChild(el("p", {}, [btn]));
      }
      list.appendChild(li);
    }
    $("repo-form").hidden = !p.is_maintainer;
  }

  /** R3.08 to R3.13, R3.15 */
  function renderContributors() {
    const list = $("contributors");
    list.innerHTML = "";

    $("contributors-help").textContent = p.is_maintainer
      ? "Invited people are not shown publicly until they accept. Removing someone is reversible — you can restore them."
      : "Invited people are not shown publicly until they accept.";

    for (const c of p.contributors || []) {
      const li = el("li", { class: "stack" });
      li.appendChild(el("p", { text: c.name }));

      const bits = [c.role || "Contributor"];
      if (c.student_id === p.maintainer_student_id) bits.push("maintainer");
      if (c.status === "invited") bits.push("invited — waiting for their answer");
      if (c.status === "declined") bits.push("declined");
      if (c.removed_at) bits.push("removed — hidden publicly, restorable");
      if (c.status === "accepted" && !c.removed_at && c.featured === false) {
        bits.push("not featured on their own profile");
      }
      li.appendChild(el("p", { class: "meta", text: bits.join(" · ") }));

      if (c.contribution_statement) {
        li.appendChild(el("p", { class: "prose", text: c.contribution_statement }));
      }

      if (p.is_maintainer && c.student_id !== p.maintainer_student_id) {
        const row = el("p");

        // R3.10 — the maintainer sets the standardized role. There is no
        // control here for anyone else's contribution statement, because
        // R3.11 makes that theirs alone.
        const roleSelect = el("select", { "aria-label": `Role for ${c.name}` });
        fillSelect(roleSelect, options.roles || []);
        roleSelect.value = (options.roles || []).includes(c.role) ? c.role : "";
        roleSelect.onchange = async () => {
          if (!roleSelect.value) return;
          roleSelect.disabled = true;
          try {
            p = await api(
              `/api/my/projects/${encodeURIComponent(p.id)}/contributors/${encodeURIComponent(c.student_id)}`,
              { method: "PUT", body: JSON.stringify({ role: roleSelect.value }) }
            );
            say(`${c.name}'s role is now ${roleSelect.value}.`, "success");
            render();
          } catch (err) {
            say(err.message);
            roleSelect.disabled = false;
          }
        };
        row.appendChild(roleSelect);

        // R3.13 — remove is a reversible soft delete, and the label says so.
        const toggle = el("button", {
          type: "button",
          class: "secondary",
          text: c.removed_at ? "Restore" : "Remove from project",
        });
        toggle.onclick = async () => {
          toggle.disabled = true;
          const action = c.removed_at ? "restore" : "remove";
          try {
            p = await api(
              `/api/my/projects/${encodeURIComponent(p.id)}/contributors/${encodeURIComponent(c.student_id)}/${action}`,
              { method: "POST" }
            );
            say(
              action === "remove"
                ? `${c.name} is no longer shown publicly. Their contribution is kept and you can restore them at any time.`
                : `${c.name} has been restored, with their original contribution statement intact.`,
              "success"
            );
            render();
          } catch (err) {
            say(err.message);
            toggle.disabled = false;
          }
        };
        row.appendChild(toggle);
        li.appendChild(row);
      }
      list.appendChild(li);
    }

    $("invite-block").hidden = !p.is_maintainer;
    fillSelect($("invite-role"), options.roles || [], "Choose a role");

    // R3.07 — maintenance can only go to someone who has accepted.
    const candidates = accepted().filter((c) => c.student_id !== p.maintainer_student_id);
    $("transfer-block").hidden = !p.is_maintainer || candidates.length === 0;
    fillSelect(
      $("transfer-to"),
      candidates.map((c) => ({ value: c.student_id, label: `${c.name} (${c.role || "Contributor"})` })),
      "Choose a contributor"
    );
  }

  // -------------------------------------------------------------------------
  // Actions
  // -------------------------------------------------------------------------

  /**
   * R3.17 — the save carries the version this page loaded. A 409 means someone
   * else saved first: we show their current values and keep the student's text
   * on screen so nothing they typed is lost, rather than silently winning.
   */
  $("shared-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = $("shared-btn");
    if (!$("title").value.trim()) return say("The project needs a title.");
    btn.disabled = true;
    btn.textContent = "Saving…";
    try {
      p = await api(`/api/my/projects/${encodeURIComponent(p.id)}`, {
        method: "PUT",
        body: JSON.stringify({
          version: p.version,
          title: $("title").value,
          description: $("description").value,
          domain: $("domain").value,
          date_text: $("date_text").value,
          technologies: $("technologies").value,
          links: { homepage: $("homepage").value },
          playable_url: $("playable_url").value,
          video_url: $("video_url").value,
          fallback_image_url: $("fallback_image_url").value,
          fallback_note: $("fallback_note").value,
        }),
      });
      say("Project details saved.", "success");
      render();
    } catch (err) {
      if (err.status === 409 && err.data && err.data.current) {
        const typed = {
          title: $("title").value,
          description: $("description").value,
        };
        p = err.data.current;
        render();
        // Put their words back after the re-render so the save can be retried.
        $("title").value = typed.title;
        $("description").value = typed.description;
        say(
          `${err.message} The fields now show the saved version; your title and description are still as you typed them, so you can merge and save again.`
        );
      } else {
        say(err.message);
      }
    } finally {
      btn.disabled = false;
      btn.textContent = "Save project details";
    }
  });

  $("contribution-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = $("contribution-btn");
    btn.disabled = true;
    try {
      p = await api(`/api/my/projects/${encodeURIComponent(p.id)}/contribution`, {
        method: "PUT",
        body: JSON.stringify({
          contribution_statement: $("contribution_statement").value,
          featured: $("featured").checked,
        }),
      });
      say(
        $("featured").checked
          ? "Your contribution was saved and this project appears on your profile."
          : "Your contribution was saved. The project is hidden from your profile but you are still a credited contributor.",
        "success"
      );
      render();
    } catch (err) {
      say(err.message);
    } finally {
      btn.disabled = false;
    }
  });

  $("repo-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const input = $("new-repo");
    const btn = $("repo-btn");
    if (!input.value.trim()) return say("Paste a repository link first.");
    btn.disabled = true;
    try {
      p = await api(`/api/my/projects/${encodeURIComponent(p.id)}/repositories`, {
        method: "POST",
        body: JSON.stringify({ repository: input.value }),
      });
      input.value = "";
      say("Repository added.", "success");
      render();
    } catch (err) {
      say(err.message);
    } finally {
      btn.disabled = false;
    }
  });

  // R3.08 — find a teammate, then invite them with a standard role.
  let chosen = null;
  let searchTimer = null;
  $("invite-search").addEventListener("input", () => {
    clearTimeout(searchTimer);
    chosen = null;
    searchTimer = setTimeout(async () => {
      const q = $("invite-search").value.trim();
      const results = $("invite-results");
      results.innerHTML = "";
      if (q.length < 2) return;
      let rows = [];
      try {
        rows = await api(`/api/students/search?q=${encodeURIComponent(q)}`);
      } catch {
        return;
      }
      if (rows.length === 0) {
        results.appendChild(el("li", { class: "meta", text: "No student here matches that name." }));
        return;
      }
      for (const s of rows) {
        const li = el("li");
        const btn = el("button", { type: "button", class: "secondary", text: `Choose ${s.name}` });
        btn.onclick = () => {
          chosen = s;
          $("invite-search").value = s.name;
          results.innerHTML = "";
          results.appendChild(el("li", { class: "meta", text: `Inviting ${s.name}.` }));
        };
        li.appendChild(btn);
        results.appendChild(li);
      }
    }, 250);
  });

  $("invite-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = $("invite-btn");
    if (!chosen) return say("Search for a student and choose them from the list first.");
    if (!$("invite-role").value) return say("Choose the role you are proposing.");
    btn.disabled = true;
    try {
      p = await api(`/api/my/projects/${encodeURIComponent(p.id)}/invite`, {
        method: "POST",
        body: JSON.stringify({ student_id: chosen.student_id || chosen.id, role: $("invite-role").value }),
      });
      say(
        `Invitation sent to ${chosen.name}. They will not be shown publicly until they accept it.`,
        "success"
      );
      chosen = null;
      $("invite-search").value = "";
      $("invite-results").innerHTML = "";
      render();
    } catch (err) {
      say(err.message);
    } finally {
      btn.disabled = false;
    }
  });

  $("transfer-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const to = $("transfer-to").value;
    if (!to) return say("Choose which contributor should take over.");
    const btn = $("transfer-btn");
    btn.disabled = true;
    try {
      p = await api(`/api/my/projects/${encodeURIComponent(p.id)}/transfer`, {
        method: "POST",
        body: JSON.stringify({ student_id: to }),
      });
      say(
        "Maintenance transferred. The project keeps the same public address, and you remain a credited contributor.",
        "success"
      );
      render();
    } catch (err) {
      say(err.message);
    } finally {
      btn.disabled = false;
    }
  });

  for (const [id, route, message] of [
    ["publish-btn", "publish", "Published. The project is now public and appears on the profile of every contributor who features it."],
    ["unpublish-btn", "unpublish", "Unpublished. The project is a private draft again and everything you have written is kept."],
  ]) {
    $(id).addEventListener("click", async () => {
      $(id).disabled = true;
      try {
        p = await api(`/api/my/projects/${encodeURIComponent(p.id)}/${route}`, { method: "POST" });
        say(message, "success");
        render();
      } catch (err) {
        say(err.message);
      } finally {
        $(id).disabled = false;
      }
    });
  }

  // -------------------------------------------------------------------------
  // Start
  // -------------------------------------------------------------------------

  (async function start() {
    if (!projectId) {
      return gate("No project chosen", "Open a project from your projects list.");
    }
    try {
      options = await api("/api/projects/options");
    } catch {
      options = { roles: [], domains: [] };
    }

    try {
      p = await api(`/api/my/projects/${encodeURIComponent(projectId)}`);
    } catch (err) {
      if (err.status === 401) {
        return gate("Sign in first", "Sign in to open your projects.");
      }
      if (err.status === 403) {
        return gate(
          "Not your project",
          "You are not a contributor on this project, so you cannot open its editor. If a teammate meant to add you, ask them to send an invitation."
        );
      }
      if (err.status === 404) {
        return gate("Project not found", "This project may have been deleted, or the link may be mistyped.");
      }
      return gate("Could not load the project", "The service may still be starting up. Please retry in a moment.");
    }

    $("gate").hidden = true;
    $("editor").hidden = false;
    render();

    if (qs("created")) {
      say(
        "Project created as a private draft. Add a demo link and invite your teammates, then publish it when you are ready.",
        "success"
      );
    }
  })();
})();
