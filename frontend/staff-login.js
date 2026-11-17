/* Staff sign-in (R4.01). A signed-in staff member goes straight to the work queue. */
(function staffLogin() {
  const form = document.getElementById("login-form");
  const notice = document.getElementById("notice");
  const btn = document.getElementById("login-btn");

  apiCall("/api/me")
    .then((me) => {
      if (me.signed_in && me.role === "staff") window.location.replace("admin.html");
    })
    .catch(() => {});

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const username = document.getElementById("username").value.trim();
    const password = document.getElementById("password").value;
    if (!username || !password) {
      showNotice(notice, "Enter your staff username and password.");
      return;
    }
    btn.disabled = true;
    btn.textContent = "Signing in…";
    try {
      await apiCall("/auth/staff/login", { method: "POST", body: { username, password } });
      window.location.assign("admin.html");
    } catch (err) {
      showNotice(notice, err.message);
      btn.disabled = false;
      btn.textContent = "Sign in";
    }
  });
})();
