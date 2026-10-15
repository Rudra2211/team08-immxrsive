/**
 * Release 2 — Algoma affiliation verification (R2.04 - R2.09).
 *
 * The approved domain is configured server-side (ALGOMA_EMAIL_DOMAIN) so a
 * second domain can be added without a code change, as R2.04 requires.
 *
 * Delivery is by real email through Brevo. The local fallback below exists
 * only so the flow can be exercised without network access during
 * development; it is inert whenever BREVO_API_KEY is configured, which it is
 * in the deployed release.
 */
const crypto = require("crypto");
const { pool } = require("./db");
const { requireAuth } = require("./auth");

const DOMAIN = (process.env.ALGOMA_EMAIL_DOMAIN || "algomau.ca").toLowerCase();
const BREVO_API_KEY = process.env.BREVO_API_KEY || "";
const MAIL_FROM = process.env.MAIL_FROM || "";
const MAIL_FROM_NAME = process.env.MAIL_FROM_NAME || "ImmXrsive Talent Directory";
const TESTER_KEY = process.env.TESTER_KEY || "";

// R2.07 caps expiry at thirty minutes. The environment variable may shorten
// that but can never lengthen it past the ceiling the requirement sets.
const TTL_MINUTES = Math.min(30, Math.max(1, Number(process.env.VERIFICATION_TTL_MINUTES) || 30));

// R2.08 — reasonable protection against repeated requests and repeated guesses.
const MAX_SENDS_PER_HOUR = 5;
const MAX_ATTEMPTS_PER_CHALLENGE = 6;

const hash = (code) => crypto.createHash("sha256").update(String(code)).digest("hex");

/** Six digits, generated from a CSPRNG rather than Math.random. */
function newCode() {
  return String(crypto.randomInt(0, 1_000_000)).padStart(6, "0");
}

/**
 * R2.04/R2.05: compare the part after the FINAL @ exactly. An address such as
 * "someone@algomau.ca.attacker.test" or "algomau.ca@gmail.com" contains the
 * approved string but is not on the approved domain, and is rejected.
 */
function isApprovedAddress(email) {
  const value = String(email || "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return false;
  return value.slice(value.lastIndexOf("@") + 1) === DOMAIN;
}

async function deliver(email, code) {
  if (!BREVO_API_KEY) return { mode: "test" };

  const body = `Your ImmXrsive verification code is ${code}

It expires in ${TTL_MINUTES} minutes and can be used once.
If you did not request this, you can ignore this message.`;

  const res = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: {
      "api-key": BREVO_API_KEY,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      sender: { name: MAIL_FROM_NAME, email: MAIL_FROM },
      to: [{ email }],
      subject: "Your ImmXrsive verification code",
      textContent: body,
    }),
  });

  if (!res.ok) {
    // Brevo explains refusals (unverified sender, quota) in the body. Log the
    // reason for us; the student sees a plain message and nothing leaks.
    const detail = await res.text().catch(() => "");
    throw new Error(`Brevo delivery failed: ${res.status} ${detail.slice(0, 300)}`);
  }
  return { mode: "email" };
}

