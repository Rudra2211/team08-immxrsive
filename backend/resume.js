/**
 * Release 2 — Resume import (R2.12 - R2.17, R2.30, R2.31, R2.32).
 *
 * Extraction is deterministic string work: a vocabulary scan plus a section
 * splitter. There is no model call anywhere in this file, which is what makes
 * R2.31 structural rather than a promise — resume text is only ever matched
 * against patterns defined here, so a sentence in the PDF has no channel
 * through which to instruct anything.
 *
 * The same property gives R2.32: every value returned is a substring of the
 * extracted text or a vocabulary entry that literally appears in it. Nothing
 * is inferred, completed or guessed, so a near-empty resume yields a
 * near-empty result instead of a plausible one.
 */
const fs = require("fs");
const path = require("path");
const { PDFParse } = require("pdf-parse");

const VOCAB = JSON.parse(fs.readFileSync(path.join(__dirname, "data", "skills.json"), "utf8"));

const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
const MAX_SUGGESTED = 25;

/**
 * R2.12 — word-boundary matching against the standardized vocabulary.
 *
 * \b is useless here: it would refuse to match "C#" (# is already a
 * non-word character) and would happily match the "C" inside "Scala". The
 * lookarounds below instead forbid an adjacent identifier character, so "C#"
 * matches in "Unity, C#, OpenXR" and never inside "Scala" or "C++".
 */
const EDGE_BEFORE = "(?<![A-Za-z0-9+#.])";
const EDGE_AFTER = "(?![A-Za-z0-9+#])";
const SKILL_PATTERNS = VOCAB.map((name) => ({
  name,
  re: new RegExp(EDGE_BEFORE + name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + EDGE_AFTER, "i"),
}));

/** Section headings we understand. Anything else is treated as plain text. */
const SECTION_PATTERNS = [
  ["education", /education|academics|qualifications/i],
  ["experience", /experience|employment|work history/i],
  ["skills", /skills|technologies|technical/i],
];

/**
 * Only well-known professional hosts are recognised (R2.14). A generic
 * "anything with a dot" pattern would also match the email address in
 * "avery.chen@example.test", and a resume's contact address is deliberately
 * never a candidate here — see R2.31 note on applyCandidates.
 */
const LINK_PATTERNS = [
  ["github", /(?:https?:\/\/)?(?:www\.)?github\.com\/[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)?/i],
  ["linkedin", /(?:https?:\/\/)?(?:www\.)?linkedin\.com\/in\/[A-Za-z0-9._-]+/i],
  ["gitlab", /(?:https?:\/\/)?(?:www\.)?gitlab\.com\/[A-Za-z0-9._-]+/i],
  ["behance", /(?:https?:\/\/)?(?:www\.)?behance\.net\/[A-Za-z0-9._-]+/i],
  ["dribbble", /(?:https?:\/\/)?(?:www\.)?dribbble\.com\/[A-Za-z0-9._-]+/i],
  ["itch", /(?:https?:\/\/)?(?:[A-Za-z0-9-]+\.)?itch\.io(?:\/[A-Za-z0-9._-]+)?/i],
];

const FRIENDLY_PARSE_ERROR =
  "We could not read that PDF. It may be a scan, password protected, or empty. " +
  "Your profile has not been changed — you can try another file or fill the fields in yourself.";

/** A short line in full caps is a heading, whether or not we recognise it. */
function isHeadingLine(line) {
  return line.length <= 60 && line === line.toUpperCase() && /[A-Z]/.test(line);
}

/** "Interest:", "References:" — an unrecognised label ends the section above it. */
function isLabelLine(line) {
  return /^[A-Za-z][A-Za-z &/-]{0,30}:/.test(line);
}

/** Every recognised heading in one line, in order. Two-column resumes merge
 *  "EDUCATION" and "EXPERIENCE" onto a single line, so one line can open more
 *  than one section. */
function headingsIn(line) {
  const found = [];
  for (const [key, re] of SECTION_PATTERNS) {
    const m = line.match(re);
    if (!m) continue;
    // Mid-sentence words like "3 years of experience" are not headings.
    if (m.index !== 0 && !isHeadingLine(line)) continue;
    found.push({ key, end: m.index + m[0].length });
  }
  return found.sort((a, b) => a.end - b.end);
}

