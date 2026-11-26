/*
 * "Talent in orbit": the home hero's globe of student cards.
 *
 * Pure CSS 3D (no WebGL, no images): about sixty badge tiles sit on
 * latitude rings of a sphere that turns slowly. Drag to spin it; click a tile
 * to bring that student's card forward, with a link to the full profile.
 *
 * It only re-presents the students the directory already loaded (the first
 * page), so it adds no request (F.28) and no heavy asset (F.29). The globe is
 * decoration for pointer users (aria-hidden, no tab stops): every student it
 * shows is also in the keyboard-accessible results list below it. Anyone who
 * asked for less motion gets a still globe they can still drag.
 */
(function orbit() {
  const host = document.querySelector(".orbit");
  if (!host) return;
  const sphere = host.querySelector(".orbit-sphere");
  const countEl = document.querySelector(".orbit-count b");
  const totalEl = document.querySelector(".orbit-count i");
  const focus = document.getElementById("orbit-focus");
  const calm = window.matchMedia("(prefers-reduced-motion: reduce)");

  const BANDS = [
    ["#3dfc8f", "#40c4ff"], ["#a87bff", "#ff68b2"], ["#ffb040", "#ff5c78"],
    ["#40c4ff", "#a87bff"], ["#ff68b2", "#ffd65c"], ["#2bd9a0", "#3d7bff"],
  ];
  const RINGS = [-62, -37, -12, 12, 37, 62];
  const rad = (d) => (d * Math.PI) / 180;

  let tiles = [];
  let students = [];
  let R = 240;
  let rx = -12;
  let ry = 0;
  let vy = calm.matches ? 0 : 0.12; // degrees per frame
  let dragging = null;
  let hover = false;
  let openIndex = -1;

  const initials = (name) =>
    String(name || "?").split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join("");

  function build() {
    R = Math.max(130, Math.min(host.clientWidth, host.clientHeight || host.clientWidth) * 0.45);
    const tw = Math.round(R * 0.44);
    const th = Math.round(R * 0.32);
    sphere.innerHTML = "";
    tiles = [];
    let n = 0;
    for (const lat of RINGS) {
      const count = Math.max(5, Math.round(12 * Math.cos(rad(lat))));
      for (let i = 0; i < count; i += 1) {
        const lon = (360 / count) * i + (RINGS.indexOf(lat) % 2 ? 180 / count : 0);
        const t = document.createElement("div");
        t.className = "orbit-tile is-empty";
        t.style.width = `${tw}px`;
        t.style.height = `${th}px`;
        t.style.margin = `${-th / 2}px 0 0 ${-tw / 2}px`;
        t.style.transform = `rotateY(${lon}deg) rotateX(${lat}deg) translateZ(${R}px)`;
        sphere.appendChild(t);
        tiles.push({ el: t, lon: rad(lon), lat: rad(lat), student: -1 });
        n += 1;
      }
    }
    fill();
  }

  /** Cycle the loaded students across every tile, like the shot's repeated work. */
  function fill() {
    if (!students.length) return;
    tiles.forEach((tile, i) => {
      // A stride of 7 spreads the repeats of one student around the globe.
      const k = (i * 7) % students.length;
      const s = students[k];
      const [a, b] = BANDS[k % BANDS.length];
      tile.student = k;
      tile.el.className = "orbit-tile";
      tile.el.style.setProperty("--a", a);
      tile.el.style.setProperty("--b", b);
      tile.el.innerHTML = "";
      tile.el.appendChild(el("span", { class: "orbit-ava", text: initials(s.name) }));
      tile.el.appendChild(el("span", { class: "orbit-name", text: s.name }));
      tile.el.appendChild(el("span", { class: "orbit-head", text: s.headline || (s.skills || []).slice(0, 2).join(" · ") }));
    });
  }

  /** Dim tiles turning away from the viewer, so the back of the globe reads as depth. */
  function shade() {
    const sx = Math.sin(rad(rx));
    const cx = Math.cos(rad(rx));
    const sy = Math.sin(rad(ry));
    const cy = Math.cos(rad(ry));
    for (const t of tiles) {
      const x = Math.sin(t.lon) * Math.cos(t.lat);
      const y = -Math.sin(t.lat);
      const z = Math.cos(t.lon) * Math.cos(t.lat);
      const z1 = -sy * x + cy * z;
      const z2 = sx * y + cx * z1;
      const front = z2 > 0.05;
      t.el.style.opacity = front ? String(Math.min(1, 0.45 + z2)) : "0.55";
      t.el.classList.toggle("is-back", !front);
    }
  }

  function frame() {
    if (!dragging && !hover && openIndex < 0) ry += vy;
    if (!dragging) {
      // Inertia after a fling settles back to the idle spin.
      const idle = calm.matches ? 0 : 0.12;
      vy += (idle - vy) * 0.02;
    }
    sphere.style.transform = `rotateX(${rx}deg) rotateY(${ry}deg)`;
    shade();
    requestAnimationFrame(frame);
  }

  host.addEventListener("pointerenter", () => { hover = true; });
  host.addEventListener("pointerleave", () => { hover = false; });
  host.addEventListener("pointerdown", (e) => {
    dragging = { lastX: e.clientX, lastY: e.clientY, moved: 0, target: e.target };
    host.setPointerCapture(e.pointerId);
  });
  host.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    const dx = e.clientX - dragging.lastX;
    const dy = e.clientY - dragging.lastY;
    dragging.moved += Math.abs(dx) + Math.abs(dy);
    dragging.lastX = e.clientX;
    dragging.lastY = e.clientY;
    ry += dx * 0.3;
    rx = Math.max(-40, Math.min(40, rx - dy * 0.2));
    vy = dx * 0.3;
  });
  host.addEventListener("pointerup", (e) => {
    const d = dragging;
    dragging = null;
    if (!d || d.moved > 6) return;
    // A tap, not a drag: open the tile it started on, if that tile faces us.
    const tileEl = d.target && d.target.closest ? d.target.closest(".orbit-tile") : null;
    const tile = tiles.find((t) => t.el === tileEl);
    if (tile && tile.student >= 0 && !tile.el.classList.contains("is-back")) open(tile.student, tile.el);
  });
  host.addEventListener("pointercancel", () => { dragging = null; });

  // ---- the focused card ---------------------------------------------------
  let returnFocus = null;
  function open(k, fromEl) {
    const s = students[k];
    if (!s || !focus) return;
    openIndex = k;
    returnFocus = document.activeElement;
    const [a, b] = BANDS[k % BANDS.length];
    const card = focus.querySelector(".orbit-card");
    card.style.setProperty("--a", a);
    card.style.setProperty("--b", b);
    if (fromEl) {
      const r = fromEl.getBoundingClientRect();
      card.style.setProperty("--fx", `${r.left + r.width / 2 - innerWidth / 2}px`);
      card.style.setProperty("--fy", `${r.top + r.height / 2 - innerHeight / 2}px`);
    }
    const state = s.talent_state === "active" ? "Active Talent"
      : s.talent_state === "showcase" ? "Showcase Only" : "Availability not recently confirmed";
    focus.querySelector(".orbit-card-tag").textContent = `${titleCase(s.status)} · ${state}`;
    focus.querySelector(".orbit-card-ava").textContent = initials(s.name);
    focus.querySelector("#orbit-focus-name").textContent = s.name;
    focus.querySelector(".orbit-card-head").textContent = s.headline || "";
    const tags = focus.querySelector(".orbit-card-tags");
    tags.innerHTML = "";
    (s.skills || []).slice(0, 6).forEach((x) => tags.appendChild(el("li", { class: "tag", text: x })));
    const n = Number(s.project_count || 0);
    focus.querySelector(".orbit-card-meta").textContent =
      `${n} project${n === 1 ? "" : "s"} of evidence · ${availabilityText(s)}`;
    focus.querySelector(".orbit-bar-name").textContent = s.name;
    const link = focus.querySelector(".orbit-bar-link");
    link.href = studentUrl(s.id);
    if (countEl) countEl.textContent = String(k + 1).padStart(2, "0");
    focus.hidden = false;
    link.focus();
  }

  function close() {
    if (!focus || focus.hidden) return;
    openIndex = -1;
    if (countEl) countEl.textContent = "00";
    focus.hidden = true;
    if (returnFocus && returnFocus.focus) returnFocus.focus();
  }

  if (focus) {
    focus.querySelector(".orbit-bar-close").addEventListener("click", close);
    focus.addEventListener("click", (e) => { if (e.target === focus) close(); });
    focus.addEventListener("keydown", (e) => {
      if (e.key === "Escape") close();
      // Keep Tab inside the card's two controls while it is open.
      if (e.key === "Tab") {
        const items = [...focus.querySelectorAll("button, a[href]")];
        const i = items.indexOf(document.activeElement);
        e.preventDefault();
        items[(i + (e.shiftKey ? items.length - 1 : 1)) % items.length].focus();
      }
    });
  }

  /** Called by directory.js after each fresh (non-appended) load. */
  window.ImmOrbit = {
    show(list) {
      if (!Array.isArray(list) || !list.length) return;
      students = list.slice(0, 24);
      if (totalEl) totalEl.textContent = String(students.length).padStart(2, "0");
      fill();
    },
  };

  let resizeTimer = 0;
  window.addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(build, 200);
  });
  build();
  requestAnimationFrame(frame);
})();
