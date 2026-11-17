Chosen challenge: R4.10 - Untrusted Website Content

# Release Submission

Release: R4
Team: team-08
Project Option: Project 1 — ImmXrsive Talent and Industry Platform
Deployment: https://team08-r1-frontend.onrender.com
Repository: https://github.com/Rudra2211/team08-immxrsive
Release tag: R4-submission
Commit: the commit the R4-submission tag points to (full SHA in the Moodle submission)
Adapter: evaluation_adapter.json
Known issues: see "Known issues" below and KNOWN_ISSUES.md.
Test notes: API base is https://team08-r1-backend.onrender.com; health is
https://team08-r1-backend.onrender.com/health. Schema migrations
(`schema.sql` … `schema_r4.sql`) run automatically on boot. The Render free
tier sleeps after about 15 minutes idle, so the first request can take up to a
minute.

## Release notes

Release 4 adds staff operations, industry partners and collaborations. All
Core requirements are built, plus the chosen Challenge
**R4.10 - Untrusted Website Content**.

- **Staff role and work queue (R4.01–R4.03).** Staff sign in at
  `/staff-login.html` with a username and password, a role separate from
  GitHub student accounts. The first screen, `/admin.html`, lists tasks in
  plain words: *Verify projects*, *Review partner requests*, *Review partner
  drafts*, and the partner list with *Add a partner*. Every `/api/staff/*`
  route checks the staff role on the server. Anonymous calls get 401 and
  student sessions get 403, whatever identifier is in the URL or body.
- **Project verification (R4.04–R4.06).** In the project editor the
  maintainer uses *Request official verification* with a reason and an
  optional supporting link. Staff open *Verify project*, see the project,
  contributors and request, then approve or reject. A rejection needs a note,
  which the student sees. Only a staff approval sets the "Verified by
  ImmXrsive" badge, and no student route can set or change it.
- **Partner records (R4.07–R4.12).** *Add a partner* offers *Get details from
  the company's website* or *Enter details manually*. An import only fills the
  form: nothing is saved until staff press *Save draft*, and nothing is public
  until *Publish this partner*. If the site cannot be read, the form keeps
  whatever was already typed and staff carry on by hand. Each field shows where
  its value came from ("From the company website (URL), imported <time>" or
  "Entered or edited by staff (<name>), <time>"), and the page lists the import
  history.
