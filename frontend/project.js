/* Project page: description, contributors with roles, technologies, links. */
const root = document.getElementById("project");
const id = qs("id");

function notFound(message) {
  root.innerHTML = "";
  root.appendChild(el("h1", { text: "Project not found" }));
  root.appendChild(el("div", { class: "notice error", text: message }));
  root.appendChild(el("p", {}, [el("a", { class: "btn", href: "index.html", text: "Browse the talent directory" })]));
  document.title = "Project not found — ImmXrsive Talent Directory";
}

/**
 * R3.18 - R3.22 — the demo surface.
 *
 * Everything here is a LINK, never an embed. The student supplies URLs and the
 * page never injects their markup (R3.19), and because nothing is iframed, a
 * demo URL that is dead, slow or unsupported on this device cannot break the
 * project page, the profile or site navigation (R3.22) — the visitor simply
 * lands on the fallback evidence instead.
 */
function demoSection(p) {
  const section = el("section");
  section.appendChild(el("h2", { text: "Experience this project" }));

  const hasPlayable = /^https?:\/\//i.test(String(p.playable_url || "").trim());
  const hasVideo = /^https?:\/\//i.test(String(p.video_url || "").trim());
  const hasImage = /^https?:\/\//i.test(String(p.fallback_image_url || "").trim());

  if (hasPlayable) {
    // R3.20 — one clear action where a playable URL exists.
    const a = externalLink("Play demo", p.playable_url);
    a.className = "btn";
    section.appendChild(el("p", {}, [a]));
    section.appendChild(el("p", {
      class: "help",
      text: "The demo opens in a new tab. Interactive experiences may not run on every device or browser — the fallback evidence below describes the project either way.",
    }));
  }
  if (hasVideo) {
    section.appendChild(el("p", {}, [externalLink("Watch a recorded demo", p.video_url)]));
  }

  // R3.21 — fallback evidence, shown whenever it exists. It is not hidden just
  // because a playable URL is present: the playable one may fail on this
  // device, and the visitor still needs something to look at.
  if (hasImage) {
    const figure = el("figure", { class: "demo-fallback" });
    const img = el("img", {
      src: p.fallback_image_url,
      alt: `Fallback image for ${p.title}`,
      loading: "lazy",
    });
    // If even the fallback image fails to load, replace it with words rather
    // than leaving a broken-image icon (R3.22).
    img.onerror = () => {
      const note = el("p", { class: "meta", text: "The fallback image could not be loaded." });
      if (img.parentNode) img.parentNode.replaceChild(note, img);
    };
    figure.appendChild(img);
    if (p.fallback_note) figure.appendChild(el("figcaption", { class: "help", text: p.fallback_note }));
    section.appendChild(figure);
  } else if (p.fallback_note) {
    section.appendChild(el("p", { class: "prose", text: p.fallback_note }));
  }

  if (!hasPlayable && !hasVideo && !hasImage && !p.fallback_note) {
    section.appendChild(el("p", {
      class: "meta",
      text: "No demo or media has been added for this project yet. The description, technologies and contributor roles above are the available evidence.",
    }));
  } else if (!hasPlayable) {
    section.appendChild(el("p", {
      class: "meta",
      text: "This project has no browser-playable demo. The evidence above and any media listed here describe the work instead.",
    }));
  }
  return section;
}

function render(p) {
  document.title = `${p.title} — ImmXrsive Talent Directory`;
  root.innerHTML = "";

  root.appendChild(el("h1", { text: p.title }));
  if (p.domain) root.appendChild(el("p", { class: "lede", text: p.domain }));

  const panel = el("div", { class: "panel" });
  panel.appendChild(el("p", { text: p.description || "No description provided." }));

  panel.appendChild(el("h2", { text: "Technologies used" }));
  panel.appendChild(tagList(p.technologies));
  panel.appendChild(el("p", {
    class: "help",
    text: "Technologies describe the project. They are not automatically claimed as any contributor's personal skill.",
  }));

  const links = Object.entries(p.links || {}).filter(([, url]) => url);
  const repositories = p.repositories || [];
  panel.appendChild(el("h2", { text: "Links and media" }));
  if (links.length === 0 && repositories.length === 0) {
    panel.appendChild(el("p", { class: "meta", text: "No public links provided." }));
  } else {
    const ul = el("ul", { class: "tags" });
    for (const [label, url] of links) {
      ul.appendChild(el("li", {}, [externalLink(titleCase(label), url)]));
    }
    // R3.04 — a project may hold zero, one or several repositories, so they are
    // listed rather than assumed to be a single "the" repository.
    repositories.forEach((url, i) => {
      const label = repositories.length > 1 ? `View source ${i + 1}` : "View source";
      ul.appendChild(el("li", {}, [externalLink(label, url)]));
    });
    panel.appendChild(ul);
    panel.appendChild(el("p", { class: "help", text: "External links open in a new tab and are maintained by their owners." }));
  }

  // Inquiry from a project identifies the PROJECT, not one arbitrary contributor (R1.19).
  panel.appendChild(el("p", {}, [
    el("a", { class: "btn", href: inquiryUrl("project", p.id, p.title), text: "Enquire about this project" }),
  ]));
  root.appendChild(panel);

  root.appendChild(demoSection(p));

  root.appendChild(el("h2", { text: "Contributors" }));
  if (!p.contributors || p.contributors.length === 0) {
    root.appendChild(el("p", { class: "meta", text: "No published contributors are listed for this project." }));
    return;
  }

  root.appendChild(el("p", {
    class: "help",
    text: "Everyone listed here accepted an invitation to this project. People who were invited but have not accepted are not shown.",
  }));

  const list = el("ul", { class: "cards" });
  for (const c of p.contributors) {
    const li = el("li", { class: "card" });
    const h3 = el("h3");
    h3.appendChild(el("a", { href: studentUrl(c.student_id), text: c.name }));
    li.appendChild(h3);
    // R3.15 — the standardized role, plus who maintains the shared record, so
    // a visitor understands each person's part without a legend.
    li.appendChild(el("p", {
      class: "meta",
      text: c.is_maintainer
        ? `Role: ${c.role || "Contributor"} · maintains this project`
        : `Role: ${c.role || "Contributor"}`,
    }));
    // R3.11 — written by that contributor, about their own contribution.
    if (c.contribution_statement) {
      li.appendChild(el("p", { class: "prose", text: c.contribution_statement }));
    }
    li.appendChild(el("p", { class: "headline", text: c.headline || "" }));
    list.appendChild(li);
  }
  root.appendChild(list);
}

(async function start() {
  if (!id) {
    notFound("No project was specified in the address.");
    return;
  }
  try {
    render(await apiGet(`/api/projects/${encodeURIComponent(id)}`));
  } catch (err) {
    if (err.notFound) {
      notFound(`We could not find a project with the id “${id}”. It may have been removed or the link may be mistyped.`);
    } else {
      console.error(err);
      root.innerHTML = "";
      showNotice(root, "Could not load this project right now. The service may still be starting up — please retry in a moment.");
    }
  }
})();
