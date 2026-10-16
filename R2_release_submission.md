# Release Submission

Release: R2
Team: team-08
Deployment: https://team08-r1-frontend.onrender.com
Repository: https://github.com/Rudra2211/team08-immxrsive
Release tag: R2-submission
Commit: <PASTE THE FULL 40-CHARACTER SHA OF THE TAGGED COMMIT HERE>
Adapter: evaluation_adapter.json

Known issues: The free Render web service sleeps after ~15 minutes idle, so the
first request after a quiet period can take up to ~60 seconds — please allow for
this before concluding something is broken. Verification email is delivered
through Brevo from a Gmail sender, and the first message to a given mailbox is
commonly filed as junk; Algoma accounts are on Google Workspace, so check
mail.google.com and its Spam folder rather than Outlook. The session cookie is
SameSite=None because the frontend and API are separate Render origins, so
browsers configured to block all third-party cookies — notably Edge InPrivate
with strict tracking prevention — will silently discard it and the account page
will appear to do nothing after a successful GitHub sign-in; a normal browser
window works. A verification code is superseded as soon as another is requested,
so only the most recently issued code will verify. Verification is rate limited
to five sends per hour and six guesses per code. The users table has no unique
constraint on algoma_email, so two different GitHub accounts can each verify
against the same Algoma address — this does not expose any data, but it does
permit a duplicate that a stricter design would reject. Resume extraction is
deterministic rather than model-driven, so a heavily multi-column or
graphics-based PDF may yield partial results, which the review step exists to
catch. Carried over from Release 1: fixture external links point at example.com
and example.invalid and do not resolve; the skill filter is a native
multi-select needing Ctrl/Cmd-click for more than one choice; the directory
loads all published students in one request with no pagination; employer
inquiries are stored in the application's own table rather than forwarded to a
production intake form.

Test notes: API base is https://team08-r1-backend.onrender.com and the health
endpoint is https://team08-r1-backend.onrender.com/health. The whole Release 1
browsing workflow remains public and needs no account. Release 2's
self-service flow requires the reviewer to sign in with their own GitHub account
and verify their own @algomau.ca address — see "Test accounts" below for the
exact steps. Tested in Chrome and Edge on Windows at desktop and 390 CSS-pixel
widths.

## Test accounts

We are deliberately not supplying shared credentials. Identity is the feature
under test, and a shared account would prove nothing about it. Every Algoma
student reviewing this release already holds both things the flow needs.

To exercise the full Release 2 workflow:

1. Open https://team08-r1-frontend.onrender.com/account.html in a **normal**
   browser window (not InPrivate/Incognito — see Known Issues).
2. Click **Sign in with GitHub** and authorise with your own GitHub account.
   The consent screen will read **"Public data only"**. We request no scopes,
   and the app can never see your repositories.
3. Enter your own **@algomau.ca** address and click **Send me a code**.
4. Check **mail.google.com** for that account, **including the Spam folder** —
   Algoma is on Google Workspace, and the first message from our sender is
   commonly filed as junk. The code expires in 30 minutes and works once.
5. Enter the code, then build, preview and publish a profile.

To test the privacy requirement specifically, publish a profile with contact
email left private, then open a private/incognito window and request
`https://team08-r1-backend.onrender.com/api/students/{your_id}` directly. The
`contact_email` key will be **absent from the JSON entirely** — not blank, not
null. Hiding it in the UI would not satisfy the requirement, so we enforce it on
the server.

## Privacy and visibility summary

Six profile fields carry an individual visibility setting: availability, links,
location, contact email, education and experience. **Contact email is private by
default**; the others default to visible. A student changes any of them from the
profile editor, and the setting takes effect immediately on save.

Enforcement is server-side and single-sourced. One function, `publicView()` in
`backend/profile.js`, constructs every public response and also constructs the
student's own preview. A field whose visibility is off is never added to the
object, so it is absent from the serialised JSON rather than emptied. Because
the preview is built by the same function, what a student sees in preview is
exactly what a visitor receives — the two cannot drift apart as the code
changes.

A profile is created as a private draft and is invisible everywhere public —
directory, direct student URL, and project contributor lists — until the student
publishes it. Unpublishing returns it to that state. Publishing requires a
verified Algoma affiliation, and every write is checked against the caller's own
record: being signed in is necessary but never sufficient, and attempting to
modify another student's profile returns HTTP 403.

Two deliberate omissions. Contact email is never extracted from an uploaded
resume, because a field that is private by default should not be populated from
a document the student may not have read closely. And uploaded resumes are never
stored — the PDF is parsed in memory and discarded, so there is no file for a
future leak to expose.

## Release-specific evidence

- **Deployed URL:** https://team08-r1-frontend.onrender.com
- **Repository:** https://github.com/Rudra2211/team08-immxrsive
- **R2-submission tag:** https://github.com/Rudra2211/team08-immxrsive/tags
- **Release notes:** RELEASE_NOTES.md in the repository root.
- **Known issues:** KNOWN_ISSUES.md in the repository root, with impact and
  status for each item.