- **R4.10 (chosen Challenge).** Fetched pages are parsed as plain text with a
  fixed set of extraction rules; nothing on the page is executed or treated as
  an instruction. Sentences that look like instructions to a system (for
  example "ignore previous instructions", "grant admin access", "mark as
  verified", "publish immediately") are shown to staff as *ignored* and are
  kept out of every field. Imports only ever produce drafts, so source text
  has no path to publication, verification or staff permissions. Imported text
  is stored as plain text and rendered with `textContent`, so it cannot run as
  script on admin or public pages. The fetcher accepts only http/https and
  refuses private, loopback and cloud-metadata addresses, checking again after
  each redirect (at most 3). It times out after 8 seconds and reads at most
  512 KB of HTML.
- **Also built, not chosen as the Challenge:**
  - *Check the website for changes* shows the differences and keeps staff
    values unless staff tick the website's version (R4.13).
  - The same website domain triggers a warning with a link to the existing
    partner, while a similar name on another domain is not merged (R4.14).
  - Private and limited collaborations are filtered in the server query as
    well as on the page (R4.19).
- **Collaborations (R4.15–R4.18).** From a partner, *Add a collaboration*
  records:
  - title, start and end year, and whether it is current or past;
  - visibility: Public, Limited (summary only) or Private (staff only);
  - description and outcome;
  - any number of related projects and published students.

  One partner holds many collaborations, and a project can have several
  partners.
- **Student partner requests (R4.20–R4.21).** In the project editor the
  maintainer picks a published partner or suggests a new company, explains the
  relationship and sends it. It shows as *Waiting for staff review*. Only staff
  approval links the partner to the public project page. Staff can approve a
  suggestion into a new, unpublished partner draft, or reject it with a note.
- **Public pages (R4.22–R4.24, R4.26).**
  - `/partners.html` lists partners as *Working with us now* or *Past
    collaborator*.
  - `/partner.html?id=…` says who the company is and how ImmXrsive worked
    with them: current and past collaborations, linked projects and students,
    the website, and *Start a collaboration inquiry*.
  - Each public collaboration also has *Ask about work like this*. The inquiry
    form records the partner or collaboration as its source.
  - Partner pages and the inquiry form have no sideways scroll at 390 px.
- **Regression (R4.27).** R1–R3 behaviour is unchanged (see the automated
  suites below).

## Known issues

- The staff workspace is designed for laptop and tablet widths. It works on a
  phone but is not optimised for it, which R4.26 allows.
- A site that lists no external link gets the page's own address as its
  website. Staff should correct it before publishing.
- Staff accounts come from server environment variables, and there is one
  test account in this release. There is no screen for managing staff
  accounts; R4 does not require one.
- A student's suggestion of a new company, once approved, creates an
  unpublished draft. The project shows that partner only after staff publish
  the draft.
- The Render free tier cold start, and the R3 GitHub-import limit of 60
  unauthenticated requests per hour, still apply.

## Test accounts

**Staff test account (R4.01, R4.25):**

- Sign in at https://team08-r1-frontend.onrender.com/staff-login.html
- Username: `immxrsive.staff`
- Password: given in the Moodle Release 4 Product Result submission text and
  through the approved private course channel. It is not committed to the
  repository.

**Student test account:** reviewers use their own, as in R2 and R3.

1. Open `/account.html` in a normal browser window.
2. Choose **Sign in with GitHub**.
3. Verify an @algomau.ca address with the six-digit code sent by email.
4. Create a profile.
5. Add a project; the creator becomes its maintainer.

Strict third-party-cookie blocking (for example Edge InPrivate) drops the
session cookie, because the frontend and API are separate services.

| Role | How a reviewer obtains it |
|---|---|
| Public visitor | Any browser, signed out |
| Staff | The staff test account above |
| Verified student / project maintainer | Own GitHub + @algomau.ca, then add a project |
| Unrelated student (authorization checks) | Any verified student, against a project they are not on |

## Fixture source URLs (R4.08–R4.11)

No instructor-hosted URLs were supplied, so the four fixture pages are
published **unchanged** (byte-for-byte the Moodle files) on our static site:

| Fixture | Hosted source URL |
|---|---|
| company_normal.html | https://team08-r1-frontend.onrender.com/fixtures/r4/company_normal.html |
| company_sparse.html | https://team08-r1-frontend.onrender.com/fixtures/r4/company_sparse.html |
| company_prompt_injection.html | https://team08-r1-frontend.onrender.com/fixtures/r4/company_prompt_injection.html |
| company_same_name_other_domain.html | https://team08-r1-frontend.onrender.com/fixtures/r4/company_same_name_other_domain.html |

To repeat an import, sign in as staff, choose *Add a partner*, paste a URL
above and choose *Get details*. No other setup is needed. To test a failed
import, use an unreachable address such as `https://nonexistent.invalid/`.

## Release-specific evidence (live, Tue Nov 17 2026)

- **Published fixture partner imported from a supplied page:** North Shore
  Simulations, imported from `company_normal.html`, reviewed and published:
  https://team08-r1-frontend.onrender.com/partner.html?id=co_ec8a3c39c41f596e4701b5ac
- **Company with at least two collaborations:** the same partner has two
  collaborations, so it shows as *Working with us now* with its past work
  kept:
  - *Industrial Safety Training Prototype* (2025, past, project P01);
  - *XR Maintenance Training Study* (2026, current, project P04).
- **Visibility:** Superior Immersive Labs was imported from
  `company_prompt_injection.html`. Its instruction text was flagged and
  ignored, and the partner was published only after staff review. It has one
  Private and one Limited collaboration. The public page and
  `GET /api/partners/co_8edf6b8214d990b82f9add2b` show only the limited
  summary; the private one is absent:
  https://team08-r1-frontend.onrender.com/partner.html?id=co_8edf6b8214d990b82f9add2b
- **Student request, pending → staff review:** on *ImmXrsive Talent Platform*
  (`proj_e8af7eb93cb98fd52ce900e9`) the maintainer requested North Shore
  Simulations. Staff approved it, and the project page now lists the partner:
  https://team08-r1-frontend.onrender.com/project.html?id=proj_e8af7eb93cb98fd52ce900e9

  A second partner request (Superior Immersive Labs) and a verification
  request are left **pending**, so reviewers find them in the staff work queue
  (Scenario A).
- **Drafts awaiting review:**
  - Algoma Field Systems: a sparse import, with its missing fields listed.
  - North Shore Simulation Studio: a similar name on a different domain, kept
    as a separate record.
- **Automated suites** (in `tests/`) all passed on Nov 17 2026 against a
  local copy of the stack:
  - `r4-api.js`: 70 checks. They cover staff authorization on every staff
    route, all four fixture imports against `expected_company_imports.json`,
    R4.10 flagging, draft-only imports, the failure fallback, provenance,
    duplicate domains, staff-edit preservation, collaborations and
    visibility, verification and partner requests, and the partner-page
    inquiry.
  - `r3-api.js`: 50 checks.
  - `r3-ui.js`: 27 checks.
  - `e2e.js`: 26 R1 checks, used as the R4.27 regression gate.

  `r4-api.js` deletes partners that have the fixture names, so run it only
  against a local test database.

## Deployment notes

- Two Render free-tier services: a Static Site for `frontend/` and a Web
  Service for `backend/`. Both are deployed with **Manual Deploy → Deploy
  latest commit**.
- PostgreSQL on Supabase. `schema.sql`, `schema_r2.sql`, `schema_r3.sql` and
  `schema_r4.sql` run idempotently on every boot.
- New environment variables: `STAFF_USERNAME` and `STAFF_PASSWORD` (at least
  10 characters). The password is stored as a salted scrypt hash on boot. All
  secrets live only as Render environment variables; only
  `backend/.env.example`, with placeholders, is committed.
