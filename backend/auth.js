/**
 * Release 2 — GitHub sign-in and sessions (R2.01, R2.02, R2.03).
 *
 * Identity is internal: a users row keyed by GitHub's immutable numeric id, so
 * renaming on GitHub returns the student to the same profile (R2.02) rather
 * than silently creating a second one.
 *
 * No scopes are requested. The default OAuth grant reads only public profile
 * information, which satisfies R2.03 — nothing touching repositories.
 */
const crypto = require("crypto");
const { pool } = require("./db");

const CLIENT_ID = process.env.GITHUB_CLIENT_ID || "";
const CLIENT_SECRET = process.env.GITHUB_CLIENT_SECRET || "";
const APP_BASE_URL = (process.env.APP_BASE_URL || "").replace(/\/$/, "");
const FRONTEND_URL = (process.env.FRONTEND_URL || "").replace(/\/$/, "");
const SESSION_DAYS = 7;

const id = (prefix) => `${prefix}_${crypto.randomBytes(12).toString("hex")}`;

/** Short-lived state values guarding the OAuth round trip against CSRF. */
const pendingStates = new Map();
function newState() {
  const s = crypto.randomBytes(16).toString("hex");
  pendingStates.set(s, Date.now() + 10 * 60 * 1000);
  for (const [k, exp] of pendingStates) if (exp < Date.now()) pendingStates.delete(k);
  return s;
}
function consumeState(s) {
  const exp = pendingStates.get(s);
  if (!exp) return false;
  pendingStates.delete(s);
  return exp >= Date.now();
}

/** Cookies cross origins here (frontend and backend are separate Render
 *  services), so the session cookie needs SameSite=None and Secure. */
function sessionCookie(sessionId, maxAgeSeconds) {
  return [
    `sid=${sessionId}`,
    "Path=/",
    "HttpOnly",
    "Secure",
    "SameSite=None",
    `Max-Age=${maxAgeSeconds}`,
  ].join("; ");
}

function readCookie(req, name) {
  const raw = req.headers.cookie || "";
  for (const part of raw.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return decodeURIComponent(v.join("="));
  }
  return null;
}

async function createSession(userId) {
  const sid = id("s");
  const expires = new Date(Date.now() + SESSION_DAYS * 86400 * 1000);
  await pool.query("INSERT INTO sessions (id, user_id, expires_at) VALUES ($1,$2,$3)", [
    sid,
    userId,
    expires,
  ]);
  return { sid, maxAge: SESSION_DAYS * 86400 };
}

/** Resolves the signed-in user, or null. Never throws on a bad cookie. */
async function currentUser(req) {
  const sid = readCookie(req, "sid");
  if (!sid) return null;
  const r = await pool.query(
    `SELECT u.* FROM sessions s
       JOIN users u ON u.id = s.user_id
      WHERE s.id = $1 AND s.expires_at > NOW()`,
    [sid]
  );
  return r.rows[0] || null;
}

/** Gate for any route that writes. Ownership itself is checked per-row in
 *  profile.js (R2.30) — being signed in is necessary, never sufficient. */
async function requireAuth(req, res, next) {
  try {
    const user = await currentUser(req);
    if (!user) return res.status(401).json({ error: "Sign in to continue." });
    req.user = user;
    next();
  } catch (err) {
    console.error("auth lookup failed:", err.message);
    res.status(500).json({ error: "Could not verify your session." });
  }
}

/** Verified affiliation is required before a profile can exist (R2.09). */
function requireVerified(req, res, next) {
  if (!req.user || !req.user.verified_at) {
    return res.status(403).json({ error: "Verify your Algoma affiliation first." });
  }
  next();
}

function register(app) {
  app.get("/auth/github", (req, res) => {
    if (!CLIENT_ID) return res.status(500).json({ error: "GitHub sign-in is not configured." });
    const url = new URL("https://github.com/login/oauth/authorize");
    url.searchParams.set("client_id", CLIENT_ID);
    url.searchParams.set("redirect_uri", `${APP_BASE_URL}/auth/github/callback`);
    url.searchParams.set("state", newState());
    // No scope parameter: identity only, nothing about repositories (R2.03).
    res.redirect(url.toString());
  });

  app.get("/auth/github/callback", async (req, res) => {
    const { code, state } = req.query;
    const fail = (why) =>
      res.redirect(`${FRONTEND_URL}/account.html?error=${encodeURIComponent(why)}`);
    if (!code || !consumeState(String(state || ""))) {
      return fail("Sign-in expired. Please try again.");
    }

    try {
      const tokenRes = await fetch("https://github.com/login/oauth/access_token", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({
          client_id: CLIENT_ID,
          client_secret: CLIENT_SECRET,
          code,
          redirect_uri: `${APP_BASE_URL}/auth/github/callback`,
        }),
      });
      const token = await tokenRes.json();
      if (!token.access_token) return fail("GitHub did not grant access.");

      const ghRes = await fetch("https://api.github.com/user", {
        headers: {
          Authorization: `Bearer ${token.access_token}`,
          Accept: "application/vnd.github+json",
          "User-Agent": "team08-immxrsive",
        },
      });
      const gh = await ghRes.json();
      if (!gh.id) return fail("Could not read your GitHub profile.");

      // Keyed on the numeric id, so a login rename updates the display name
      // and returns the same internal user (R2.02).
      const r = await pool.query(
        `INSERT INTO users (id, github_user_id, github_login, last_login_at)
         VALUES ($1,$2,$3,NOW())
         ON CONFLICT (github_user_id)
         DO UPDATE SET github_login = EXCLUDED.github_login, last_login_at = NOW()
         RETURNING *`,
        [id("u"), gh.id, gh.login || ""]
      );

      const { sid, maxAge } = await createSession(r.rows[0].id);
      res.setHeader("Set-Cookie", sessionCookie(sid, maxAge));
      res.redirect(`${FRONTEND_URL}/account.html`);
    } catch (err) {
      console.error("GitHub callback failed:", err.message);
      fail("Sign-in failed. Please try again.");
    }
  });

  app.post("/auth/signout", async (req, res) => {
    const sid = readCookie(req, "sid");
    if (sid) await pool.query("DELETE FROM sessions WHERE id = $1", [sid]).catch(() => {});
    res.setHeader("Set-Cookie", sessionCookie("", 0));
    res.json({ signed_out: true });
  });

  /** What the frontend polls to decide which screen to show. */
  app.get("/api/me", async (req, res) => {
    try {
      const user = await currentUser(req);
      if (!user) return res.json({ signed_in: false });
      const p = await pool.query(
        "SELECT id, name, profile_status FROM students WHERE user_id = $1",
        [user.id]
      );
      res.json({
        signed_in: true,
        github_login: user.github_login,
        verified: Boolean(user.verified_at),
        algoma_email: user.algoma_email || null,
        profile: p.rows[0] || null,
      });
    } catch (err) {
      console.error("GET /api/me failed:", err.message);
      res.status(500).json({ error: "Could not load your account." });
    }
  });
}

module.exports = { register, requireAuth, requireVerified, currentUser, id };