/**
 * Splits the text into the sections we care about. Lines are kept verbatim;
 * nothing is rewritten, so whatever lands in a section is literally what the
 * PDF said (R2.32).
 */
function splitSections(lines) {
  const sections = { education: [], experience: [], skills: [] };
  let open = [];

  for (const line of lines) {
    const headings = headingsIn(line);
    if (headings.length) {
      open = headings.map((h) => h.key);
      // Text after the last heading on the line is that section's first line,
      // as in "SKILLS: Python, React, PostgreSQL".
      const rest = line.slice(headings[headings.length - 1].end).replace(/^[:–—\s-]+/, "");
      if (rest) for (const key of open) sections[key].push(rest);
      continue;
    }
    if (isHeadingLine(line) || isLabelLine(line)) {
      open = [];
      continue;
    }
    for (const key of open) sections[key].push(line);
  }

  return sections;
}

/**
 * R2.12 — terms from the resume's own skills section that are not in the
 * standardized vocabulary. They are reported separately so they can be
 * reviewed; they are never written to the skills table, because a free-text
 * term becoming a public filter value is how "C#", "c sharp" and "CSharp"
 * turn into three filter options.
 */
function suggestedFrom(skillLines, matched) {
  const taken = new Set(matched.map((s) => s.toLowerCase()));
  const out = [];
  for (const token of skillLines.join("\n").split(/[\n,|;•·]+/)) {
    const term = token.trim().replace(/^[-\s]+|[.\s]+$/g, "");
    if (!term || term.length < 2 || term.length > 40) continue;
    if (!/^[A-Za-z]/.test(term)) continue;
    // Column-merged lines drag contact details into the skills block. A term
    // holding an address or a URL is layout noise, not a skill.
    if (/[@/]/.test(term) || /\.(com|net|org|io|ca|test|dev)\b/i.test(term)) continue;
    if (term.split(/\s+/).length > 3) continue;
    if (taken.has(term.toLowerCase())) continue;
    taken.add(term.toLowerCase());
    out.push(term);
    if (out.length >= MAX_SUGGESTED) break;
  }
  return out;
}

/**
 * R2.13 — PDF in, editable candidate values out (R2.14).
 * Throws an Error whose message is safe to show the student (R2.17).
 */
async function extractCandidates(buffer, filename) {
  let text = "";
  try {
    const parser = new PDFParse({ data: buffer });
    try {
      text = (await parser.getText()).text || "";
    } finally {
      await parser.destroy();
    }
  } catch (err) {
    console.error("resume parse failed:", err.message, filename || "");
    throw new Error(FRIENDLY_PARSE_ERROR);
  }

  const lines = text
    .split(/\r?\n/)
    .map((l) => l.replace(/\s+/g, " ").trim())
    // "-- 1 of 2 --" is the extractor's page marker, not resume content.
    .filter((l) => l && !/^--\s*\d+\s+of\s+\d+\s*--$/.test(l));

  const sections = splitSections(lines);
  const haystack = lines.join("\n");

  const skills = SKILL_PATTERNS.filter((s) => s.re.test(haystack)).map((s) => s.name);

  const links = {};
  for (const [key, re] of LINK_PATTERNS) {
    const m = haystack.match(re);
    // Stored exactly as written in the PDF. Inventing a scheme or a www. host
    // would be inventing a fact about the candidate's links (R2.32).
    if (m) links[key] = m[0];
  }

  const candidates = {
    skills,
    suggested_skills: suggestedFrom(sections.skills, skills),
    education: sections.education.join("\n"),
    experience: sections.experience.join("\n"),
    links,
  };

  // R2.17 — a PDF that parses but says nothing useful is a failed import, not
  // an empty overwrite. Nothing has been written at this point, so there is no
  // data to lose.
  const empty =
    !candidates.skills.length &&
    !candidates.suggested_skills.length &&
    !candidates.education &&
    !candidates.experience &&
    !Object.keys(candidates.links).length;
  if (empty) {
    throw new Error(
      "We read that PDF but could not find any skills, education or experience to suggest. " +
        "Your profile has not been changed — you can edit your profile directly instead."
    );
  }

  return candidates;
}

