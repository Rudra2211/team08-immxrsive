/**
 * Release 4 — import a company from its public website (R4.08 - R4.12) and the
 * chosen Challenge, R4.10 Untrusted Website Content.
 *
 * The page is DATA. Nothing in it is ever executed, interpreted or obeyed:
 *   - extraction is a fixed set of text rules (title, headings, paragraphs,
 *     "Location:" / "Services:" lines); no model and no code reads the page in
 *     a way that could take instructions from it;
 *   - every extracted value is plain text: tags are stripped and the angle
 *     brackets that survive are removed, so nothing can become markup later;
 *   - the result is only a CANDIDATE. It never creates, publishes or verifies a
 *     company on its own (R4.09) — staff review and save it as a draft;
 *   - sentences that read like instructions to an AI or extraction system
 *     ("ignore previous instructions", "grant admin", "mark as verified") are
 *     set aside as flagged text and shown to staff as a warning, and are not
 *     used for any field. They cannot change anything regardless: the import
 *     route has no code path that writes roles, verification or status.
 *
 * Fetching a staff-supplied URL from the server is a server-side request, so
 * it is guarded: http(s) only, no credentials in the URL, every hop's host must
 * resolve to a public address (no localhost, private, link-local or metadata
 * ranges), at most 3 redirects, an 8 second timeout and a 512 KB body cap.
 */
const dns = require("dns").promises;
const net = require("net");

const MAX_BYTES = 512 * 1024;
const TIMEOUT_MS = 8000;
const MAX_REDIRECTS = 3;

class ImportError extends Error {
  constructor(message) {
    super(message);
    this.name = "ImportError";
  }
}

/** True for addresses a public website can never legitimately resolve to. */
function isPrivateAddress(address) {
  if (net.isIPv4(address)) {
    const [a, b] = address.split(".").map(Number);
    return (
      a === 0 || a === 10 || a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 198 && (b === 18 || b === 19)) ||
      a >= 224
    );
  }
  const v6 = address.toLowerCase();
  if (v6.startsWith("::ffff:")) return isPrivateAddress(v6.slice(7));
  return v6 === "::" || v6 === "::1" || v6.startsWith("fc") || v6.startsWith("fd") || v6.startsWith("fe80");
}

/** Validates a staff-typed URL. Returns a URL object or throws ImportError. */
function parsePublicUrl(raw) {
  const text = String(raw == null ? "" : raw).trim();
  if (!text) throw new ImportError("Enter the company's website address, for example https://example.com.");
  let url;
  try {
    url = new URL(/^[a-z][a-z0-9+.-]*:/i.test(text) ? text : `https://${text}`);
  } catch {
    throw new ImportError("That does not look like a website address. Check it and try again.");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new ImportError("Only website addresses starting with http:// or https:// can be imported.");
  }
  if (url.username || url.password) {
    throw new ImportError("Website addresses with a username or password cannot be imported.");
  }
  if (!url.hostname || !url.hostname.includes(".")) {
    throw new ImportError("That address has no public domain name.");
  }
  return url;
}

async function assertPublicHost(hostname) {
  // Local development and the automated tests serve the fixtures from
  // localhost; production never sets this.
  if (process.env.ALLOW_PRIVATE_IMPORT === "true") return;
  if (net.isIP(hostname) && isPrivateAddress(hostname)) {
    throw new ImportError("That address points to a private network and cannot be imported.");
  }
  let records;
  try {
    records = await dns.lookup(hostname, { all: true });
  } catch {
    throw new ImportError("We could not find that website. Check the address, or enter the details manually.");
  }
  if (!records.length || records.some((r) => isPrivateAddress(r.address))) {
    throw new ImportError("That address points to a private network and cannot be imported.");
  }
}

