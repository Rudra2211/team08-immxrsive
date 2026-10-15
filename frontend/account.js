/* Account page: sign in, verify Algoma affiliation, reach the profile editor.
   Cookies are cross-origin here, so every call sends credentials. */
(function () {
  const $ = (id) => document.getElementById(id);
  const notice = $("notice");

  /** Same shape as apiGet in app.js, but credentialed and able to POST. */
  async function api(path, options = {}) {
    const res = await fetch(`${API}${path}`, {
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      ...options,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || "Something went wrong. Please try again.");
    return data;
  }

  function show(step) {
    for (const s of ["step-signin", "step-verify", "step-profile"]) {
      $(s).hidden = s !== step;
    }
  }

  function describeProfile(profile) {
    if (!profile) return "You have not created a profile yet.";
    const states = {
      draft: "Your profile is a private draft. Nobody else can see it yet.",
      unpublished: "Your profile is unpublished. It is saved, but not in the public directory.",
      published: "Your profile is published and visible in the public directory.",
    };
    return states[profile.profile_status] || "Your profile is saved.";
  }

  async function refresh() {
    try {
      const me = await api("/api/me");
      $("signout-row").hidden = !me.signed_in;

      if (!me.signed_in) {
        $("signin-link").href = `${API}/auth/github`;
        return show("step-signin");
      }
      if (!me.verified) {
        $("signed-in-as").textContent = `Signed in as ${me.github_login} on GitHub.`;
        return show("step-verify");
      }
      $("verified-as").textContent = `Verified as ${me.algoma_email}.`;
      $("profile-state").textContent = describeProfile(me.profile);
      $("edit-link").textContent = me.profile ? "Edit your profile" : "Create your profile";
      show("step-profile");
    } catch (err) {
      showNotice(notice, err.message);
    }
  }

  $("request-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    notice.innerHTML = "";
    const btn = $("request-btn");
    btn.disabled = true;
    try {
      const data = await api("/api/verify/request", {
        method: "POST",
        body: JSON.stringify({ email: $("email").value.trim() }),
      });
      showNotice(notice, data.message, "success");
      $("confirm-form").hidden = false;
      $("code").focus();
    } catch (err) {
      showNotice(notice, err.message);
      $("email").focus();
    } finally {
      btn.disabled = false;
    }
  });

  $("resend-btn").addEventListener("click", () => {
    $("confirm-form").hidden = true;
    $("email").focus();
  });

  $("confirm-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    notice.innerHTML = "";
    const btn = $("confirm-btn");
    btn.disabled = true;
    try {
      await api("/api/verify/confirm", {
        method: "POST",
        body: JSON.stringify({ code: $("code").value.trim() }),
      });
      showNotice(notice, "Your Algoma affiliation is confirmed.", "success");
      await refresh();
    } catch (err) {
      showNotice(notice, err.message);
      $("code").focus();
      $("code").select();
    } finally {
      btn.disabled = false;
    }
  });

  $("signout-btn").addEventListener("click", async () => {
    try {
      await api("/auth/signout", { method: "POST" });
    } catch (_) {
      /* signing out locally is still the right outcome */
    }
    location.href = "account.html";
  });

  // A failed OAuth round trip comes back with ?error=
  const err = qs("error");
  if (err) {
    showNotice(notice, err);
    history.replaceState(null, "", "account.html");
  }

  refresh();
})();