function register(app) {
  /** R2.04 — issue a challenge for the signed-in user. */
  app.post("/api/verify/request", requireAuth, async (req, res) => {
    const email = String(req.body?.email || "").trim().toLowerCase();

    if (!isApprovedAddress(email)) {
      // R2.05. The message names the domain so the student can correct it,
      // and says nothing about whether the address exists.
      return res.status(400).json({
        error: `Enter your Algoma address. It must end in @${DOMAIN}.`,
      });
    }

    try {
      const recent = await pool.query(
        `SELECT COUNT(*)::int AS n FROM verification_challenges
          WHERE user_id = $1 AND created_at > NOW() - INTERVAL '1 hour'`,
        [req.user.id]
      );
      if (recent.rows[0].n >= MAX_SENDS_PER_HOUR) {
        return res.status(429).json({
          error: "Too many verification requests. Please wait an hour and try again.",
        });
      }

      // Supersede any outstanding challenge so only the newest code works.
      await pool.query(
        `UPDATE verification_challenges SET used_at = NOW()
          WHERE user_id = $1 AND used_at IS NULL`,
        [req.user.id]
      );

      const code = newCode();
      const expiresAt = new Date(Date.now() + TTL_MINUTES * 60 * 1000);
      await pool.query(
        `INSERT INTO verification_challenges (user_id, email, code_hash, expires_at)
         VALUES ($1,$2,$3,$4)`,
        [req.user.id, email, hash(code), expiresAt]
      );

      const { mode } = await deliver(email, code);
      // The code itself is never logged or returned here, in either mode.
      res.json({
        sent: true,
        delivery: mode,
        expires_in_minutes: TTL_MINUTES,
        message:
          mode === "email"
            ? `We sent a code to ${email}. It expires in ${TTL_MINUTES} minutes.`
            : `A code was issued for ${email}. This deployment runs in test mode — see the release notes for how approved testers retrieve it. It expires in ${TTL_MINUTES} minutes.`,
      });
    } catch (err) {
      console.error("POST /api/verify/request failed:", err.message);
      res.status(500).json({ error: "Could not issue a verification code." });
    }
  });

  /** R2.06, R2.07 — confirm a code: single use, time limited, attempt limited. */
  app.post("/api/verify/confirm", requireAuth, async (req, res) => {
    const code = String(req.body?.code || "").trim();
    if (!/^\d{6}$/.test(code)) {
      return res.status(400).json({ error: "Enter the six-digit code." });
    }

    try {
      const r = await pool.query(
        `SELECT * FROM verification_challenges
          WHERE user_id = $1
          ORDER BY created_at DESC
          LIMIT 1`,
        [req.user.id]
      );
      const ch = r.rows[0];
      if (!ch) return res.status(400).json({ error: "Request a code first." });

      if (ch.attempts >= MAX_ATTEMPTS_PER_CHALLENGE) {
        return res.status(429).json({ error: "Too many attempts. Request a new code." });
      }
      await pool.query(
        "UPDATE verification_challenges SET attempts = attempts + 1 WHERE id = $1",
        [ch.id]
      );

      if (ch.used_at) return res.status(400).json({ error: "That code has already been used." });
      if (new Date(ch.expires_at) < new Date()) {
        return res.status(400).json({ error: "That code has expired. Request a new one." });
      }
      // Constant-time compare so a wrong code cannot be narrowed by timing.
      const supplied = Buffer.from(hash(code));
      const expected = Buffer.from(ch.code_hash);
      if (supplied.length !== expected.length || !crypto.timingSafeEqual(supplied, expected)) {
        return res.status(400).json({ error: "That code is not correct." });
      }

      await pool.query("UPDATE verification_challenges SET used_at = NOW() WHERE id = $1", [ch.id]);
      // R2.09 — recorded on the user, so later sign-ins never ask again.
      await pool.query(
        "UPDATE users SET verified_at = NOW(), algoma_email = $2 WHERE id = $1",
        [req.user.id, ch.email]
      );

      res.json({ verified: true, algoma_email: ch.email });
    } catch (err) {
      console.error("POST /api/verify/confirm failed:", err.message);
      res.status(500).json({ error: "Could not confirm the code." });
    }
  });

  /**
   * Test mode only. Returns the outstanding code for the signed-in user, and
   * only to a caller holding the tester key. Inert whenever real mail
   * delivery is configured, so a real student's code is never retrievable here.
   */
  app.get("/api/verify/test-code", requireAuth, async (req, res) => {
    if (BREVO_API_KEY || !TESTER_KEY) {
      return res.status(404).json({ error: "Not found." });
    }
    const supplied = String(req.get("x-tester-key") || "");
    const a = Buffer.from(supplied);
    const b = Buffer.from(TESTER_KEY);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
      return res.status(403).json({ error: "Tester key required." });
    }
    // The stored value is a hash, so the plaintext cannot be recovered. A
    // fresh code replaces the outstanding one — but for the SAME address the
    // student submitted, so verification records the address they asked for.
    const pending = await pool.query(
      `SELECT email FROM verification_challenges
        WHERE user_id = $1 AND used_at IS NULL AND expires_at > NOW()
        ORDER BY created_at DESC LIMIT 1`,
      [req.user.id]
    );
    if (!pending.rows[0]) {
      return res.status(400).json({ error: "Request a code first, then retrieve it here." });
    }
    const email = pending.rows[0].email;

    const code = newCode();
    const expiresAt = new Date(Date.now() + TTL_MINUTES * 60 * 1000);
    await pool.query(
      `UPDATE verification_challenges SET used_at = NOW()
        WHERE user_id = $1 AND used_at IS NULL`,
      [req.user.id]
    );
    await pool.query(
      `INSERT INTO verification_challenges (user_id, email, code_hash, expires_at)
       VALUES ($1,$2,$3,$4)`,
      [req.user.id, email, hash(code), expiresAt]
    );
    res.json({ code, email, expires_in_minutes: TTL_MINUTES });
  });
}

module.exports = { register, isApprovedAddress, TTL_MINUTES, DOMAIN };