/** Fetches a page with the guards above. Returns { finalUrl, html }. */
async function fetchPage(rawUrl) {
  let url = parsePublicUrl(rawUrl);
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    await assertPublicHost(url.hostname);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    let res;
    try {
      res = await fetch(url, {
        redirect: "manual",
        signal: controller.signal,
        headers: { "User-Agent": "team08-immxrsive-partner-import", Accept: "text/html,text/plain;q=0.8" },
      });
    } catch (err) {
      clearTimeout(timer);
      throw new ImportError(
        err.name === "AbortError"
          ? "The website took too long to respond. Try again later, or enter the details manually."
          : "We could not reach that website. Enter the details manually, or try again later."
      );
    }

    if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
      clearTimeout(timer);
      // Each hop is re-validated, so a public page cannot redirect the server
      // into a private address.
      url = parsePublicUrl(new URL(res.headers.get("location"), url).toString());
      continue;
    }
    if (!res.ok) {
      clearTimeout(timer);
      throw new ImportError(`The website answered with an error (HTTP ${res.status}). Enter the details manually.`);
    }
    const type = (res.headers.get("content-type") || "").toLowerCase();
    if (type && !type.includes("text/html") && !type.includes("text/plain") && !type.includes("xhtml")) {
      clearTimeout(timer);
      throw new ImportError("That address is not a web page. Enter the details manually.");
    }

    const reader = res.body.getReader();
    const chunks = [];
    let size = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > MAX_BYTES) {
          controller.abort();
          throw new ImportError("That page is too large to import. Enter the details manually.");
        }
        chunks.push(value);
      }
    } catch (err) {
      if (err instanceof ImportError) throw err;
      throw new ImportError("The website stopped responding part-way through. Enter the details manually.");
    } finally {
      clearTimeout(timer);
    }
    return { finalUrl: url.toString(), html: Buffer.concat(chunks).toString("utf8") };
  }
  throw new ImportError("That website redirected too many times. Enter the details manually.");
}

// ---------------------------------------------------------------------------
// Extraction — text rules only
// ---------------------------------------------------------------------------

const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