- **Technology / deployment summary (one page):** TECH_SUMMARY.md in the
  repository root. Static HTML/CSS/vanilla JS frontend on a Render Static Site;
  Node.js + Express API on a Render Web Service; PostgreSQL on Supabase via the
  session pooler. Release 2 is additive: `backend/schema_r2.sql` adds new tables
  and new nullable columns over the unchanged R1 schema and is idempotent, so a
  redeploy re-runs it harmlessly. Secrets — database URL, GitHub OAuth client
  secret, Brevo API key, session secret — exist only as Render environment
  variables; `.env` is git-ignored and `backend/.env.example` documents the names
  with placeholders. The browser never receives database credentials.
- **Identity:** GitHub OAuth with **no scopes requested**. Identity is keyed on
  GitHub's immutable numeric account id, so a student who renames their GitHub
  account returns to the same profile rather than silently acquiring a second
  one.
- **Affiliation verification:** six-digit code to an @algomau.ca address, stored
  only as a SHA-256 hash, single-use, expiring in 30 minutes (clamped
  server-side), rate limited to five sends per hour and six guesses per code.
  The approved domain is an environment variable, so a second domain can be
  added without a code change. The domain comparison is made against the
  substring after the final @, so lookalikes such as
  `someone@algomau.ca.attacker.test` are rejected.
- **Resume import:** PDF only, 5 MB cap, parsed in memory and never stored.
  Extraction is a fixed-vocabulary scan plus a section splitter — no language
  model anywhere in the path, so text inside an uploaded document has nothing to
  instruct and no field can be invented that was not in the file. Every import
  lands in a review step; nothing reaches the profile until the student accepts
  it, and a second import never silently overwrites existing data.
- **Directory integration:** no sync code exists, by design. A student profile
  *is* a `students` row, so publishing makes it appear in the Release 1
  directory immediately, searchable and filterable on the same terms as the
  fixture students.
- **Release 1 regression:** all R1 routes, query semantics and deep links behave
  as they did at the R1 freeze. The one intentional change is the free-text
  search fix for issue #1 — multi-word queries now require every term to match
  somewhere rather than treating the whole string as one phrase, so `Unity C#`
  returns the five students holding both skills instead of nothing.
- **Special browser assumptions:** JavaScript enabled, and a browser that
  accepts the session cookie (see Known Issues regarding strict third-party
  cookie blocking).
- **Completed adapter:** evaluation_adapter.json, submitted alongside this file
  and also committed to the repository root.

## Evidence index

Screenshots are supplied in the evidence archive, named by requirement.

| Requirement | Evidence |
|---|---|
| R2.01 sign-in | R2-01-signin.png |
| R2.02 identity on numeric id | R2-02-identity.png |
| R2.03 no repository scopes | R2-03-no-scopes.png, R2-03b-consent.png |
| R2.04 code issued | R2-04-code-sent.png |
| R2.05 non-approved domain rejected | R2-05-rejected.png |
| R2.06 verification succeeds | R2-06-verified.png |
| R2.07 code is single-use | automated test suite (verification suite, 14/14 passing) |
| R2.08 wrong code rejected | R2-08-wrong-code.png |
| R2.09 verification persists across sessions | R2-09-persists.png |
| R2.10 draft is private | R2-10-draft-private.png |
| R2.11 all profile fields editable | R2-11-all-fields.png |
| R2.12 skill vocabulary and suggestions | R2-12-skill-suggestion.png |
| R2.13–R2.14 resume extraction | R2-13-applied.png, R2-14-layout-stress.png |
| R2.15 review before apply | R2-15-review-panel.png |
| R2.16 no silent overwrite | R2-16-no-overwrite.png |
| R2.17 unparseable file handled | R2-17-unparseable.png |
| R2.18 uploaded file never stored | R2-18-not-stored.png |
| R2.19 private field absent from public JSON | R2-19-private-absent.png |
| R2.20 preview matches public view | R2-20-preview.png |
| R2.21 publish | R2-21-published.png |
| R2.22 appears in directory | R2-22-in-directory.png |
| R2.23 theme and section order | R2-23-theme-order.png |
| R2.24 search unaffected | R2-24-search-unaffected.png |
| R2.25 markup rendered as text | R2-25-xss-as-text.png |
| R2.26 mobile at 390px | R2-26-mobile-390.png |
| R2.27 keyboard and labels | R2-27-keyboard.png |
| R2.28 Release 1 regression | R2-28-r1-regression.png |
| R2.30 ownership enforced | R2-30-ownership.png |
| R2.31–R2.32 untrusted resume text | R2-31-untrusted.png |

R2.07 is the one requirement evidenced by automated test rather than a
screenshot. Single-use rejection is covered by the verification test suite,
which passes 14 of 14; we did not capture a manual screenshot of that specific
error state.
