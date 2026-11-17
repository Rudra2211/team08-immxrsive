/*
 * Staff home (R4.03, R4.05, R4.21, R4.25).
 * The first staff screen is a list of TASKS — verify a project, review a
 * partner request, review a partner draft — each with one clear action. Staff
 * never see table names, ids as the main label, or state-machine words.
 */
(async function adminHome() {
  const notice = document.getElementById("notice");
  const workspace = document.getElementById("workspace");
  const review = document.getElementById("review");

  function say(message, type = "error") {
    showNotice(notice, message, type);
    notice.scrollIntoView({ block: "nearest" });
  }

  function when(iso) {
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
  }

  document.getElementById("signout-btn").addEventListener("click", async () => {
    await apiCall("/auth/signout", { method: "POST" }).catch(() => {});
    window.location.assign("staff-login.html");
  });

  let me;
  try {
    me = await apiCall("/api/me");
  } catch {
    return say("The staff workspace could not be reached. Check your connection and reload.");
  }
  if (!me.signed_in || me.role !== "staff") {
    workspace.hidden = true;
    say(me.signed_in
      ? "This area is only for ImmXrsive staff. You are signed in with a student account."
      : "Sign in with your staff account to see the work queue.");
    notice.appendChild(el("p", {}, [el("a", { class: "btn", href: "staff-login.html", text: "Go to staff sign-in" })]));
    return;
  }
  document.getElementById("who").textContent = `Signed in as ${me.github_login} (staff)`;
  workspace.hidden = false;

  function setCount(idName, n) {
    document.getElementById(idName).textContent = n ? `(${n} waiting)` : "";
  }

  function emptyRow(list, text) {
    list.appendChild(el("li", {}, [el("span", { class: "meta", text })]));
  }

  async function load() {
    let queue;
    let partners;
    try {
      [queue, partners] = await Promise.all([apiCall("/api/staff/queue"), apiCall("/api/staff/companies")]);
    } catch (err) {
      return say(err.message);
    }

    const verifyList = document.getElementById("verify-list");
    verifyList.innerHTML = "";
    setCount("verify-count", queue.project_verifications.length);
    if (!queue.project_verifications.length) emptyRow(verifyList, "No projects are waiting for verification.");
    for (const v of queue.project_verifications) {
      const btn = el("button", { type: "button", text: "Verify project" });
      btn.addEventListener("click", () => openVerification(v.id));
      verifyList.appendChild(el("li", { class: "stack" }, [
        el("p", { text: v.project_title }),
        el("p", { class: "meta", text: `Requested by ${v.requested_by} on ${when(v.created_at)}` }),
        el("p", { class: "prose", text: v.note }),
        el("p", {}, [btn]),
      ]));
    }

    const reqList = document.getElementById("requests-list");
    reqList.innerHTML = "";
    setCount("requests-count", queue.partner_requests.length);
    if (!queue.partner_requests.length) emptyRow(reqList, "No partner requests are waiting.");
    for (const r of queue.partner_requests) {
      const btn = el("button", { type: "button", text: "Review partner request" });
      btn.addEventListener("click", () => openPartnerRequest(r.id));
      reqList.appendChild(el("li", { class: "stack" }, [
        el("p", { text: `${r.project_title} worked with ${r.company_name}` }),
        el("p", {
          class: "meta",
          text: `Requested by ${r.requested_by} on ${when(r.created_at)} · ${r.existing_company ? "existing partner" : "new company suggested by the student"}`,
        }),
        el("p", { class: "prose", text: r.explanation }),
        el("p", {}, [btn]),
      ]));
    }

    const draftList = document.getElementById("drafts-list");
    draftList.innerHTML = "";
    setCount("drafts-count", queue.company_drafts.length);
    if (!queue.company_drafts.length) emptyRow(draftList, "No partner drafts are waiting for review.");
    for (const d of queue.company_drafts) {
      draftList.appendChild(el("li", { class: "stack" }, [
        el("p", { text: d.name }),
        el("p", {
          class: "meta",
          text: d.imported_from ? `Imported from ${d.imported_from} · last changed ${when(d.updated_at)}` : `Entered manually · last changed ${when(d.updated_at)}`,
        }),
        el("p", {}, [el("a", { class: "btn", href: `admin-partner.html?id=${encodeURIComponent(d.id)}`, text: "Review partner" })]),
      ]));
    }

    const partnerList = document.getElementById("partners-list");
    partnerList.innerHTML = "";
    if (!partners.length) emptyRow(partnerList, "No partners yet. Add one manually or import it from the company's website.");
    for (const p of partners) {
      partnerList.appendChild(el("li", {}, [
        el("span", {}, [
          el("strong", { text: p.name }),
          document.createTextNode(` · ${p.status === "published" ? "public" : "not public yet"} · ${p.collaboration_count} ${p.collaboration_count === 1 ? "collaboration" : "collaborations"}`),
        ]),
        el("a", { class: "btn secondary", href: `admin-partner.html?id=${encodeURIComponent(p.id)}`, text: "Open" }),
      ]));
    }
  }

  function closeReview() {
    review.hidden = true;
    review.innerHTML = "";
  }

  function decisionForm(onDecide, extra) {
    const form = el("form", { novalidate: "" });
    if (extra) form.appendChild(extra);
    form.appendChild(el("label", { for: "decision-note", text: "Note to the student (required if you reject)" }));
    form.appendChild(el("textarea", { id: "decision-note", rows: "2" }));
    const approve = el("button", { type: "submit", text: "Approve" });
    const reject = el("button", { type: "button", class: "secondary", text: "Reject" });
    const cancel = el("button", { type: "button", class: "secondary", text: "Back to the work queue" });
    cancel.addEventListener("click", closeReview);
    const submit = async (decision) => {
      approve.disabled = true;
      reject.disabled = true;
      try {
        await onDecide(decision, form.querySelector("#decision-note").value.trim());
        closeReview();
        say(decision === "approve" ? "Approved. The public site now reflects your decision." : "Rejected. The student will see your note.", "success");
        await load();
      } catch (err) {
        showNotice(review.querySelector(".review-notice"), err.message);
        approve.disabled = false;
        reject.disabled = false;
      }
    };
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      submit("approve");
    });
    reject.addEventListener("click", () => submit("reject"));
    form.appendChild(el("p", {}, [approve, reject, cancel]));
    return form;
  }

  function showReview(title, nodes) {
    review.innerHTML = "";
    review.appendChild(el("h2", { text: title }));
    review.appendChild(el("div", { class: "review-notice", role: "alert" }));
    nodes.forEach((n) => review.appendChild(n));
    review.hidden = false;
    review.focus();
    review.scrollIntoView({ block: "start" });
  }

  // R4.05 — the project, its contributors and the request, then a decision.
  async function openVerification(rid) {
    let d;
    try {
      d = await apiCall(`/api/staff/verifications/${encodeURIComponent(rid)}`);
    } catch (err) {
      return say(err.message);
    }
    const p = d.project;
    const facts = el("dl", { class: "facts" });
    const fact = (t, node) => {
      facts.appendChild(el("dt", { text: t }));
      facts.appendChild(el("dd", {}, [typeof node === "string" ? document.createTextNode(node) : node]));
    };
    fact("Project", p.title);
    fact("Public page", p.project_status === "published"
      ? el("a", { href: projectUrl(p.id), target: "_blank", rel: "noopener", text: "Open the public project page" })
      : "Not published yet");
    if (p.domain) fact("Type", p.domain);
    if (p.technologies.length) fact("Technologies", p.technologies.join(", "));
    fact("Requested by", `${d.request.requested_by_name}`);
    fact("Their reason", d.request.note);
    if (d.request.evidence_url) fact("Supporting link", externalLink(d.request.evidence_url, d.request.evidence_url));

    const people = el("ul", { class: "row-list" });
    for (const c of d.contributors) {
      const state = c.removed_at ? "removed" : c.status === "accepted" ? "accepted" : c.status === "invited" ? "invited, not yet accepted" : c.status;
      people.appendChild(el("li", { class: "stack" }, [
        el("p", { text: `${c.name}${c.is_maintainer ? " (maintainer)" : ""}` }),
        el("p", { class: "meta", text: `${c.role || "Contributor"} · ${state}` }),
        c.contribution_statement ? el("p", { class: "prose", text: c.contribution_statement }) : null,
      ]));
    }

    showReview("Verify project", [
      el("p", { class: "prose", text: p.description || "No description." }),
      facts,
      el("h3", { text: "Contributors" }),
      people,
      decisionForm((decision, note) =>
        apiCall(`/api/staff/verifications/${encodeURIComponent(rid)}/decision`, { method: "POST", body: { decision, note } })
      ),
    ]);
  }

  // R4.21 — approving is the only way a project-partner link becomes public.
  async function openPartnerRequest(rid) {
    let d;
    let options;
    try {
      [d, options] = await Promise.all([
        apiCall(`/api/staff/partner-requests/${encodeURIComponent(rid)}`),
        apiCall("/api/staff/options"),
      ]);
    } catch (err) {
      return say(err.message);
    }

    const facts = el("dl", { class: "facts" });
    const fact = (t, v) => {
      facts.appendChild(el("dt", { text: t }));
      facts.appendChild(el("dd", {}, [typeof v === "string" ? document.createTextNode(v) : v]));
    };
    fact("Project", d.project_status === "published"
      ? el("a", { href: projectUrl(d.project_id), target: "_blank", rel: "noopener", text: d.project_title })
      : `${d.project_title} (not published yet)`);
    fact("Requested by", d.requested_by_name);
    fact("Company", d.company_name || d.suggested_name);
    if (!d.company_id && d.suggested_website) fact("Suggested website", externalLink(d.suggested_website, d.suggested_website));
    fact("How they worked together", d.explanation);

    // Which partner record the approval links to.
    const choice = el("div");
    choice.appendChild(el("label", { for: "link-company", text: "Link this project to" }));
    const select = el("select", { id: "link-company" });
    if (!d.company_id) {
      select.appendChild(el("option", { value: "__new", text: `A new partner draft named "${d.suggested_name}"` }));
    }
    for (const c of options.companies) {
      const opt = el("option", { value: c.id, text: `${c.name}${c.status === "draft" ? " (not public yet)" : ""}` });
      if (c.id === d.company_id || (!d.company_id && d.matching_companies.some((m) => m.id === c.id))) opt.selected = true;
      select.appendChild(opt);
    }
    choice.appendChild(select);
    if (d.matching_companies.length) {
      choice.appendChild(el("p", {
        class: "help",
        text: `A partner with the same website already exists (${d.matching_companies.map((m) => m.name).join(", ")}). It is selected so you do not create a duplicate.`,
      }));
    } else if (!d.company_id) {
      choice.appendChild(el("p", {
        class: "help",
        text: "Choosing the new draft creates a partner that is NOT public yet. Complete and publish it from the partner list before it appears on the project page.",
      }));
    }

    showReview("Review partner request", [
      facts,
      decisionForm(
        (decision, note) => {
          const body = { decision, note };
          if (decision === "approve") {
            if (select.value === "__new") body.create_draft = true;
            else body.company_id = select.value;
          }
          return apiCall(`/api/staff/partner-requests/${encodeURIComponent(rid)}/decision`, { method: "POST", body });
        },
        choice
      ),
    ]);
  }

  await load();
})();