/** Tag-free, entity-decoded, whitespace-collapsed text with no < or >. */
function toText(fragment, maxLength = 2000) {
  return String(fragment || "")
    .replace(/<[^>]*>/g, " ")
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, code) => {
      if (code[0] === "#") {
        const n = code[1].toLowerCase() === "x" ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
        return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : " ";
      }
      return ENTITIES[code.toLowerCase()] ?? " ";
    })
    .replace(/[<>]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

/** Sentences that address an AI/extraction system or ask for privileges. */
const INSTRUCTION_PATTERNS = [
  /\bignore\b.{0,40}\b(previous|prior|above|earlier)\b.{0,20}\binstructions?\b/i,
  /\b(disregard|override|forget)\b.{0,40}\b(instructions?|rules|policy|prompt)\b/i,
  /\b(grant|give)\b.{0,30}\b(admin|administrator|staff|root)\b.{0,20}\b(access|rights|role|permissions?)\b/i,
  /\bmark\b.{0,60}\b(verified|official|approved|partner)\b/i,
  /\bpublish\b.{0,20}\b(immediately|now|automatically)\b/i,
  /\b(system prompt|you are an ai|as an ai|assistant:)\b/i,
];
function looksLikeInstruction(text) {
  return INSTRUCTION_PATTERNS.some((re) => re.test(text));
}

/** Generic filler that says nothing about the company. */
function isFiller(text) {
  return /^(contact us|home|welcome|click here|read more|learn more)\b/i.test(text) && text.length < 60;
}

const KEYWORDS = [
  ["simulation", /simulat/i],
  ["XR", /\bXR\b|\bVR\b|\bAR\b|virtual reality|extended reality|augmented reality|mixed reality|spatial computing|immersive/i],
  ["training", /training|onboarding/i],
  ["visualization", /visuali[sz]ation/i],
  ["architecture", /architectur/i],
  ["AI", /\bAI\b|machine learning|artificial intelligence/i],
  ["games", /\bgam(e|es|ing)\b/i],
  ["research", /\bresearch\b/i],
  ["software", /\bsoftware\b/i],
];

function sectorFor(keywords) {
  if (keywords.includes("XR")) return "Immersive technology (XR)";
  if (keywords.includes("simulation")) return "Simulation";
  if (keywords.includes("visualization")) return "Visualization";
  if (keywords.includes("AI")) return "AI / Data";
  if (keywords.includes("games")) return "Games";
  return "";
}

function attr(tag, name) {
  const m = new RegExp(`${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, "i").exec(tag);
  return m ? (m[2] ?? m[3] ?? m[4] ?? "") : "";
}

function metaContent(html, key) {
  const re = /<meta\b[^>]*>/gi;
  let m;
  while ((m = re.exec(html))) {
    const tag = m[0];
    const k = (attr(tag, "name") || attr(tag, "property")).toLowerCase();
    if (k === key) return toText(attr(tag, "content"), 500);
  }
  return "";
}

function hostOf(value) {
  try {
    return new URL(value).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
}

/** Normalised domain used for the duplicate check and display. */
function domainOf(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  return hostOf(/^[a-z][a-z0-9+.-]*:/i.test(text) ? text : `https://${text}`);
}

/**
 * Pure: html + the URL it came from -> candidate fields, flagged text and a
 * list of fields that could not be found (so staff know what to complete).
 */
function extractCompany(html, sourceUrl) {
  const clean = String(html || "")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style|noscript|template|iframe|object|svg)\b[\s\S]*?<\/\1\s*>/gi, " ");

  const title = toText((/<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(clean) || [])[1], 200);
  const h1 = toText((/<h1\b[^>]*>([\s\S]*?)<\/h1>/i.exec(clean) || [])[1], 200);
  const siteName = metaContent(clean, "og:site_name");
  const metaDescription = metaContent(clean, "description") || metaContent(clean, "og:description");
  const metaKeywords = metaContent(clean, "keywords");

  const blocks = [];
  const blockRe = /<(p|li|address|h2|h3)\b[^>]*>([\s\S]*?)<\/\1\s*>/gi;
  let b;
  while ((b = blockRe.exec(clean))) {
    const text = toText(b[2], 1000);
    if (text) blocks.push(text);
  }

  const flagged = [];
  const usable = [];
  for (const text of blocks) {
    if (looksLikeInstruction(text)) flagged.push(text);
    else usable.push(text);
  }
  if (metaDescription && looksLikeInstruction(metaDescription)) flagged.push(metaDescription);

  // Name: the site's own name, else the main heading, else the page title with
  // any " | tagline" / " - tagline" suffix removed.
  const name = (siteName || h1 || title.split(/\s[|\-–—]\s/)[0] || "").slice(0, 120);

  let location = "";
  for (const text of usable) {
    const m = /^(?:location|address|headquarters|based in)\s*:\s*(.+)$/i.exec(text);
    if (m) { location = m[1]; break; }
  }
  if (!location) {
    for (const text of usable) {
      const m = /\b(?:located|based) in ([A-Z][^.;]{2,80})/.exec(text);
      if (m) { location = m[1]; break; }
    }
  }
  location = location.replace(/[,\s]+(Canada|USA|United States)\.?$/i, "").replace(/\.$/, "").trim().slice(0, 120);

  const servicesLine = usable.map((t) => /^(?:services|expertise|industries|focus)\s*:\s*(.+)$/i.exec(t)).find(Boolean);
  const descriptionSource = [
    metaDescription && !looksLikeInstruction(metaDescription) ? metaDescription : "",
    ...usable.filter((t) => !/^(?:location|address|services|expertise|industries|focus)\s*:/i.test(t) && !isFiller(t) && t.length >= 25),
  ].find(Boolean) || "";
  const description = descriptionSource.slice(0, 600);

  const keywordText = [servicesLine ? servicesLine[1] : "", metaKeywords, description].join(" ");
  const keywords = KEYWORDS.filter(([, re]) => re.test(keywordText)).map(([k]) => k);

  // Website: a link that points off the page's own host (the company's real
  // site, as on the fixtures), else the page's own address.
  const sourceHost = hostOf(sourceUrl);
  let website = "";
  const linkRe = /<a\b[^>]*>/gi;
  let a;
  while ((a = linkRe.exec(clean))) {
    const href = attr(a[0], "href");
    let abs;
    try {
      abs = new URL(href, sourceUrl);
    } catch {
      continue;
    }
    if (abs.protocol !== "http:" && abs.protocol !== "https:") continue;
    if (hostOf(abs.toString()) && hostOf(abs.toString()) !== sourceHost) {
      website = `${abs.protocol}//${abs.host}`;
      break;
    }
  }
  if (!website) {
    try {
      const u = new URL(sourceUrl);
      website = `${u.protocol}//${u.host}`;
    } catch {
      website = "";
    }
  }

  const candidate = {
    name,
    description,
    website,
    domain: domainOf(website),
    sector: sectorFor(keywords),
    keywords,
    location,
  };
  const missing = ["name", "description", "location", "sector"].filter((k) => !candidate[k]);
  if (!keywords.length) missing.push("keywords");
  return { candidate, flagged, missing };
}

module.exports = {
  ImportError,
  fetchPage,
  extractCompany,
  parsePublicUrl,
  isPrivateAddress,
  looksLikeInstruction,
  toText,
  domainOf,
};