function register(app) {
  // Required here rather than at module load so extractCandidates — and
  // test-resume.js — run without a database connection.
  const { pool } = require("./db");
  const { requireAuth, requireVerified } = require("./auth");
  const multer = require("multer");

  // memoryStorage, so the PDF never reaches disk. It is parsed below and the
  // buffer is dropped with the request; only the extracted candidates persist.
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 },
    fileFilter: (req, file, cb) => {
      // R2.13 — PDF is the only format we accept.
      if (file.mimetype !== "application/pdf") {
        return cb(new Error("Upload a PDF file. Other formats are not supported yet."));
      }
      cb(null, true);
    },
  }).single("resume");

  /** Multer's own failures (too large, wrong type) must read as advice, not as
   *  a stack trace. */
  function acceptUpload(req, res, next) {
    upload(req, res, (err) => {
      if (!err) return next();
      console.error("POST /api/resume/import upload failed:", err.message);
      const tooBig = err.code === "LIMIT_FILE_SIZE";
      res.status(400).json({
        error: tooBig ? "That file is larger than 5 MB. Please upload a smaller PDF." : err.message,
      });
    });
  }

  /** R2.30 — the signed-in user's own students row, or null. Every route below
   *  resolves the target through this, never through a client-supplied id. */
  async function ownStudent(userId) {
    const r = await pool.query(
      "SELECT id, education, experience, links FROM students WHERE user_id = $1",
      [userId]
    );
    return r.rows[0] || null;
  }

  /** R2.13, R2.15 — parse the upload and record it as pending. The student's
   *  profile is deliberately untouched here. */
  app.post("/api/resume/import", requireAuth, requireVerified, acceptUpload, async (req, res) => {
    if (!req.file) return res.status(400).json({ error: "Attach a PDF resume to import." });

    try {
      const student = await ownStudent(req.user.id);
      if (!student) {
        return res.status(403).json({ error: "Create your profile before importing a resume." });
      }

      let candidates;
      try {
        candidates = await extractCandidates(req.file.buffer, req.file.originalname);
      } catch (err) {
        // R2.17 — extractCandidates throws only messages written for students.
        return res.status(422).json({ error: err.message });
      }

      const r = await pool.query(
        `INSERT INTO resume_imports (student_id, filename, candidates, status)
         VALUES ($1,$2,$3,'pending')
         RETURNING id, filename, candidates, status, created_at`,
        [student.id, req.file.originalname || "", JSON.stringify(candidates)]
      );

      // R2.15 — returned for review. Nothing is live until the student applies.
      res.json({
        import_id: r.rows[0].id,
        status: "pending",
        candidates,
        message: "Review these suggestions and choose which ones to keep. Nothing has changed yet.",
      });
    } catch (err) {
      console.error("POST /api/resume/import failed:", err.message);
      res.status(500).json({ error: "Could not import that resume." });
    }
  });

  /** R2.15 — the review queue for the signed-in student only. */
  app.get("/api/resume/pending", requireAuth, async (req, res) => {
    try {
      const student = await ownStudent(req.user.id);
      if (!student) return res.json([]);
      const r = await pool.query(
        `SELECT id, filename, candidates, status, created_at
           FROM resume_imports
          WHERE student_id = $1 AND status = 'pending'
          ORDER BY created_at DESC`,
        [student.id]
      );
      res.json(r.rows);
    } catch (err) {
      console.error("GET /api/resume/pending failed:", err.message);
      res.status(500).json({ error: "Could not load your pending imports." });
    }
  });

  /** R2.30 — loads a pending import and proves the caller owns it. */
  async function loadOwnedImport(req, res) {
    const importId = Number(req.params.id);
    if (!Number.isInteger(importId)) {
      res.status(400).json({ error: "That import link is not valid." });
      return null;
    }
    const r = await pool.query(
      `SELECT ri.*, s.user_id, s.education, s.experience, s.links
         FROM resume_imports ri
         JOIN students s ON s.id = ri.student_id
        WHERE ri.id = $1`,
      [importId]
    );
    const row = r.rows[0];
    if (!row) {
      res.status(404).json({ error: "That import no longer exists." });
      return null;
    }
    if (row.user_id !== req.user.id) {
      res.status(403).json({ error: "That import belongs to another student." });
      return null;
    }
    if (row.status !== "pending") {
      res.status(409).json({ error: "That import has already been reviewed." });
      return null;
    }
    return row;
  }

  /**
   * R2.16 — apply only what the student ticked.
   *
   * A field is written if and only if it appears in `accept`. A field the
   * student has already written by hand is therefore never overwritten by an
   * import they did not explicitly accept for that field, and an accepted
   * field is replaced because accepting it is that instruction.
   *
   * R2.31 — `accept` comes from the student's form, never from the resume.
   * Nothing in the PDF can add a field here, and there is no publish or
   * visibility field in this handler at all, so no resume sentence can make a
   * profile public or surface a contact address.
   */
  app.post("/api/resume/:id/apply", requireAuth, requireVerified, async (req, res) => {
    try {
      const row = await loadOwnedImport(req, res);
      if (!row) return;

      const accept = req.body?.accept && typeof req.body.accept === "object" ? req.body.accept : {};
      const wants = (field) => accept[field] === true;
      const candidates = row.candidates || {};
      const applied = [];
      const skipped = [];

      for (const field of ["education", "experience"]) {
        const value = typeof candidates[field] === "string" ? candidates[field] : "";
        if (!wants(field) || !value) {
          if (row[field]) skipped.push(field); // left as the student wrote it (R2.16)
          continue;
        }
        await pool.query(`UPDATE students SET ${field} = $2 WHERE id = $1`, [row.student_id, value]);
        applied.push(field);
      }

      if (wants("skills") && Array.isArray(candidates.skills)) {
        // R2.12 — the join is against the existing standardized skills table,
        // so a term we somehow failed to normalise cannot create a new filter
        // value; it is simply not inserted.
        for (const name of candidates.skills) {
          await pool.query(
            `INSERT INTO student_skills (student_id, skill_name)
             SELECT $1, name FROM skills WHERE name = $2
             ON CONFLICT DO NOTHING`,
            [row.student_id, name]
          );
        }
        applied.push("skills");
      }

      if (wants("suggested_skills") && Array.isArray(candidates.suggested_skills)) {
        // Recorded for review only — never a public filter value (R2.12).
        for (const term of candidates.suggested_skills) {
          await pool.query(
            "INSERT INTO skill_suggestions (student_id, suggested) VALUES ($1,$2)",
            [row.student_id, term]
          );
        }
        applied.push("suggested_skills");
      }

      if (wants("links") && candidates.links && typeof candidates.links === "object") {
        // Merged key by key, so an accepted github link cannot clear a
        // portfolio link the student added by hand (R2.16).
        const merged = { ...(row.links || {}), ...candidates.links };
        await pool.query("UPDATE students SET links = $2 WHERE id = $1", [
          row.student_id,
          JSON.stringify(merged),
        ]);
        applied.push("links");
      }

      await pool.query(
        "UPDATE resume_imports SET status = 'applied', resolved_at = NOW() WHERE id = $1",
        [row.id]
      );

      res.json({
        status: "applied",
        applied,
        kept_your_edits: skipped,
        message: applied.length
          ? "Your profile has been updated with the suggestions you accepted."
          : "Nothing was accepted, so your profile is unchanged.",
      });
    } catch (err) {
      console.error("POST /api/resume/:id/apply failed:", err.message);
      res.status(500).json({ error: "Could not apply those suggestions." });
    }
  });

  /** R2.15 — declining is a first-class outcome, and changes no profile field. */
  app.post("/api/resume/:id/reject", requireAuth, requireVerified, async (req, res) => {
    try {
      const row = await loadOwnedImport(req, res);
      if (!row) return;
      await pool.query(
        "UPDATE resume_imports SET status = 'rejected', resolved_at = NOW() WHERE id = $1",
        [row.id]
      );
      res.json({ status: "rejected", message: "Those suggestions were discarded." });
    } catch (err) {
      console.error("POST /api/resume/:id/reject failed:", err.message);
      res.status(500).json({ error: "Could not discard those suggestions." });
    }
  });
}

module.exports = { register, extractCandidates, VOCAB, MAX_UPLOAD_BYTES };
